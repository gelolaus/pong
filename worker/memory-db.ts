import { eventQuiz, quizSchema, type Quiz } from "../src/domain/quiz";
import {
  PongRepositoryError,
  type FinishSessionInput,
  type PongRepository,
  type QuizSummary,
  type SaveRoundInput,
  type SessionInput,
} from "./db";

export function createMemoryRepository(seed: readonly Quiz[] = [eventQuiz]): PongRepository {
  const quizzes = new Map(seed.map((quiz) => [quiz.id, quizSchema.parse(structuredClone(quiz))]));
  const sessions = new Map<string, SessionInput & { finishedAt: number | null; state: string }>();
  const answers = new Set<string>();
  const players = new Map<string, SaveRoundInput["players"][number]>();

  return {
    async listQuizzes(): Promise<QuizSummary[]> {
      return [...quizzes.values()].map((quiz) => ({ id: quiz.id, title: quiz.title }));
    },

    async getQuiz(quizId: string): Promise<Quiz> {
      const quiz = quizzes.get(quizId);
      if (!quiz) {
        throw new PongRepositoryError("invalid_data", "The requested quiz was not found.");
      }
      return quizSchema.parse(structuredClone(quiz));
    },

    async createSession(input: SessionInput): Promise<void> {
      for (const session of sessions.values()) {
        if (session.roomCode === input.roomCode && session.finishedAt === null) {
          throw new PongRepositoryError("conflict", "That record already exists.");
        }
      }
      sessions.set(input.id, { ...input, finishedAt: null, state: "lobby" });
    },

    async saveRound(input: SaveRoundInput): Promise<void> {
      for (const answer of input.answers) {
        answers.add(`${input.sessionId}:${input.questionId}:${answer.playerId}`);
      }
      for (const player of input.players) {
        players.set(`${input.sessionId}:${player.playerId}`, player);
      }
    },

    async finishSession(input: FinishSessionInput): Promise<void> {
      const session = sessions.get(input.sessionId);
      if (!session) {
        throw new PongRepositoryError("invalid_data", "The requested quiz was not found.");
      }
      session.finishedAt = input.finishedAt;
      session.state = "finished";
      for (const player of input.players) {
        players.set(`${input.sessionId}:${player.playerId}`, player);
      }
    },
  };
}
