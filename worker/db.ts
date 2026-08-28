import { connect, DatabaseError, TimeoutError } from "@tursodatabase/serverless";
import { ZodError } from "zod";

import { eventQuiz, quizSchema, type Quiz } from "../src/domain/quiz";

export type RepositoryErrorCode = "transient" | "conflict" | "invalid_data";

export class PongRepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PongRepositoryError";
    this.code = code;
  }
}

export interface TursoTransport {
  all(sql: string, args?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  batch(statements: readonly { sql: string; args?: readonly unknown[] }[]): Promise<void>;
  execute(sql: string): Promise<void>;
}

export interface SessionInput {
  id: string;
  quizId: string;
  roomCode: string;
  hostId: string;
  createdAt: number;
}

export interface RoundAnswerRecord {
  playerId: string;
  answerIndex: number;
  receivedAt: number;
  responseMs: number;
  correct: boolean;
  points: number;
  idempotencyKey: string;
}

export interface RoundPlayerRecord {
  playerId: string;
  displayName?: string;
  avatarSeed?: string;
  tokenHash?: string;
  score: number;
  streak: number;
  connected: boolean;
  lastSeenAt: number;
}

export interface SaveRoundInput {
  sessionId: string;
  questionId: string;
  answers: readonly RoundAnswerRecord[];
  players: readonly RoundPlayerRecord[];
}

export interface FinishSessionInput {
  sessionId: string;
  finishedAt: number;
  players: readonly RoundPlayerRecord[];
}

export interface QuizSummary {
  id: string;
  title: string;
}

export interface PongRepository {
  listQuizzes(): Promise<QuizSummary[]>;
  getQuiz(quizId: string): Promise<Quiz>;
  createSession(input: SessionInput): Promise<void>;
  saveRound(input: SaveRoundInput): Promise<void>;
  finishSession(input: FinishSessionInput): Promise<void>;
}

export type TursoEnv = {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
};

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  image_url TEXT,
  answers_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  timer_seconds INTEGER NOT NULL,
  PRIMARY KEY (quiz_id, id),
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id)
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  state TEXT NOT NULL,
  current_question INTEGER,
  host_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_active_room_code
  ON game_sessions(room_code)
  WHERE finished_at IS NULL;

CREATE TABLE IF NOT EXISTS session_players (
  session_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_seed TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  connected INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, player_id),
  FOREIGN KEY (session_id) REFERENCES game_sessions(id)
);

CREATE TABLE IF NOT EXISTS answers (
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  answer_index INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  response_ms INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  points INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  PRIMARY KEY (session_id, question_id, player_id),
  FOREIGN KEY (session_id) REFERENCES game_sessions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS answers_one_per_player_question
  ON answers(session_id, question_id, player_id);
`.trim();

export async function applySchema(transport: TursoTransport, schemaSql = SCHEMA_SQL): Promise<void> {
  await transport.execute(schemaSql);
}

export function createTursoTransport(env: TursoEnv): TursoTransport {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    throw new PongRepositoryError("invalid_data", "Turso configuration is missing.");
  }

  const connection = connect({
    url: env.TURSO_DATABASE_URL,
    authToken: env.TURSO_AUTH_TOKEN,
  });

  return {
    async all(sql, args = []) {
      return connection.all(sql, [...args]) as Promise<Record<string, unknown>[]>;
    },
    async batch(statements) {
      await connection.batch(
        statements.map((statement) => ({ sql: statement.sql, args: [...(statement.args ?? [])] })),
        "immediate",
      );
    },
    async execute(sql) {
      const parts = splitSqlStatements(sql);
      if (parts.length === 0) return;
      if (parts.length === 1) {
        await connection.exec(parts[0]);
        return;
      }
      await connection.batch(parts, "immediate");
    },
  };
}

export function createTursoRepository(env: TursoEnv, transport: TursoTransport = createTursoTransport(env)): PongRepository {
  return {
    async listQuizzes() {
      try {
        const rows = await transport.all("SELECT id, title FROM quizzes ORDER BY title ASC");
        return rows.map((row) => ({
          id: String(row.id ?? ""),
          title: String(row.title ?? ""),
        }));
      } catch (error) {
        throw mapRepositoryError(error);
      }
    },

    async getQuiz(quizId: string) {
      try {
        const quizzes = await transport.all("SELECT id, title FROM quizzes WHERE id = ?", [quizId]);
        const quizRow = quizzes[0];
        if (!quizRow) {
          throw new PongRepositoryError("invalid_data", "The requested quiz was not found.");
        }

        const questionRows = await transport.all(
          "SELECT id, prompt, image_url, answers_json, correct_index, explanation, timer_seconds, position FROM questions WHERE quiz_id = ? ORDER BY position ASC",
          [quizId],
        );

        return quizSchema.parse({
          id: String(quizRow.id ?? ""),
          title: String(quizRow.title ?? ""),
          questions: questionRows.map(questionFromRow),
        });
      } catch (error) {
        throw mapRepositoryError(error);
      }
    },

    async createSession(input: SessionInput) {
      try {
        await transport.batch([
          {
            sql: "INSERT INTO game_sessions (id, quiz_id, room_code, state, current_question, host_id, created_at, finished_at) VALUES (?, ?, ?, 'lobby', NULL, ?, ?, NULL)",
            args: [input.id, input.quizId, input.roomCode, input.hostId, input.createdAt],
          },
        ]);
      } catch (error) {
        throw mapRepositoryError(error);
      }
    },

    async saveRound(input: SaveRoundInput) {
      await withTransientRetry(() => transport.batch(roundStatements(input)));
    },

    async finishSession(input: FinishSessionInput) {
      try {
        await transport.batch([
          {
            sql: "UPDATE game_sessions SET state = 'finished', finished_at = ? WHERE id = ?",
            args: [input.finishedAt, input.sessionId],
          },
          ...input.players.map((player) => playerUpsert(input.sessionId, player)),
        ]);
      } catch (error) {
        throw mapRepositoryError(error);
      }
    },
  };
}

export async function upsertQuiz(transport: TursoTransport, quiz: Quiz, now = Date.now()): Promise<void> {
  const parsed = quizSchema.parse(quiz);
  try {
    await transport.batch([
      {
        sql: `INSERT INTO quizzes (id, title, status, created_at, updated_at)
              VALUES (?, ?, 'published', ?, ?)
              ON CONFLICT(id) DO UPDATE SET title = excluded.title, status = 'published', updated_at = excluded.updated_at`,
        args: [parsed.id, parsed.title, now, now],
      },
      {
        sql: "DELETE FROM questions WHERE quiz_id = ?",
        args: [parsed.id],
      },
      ...parsed.questions.map((question, position) => ({
        sql: `INSERT INTO questions (
                id, quiz_id, position, prompt, image_url, answers_json, correct_index, explanation, timer_seconds
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          question.id,
          parsed.id,
          position,
          question.prompt,
          question.imageUrl ?? null,
          JSON.stringify(question.answers),
          question.correctIndex,
          question.explanation,
          question.timerSeconds,
        ],
      })),
    ]);
  } catch (error) {
    throw mapRepositoryError(error);
  }
}

