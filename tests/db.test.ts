import { describe, expect, it } from "vitest";

import { eventQuiz } from "../src/domain/quiz";
import {
  applySchema,
  createTursoRepository,
  PongRepositoryError,
  type TursoTransport,
} from "../worker/db";

class FakeTransport implements TursoTransport {
  readonly activeCodes = new Set<string>();
  readonly savedAnswers = new Set<string>();
  readonly schemaStatements: string[] = [];
  batchCalls = 0;
  failNextBatch = false;

  async all(sql: string, args: readonly unknown[] = []) {
    if (sql.includes("FROM quizzes")) {
      return [{ id: eventQuiz.id, title: eventQuiz.title }];
    }
    if (sql.includes("FROM questions")) {
      return eventQuiz.questions.map((question, position) => ({
        id: question.id,
        prompt: question.prompt,
        image_url: question.imageUrl ?? null,
        answers_json: JSON.stringify(question.answers),
        correct_index: question.correctIndex,
        explanation: question.explanation,
        timer_seconds: question.timerSeconds,
        position,
      }));
    }
    return [];
  }

  async batch(statements: readonly { sql: string; args?: readonly unknown[] }[]) {
    this.batchCalls++;
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw Object.assign(new Error("temporary network timeout"), { code: "TIMEOUT" });
    }

    for (const statement of statements) {
      if (statement.sql.includes("INSERT INTO game_sessions")) {
        const code = String(statement.args?.[2]);
        if (this.activeCodes.has(code)) throw Object.assign(new Error("unique constraint"), { code: "SQLITE_CONSTRAINT" });
        this.activeCodes.add(code);
      }
      if (statement.sql.includes("INSERT INTO answers")) {
        const [sessionId, questionId, playerId] = statement.args ?? [];
        this.savedAnswers.add(`${sessionId}:${questionId}:${playerId}`);
      }
    }
  }

  async execute(sql: string) {
    this.schemaStatements.push(sql);
  }
}

describe("Turso Pong repository", () => {
  it("applies the schema repeatedly without requiring a clean database", async () => {
    const transport = new FakeTransport();

    await applySchema(transport);
    await applySchema(transport);

    expect(transport.schemaStatements).toHaveLength(2);
    expect(transport.schemaStatements.every((sql) => sql.includes("IF NOT EXISTS"))).toBe(true);
  });

  it("parses database quiz rows with the domain quiz schema", async () => {
    const repository = createTursoRepository({ TURSO_DATABASE_URL: "test://db", TURSO_AUTH_TOKEN: "test" }, new FakeTransport());

    await expect(repository.getQuiz(eventQuiz.id)).resolves.toEqual(eventQuiz);
    await expect(repository.listQuizzes()).resolves.toEqual([{ id: eventQuiz.id, title: eventQuiz.title }]);
  });

  it("rejects a duplicate active room code as a conflict", async () => {
    const repository = createTursoRepository({ TURSO_DATABASE_URL: "test://db", TURSO_AUTH_TOKEN: "test" }, new FakeTransport());
    const input = { id: "session-1", quizId: eventQuiz.id, roomCode: "123456", hostId: "host-1", createdAt: 1 };

    await repository.createSession(input);
    await expect(repository.createSession({ ...input, id: "session-2" })).rejects.toMatchObject<PongRepositoryError>({ code: "conflict" });
  });

  it("retries one transient batch failure and writes each round answer once", async () => {
    const transport = new FakeTransport();
    transport.failNextBatch = true;
    const repository = createTursoRepository({ TURSO_DATABASE_URL: "test://db", TURSO_AUTH_TOKEN: "test" }, transport);

    await repository.saveRound({
      sessionId: "session-1",
      questionId: eventQuiz.questions[0].id,
      answers: [{ playerId: "player-1", answerIndex: 0, receivedAt: 10, responseMs: 5, correct: true, points: 1_250, idempotencyKey: "answer-1" }],
      players: [{ playerId: "player-1", score: 1_250, streak: 1, connected: true, lastSeenAt: 10 }],
    });

    expect(transport.batchCalls).toBe(2);
    expect(transport.savedAnswers).toEqual(new Set(["session-1:clojure:player-1"]));
  });
});