export async function seedEventQuiz(transport: TursoTransport, now = Date.now()): Promise<{ quizId: string; questionCount: number }> {
  await upsertQuiz(transport, eventQuiz, now);
  return { quizId: eventQuiz.id, questionCount: eventQuiz.questions.length };
}

function questionFromRow(row: Record<string, unknown>) {
  let answers: unknown = row.answers_json;
  if (typeof answers === "string") {
    answers = JSON.parse(answers);
  }

  return {
    id: String(row.id ?? ""),
    prompt: String(row.prompt ?? ""),
    ...(typeof row.image_url === "string" && row.image_url.length > 0 ? { imageUrl: row.image_url } : {}),
    answers,
    correctIndex: Number(row.correct_index),
    explanation: String(row.explanation ?? ""),
    timerSeconds: Number(row.timer_seconds),
  };
}

function roundStatements(input: SaveRoundInput) {
  return [
    ...input.answers.map((answer) => ({
      sql: `INSERT INTO answers (
              session_id, question_id, player_id, answer_index, received_at, response_ms, correct, points, idempotency_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id, question_id, player_id) DO NOTHING`,
      args: [
        input.sessionId,
        input.questionId,
        answer.playerId,
        answer.answerIndex,
        answer.receivedAt,
        answer.responseMs,
        answer.correct ? 1 : 0,
        answer.points,
        answer.idempotencyKey,
      ] as const,
    })),
    ...input.players.map((player) => playerUpsert(input.sessionId, player)),
  ];
}

function playerUpsert(sessionId: string, player: RoundPlayerRecord) {
  return {
    sql: `INSERT INTO session_players (
            session_id, player_id, display_name, avatar_seed, token_hash, score, streak, connected, last_seen_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, player_id) DO UPDATE SET
            display_name = COALESCE(excluded.display_name, session_players.display_name),
            avatar_seed = COALESCE(excluded.avatar_seed, session_players.avatar_seed),
            token_hash = CASE WHEN excluded.token_hash = '' THEN session_players.token_hash ELSE excluded.token_hash END,
            score = excluded.score,
            streak = excluded.streak,
            connected = excluded.connected,
            last_seen_at = excluded.last_seen_at`,
    args: [
      sessionId,
      player.playerId,
      player.displayName ?? "",
      player.avatarSeed ?? player.playerId,
      player.tokenHash ?? "",
      player.score,
      player.streak,
      player.connected ? 1 : 0,
      player.lastSeenAt,
    ] as const,
  };
}

async function withTransientRetry(operation: () => Promise<void>): Promise<void> {
  try {
    await operation();
  } catch (error) {
    const mapped = mapRepositoryError(error);
    if (mapped.code !== "transient") {
      throw mapped;
    }
    try {
      await operation();
    } catch (retryError) {
      throw mapRepositoryError(retryError);
    }
  }
}

function mapRepositoryError(error: unknown): PongRepositoryError {
  if (error instanceof PongRepositoryError) {
    return error;
  }
  if (error instanceof ZodError) {
    return new PongRepositoryError("invalid_data", "Stored quiz data is invalid.", { cause: error });
  }

  const code = errorCode(error);
  const message = error instanceof Error ? error.message : "Database request failed.";

  if (code === "SQLITE_CONSTRAINT" || /unique constraint/i.test(message)) {
    return new PongRepositoryError("conflict", "That record already exists.", { cause: error });
  }
  if (
    error instanceof TimeoutError
    || code === "TIMEOUT"
    || code === "SQLITE_BUSY"
    || /timeout|temporar|network|ECONNRESET|503|429/i.test(message)
  ) {
    return new PongRepositoryError("transient", "The database is temporarily unavailable.", { cause: error });
  }
  if (error instanceof DatabaseError) {
    return new PongRepositoryError("invalid_data", "The database rejected that request.", { cause: error });
  }

  return new PongRepositoryError("transient", "The database is temporarily unavailable.", { cause: error });
}

function errorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function splitSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
