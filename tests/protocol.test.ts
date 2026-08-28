import { describe, expect, it } from "vitest";

import { clientMessageSchema, roomSnapshotSchema, serverMessageSchema } from "../src/domain/protocol";

describe("client protocol", () => {
  it("accepts a player answer with its idempotency key", () => {
    expect(
      clientMessageSchema.parse({
        version: 1,
        roomRevision: 7,
        type: "player.answer",
        payload: {
          questionId: "question-1",
          answerIndex: 1,
          idempotencyKey: "answer-attempt-1",
        },
      }),
    ).toMatchObject({ type: "player.answer" });
  });

  it("rejects a player answer without an idempotency key", () => {
    expect(() =>
      clientMessageSchema.parse({
        version: 1,
        roomRevision: 7,
        type: "player.answer",
        payload: { questionId: "question-1", answerIndex: 1 },
      }),
    ).toThrow();
  });

  it("requires a host ticket and idempotency key for every host command", () => {
    const hostCommands = [
      "host.lock_joining",
      "host.remove_player",
      "host.open_question",
      "host.extend_time",
      "host.close_question",
      "host.reveal_round",
      "host.show_leaderboard",
      "host.next_question",
      "host.end_game",
    ] as const;

    for (const type of hostCommands) {
      expect(() =>
        clientMessageSchema.parse({
          version: 1,
          roomRevision: 7,
          type,
          payload: {},
        }),
      ).toThrow();
    }
  });
});

describe("room protocol", () => {
  it("recognizes every room state", () => {
    const states = [
      "lobby",
      "question_open",
      "question_closed",
      "round_reveal",
      "leaderboard",
      "finished",
    ] as const;

    for (const state of states) {
      expect(
        roomSnapshotSchema.parse({
          roomCode: "123456",
          revision: 1,
          state,
          quizTitle: "Programming Language or Pokemon",
          joinLocked: false,
          currentQuestionIndex: null,
          currentQuestion: null,
          openedAt: null,
          baseDeadline: null,
          answerDeadline: null,
          players: [],
        }).state,
      ).toBe(state);
    }
  });

  it("accepts each server event type", () => {
    const snapshot = {
      roomCode: "123456",
      revision: 1,
      state: "lobby",
      quizTitle: "Programming Language or Pokemon",
      joinLocked: false,
      currentQuestionIndex: null,
      currentQuestion: null,
      openedAt: null,
      baseDeadline: null,
      answerDeadline: null,
      players: [],
    };
    const messages = [
      ["room.snapshot", { snapshot }],
      ["lobby.updated", { snapshot }],
      ["question.opened", { question: { id: "question-1", prompt: "Ruby", answers: ["Programming language", "Pokemon"], timerSeconds: 20 }, openedAt: 1, baseDeadline: 2, answerDeadline: 2 }],
      ["question.closed", { closedAt: 2 }],
      ["answer.received", { questionId: "question-1", answerIndex: 1, receivedAt: 2 }],
      ["round.revealed", { questionId: "question-1", correctIndex: 0, explanation: "Ruby is a programming language.", standings: [] }],
      ["leaderboard.updated", { standings: [] }],
      ["game.finished", { standings: [] }],
      ["room.paused", { reason: "Host disconnected" }],
      ["player.welcome", { playerId: "player-1", reconnectToken: "token", displayName: "Alex", avatarSeed: "player-1" }],
      ["error", { code: "ANSWER_CLOSED", message: "Answers are closed." }],
    ] as const;

    for (const [type, payload] of messages) {
      expect(serverMessageSchema.parse({ version: 1, roomRevision: 1, type, payload }).type).toBe(type);
    }
  });

  it("rejects correct-answer details in public questions before a round reveal", () => {
    const leakedQuestion = {
      id: "question-1",
      prompt: "Ruby",
      answers: ["Programming language", "Pokemon"],
      timerSeconds: 20,
      correctIndex: 0,
      explanation: "Ruby is a programming language.",
    };

    expect(() =>
      serverMessageSchema.parse({
        version: 1,
        roomRevision: 1,
        type: "question.opened",
        payload: { question: leakedQuestion, openedAt: 1, baseDeadline: 2, answerDeadline: 2 },
      }),
    ).toThrow();

    expect(() =>
      serverMessageSchema.parse({
        version: 1,
        roomRevision: 1,
        type: "room.snapshot",
        payload: {
          snapshot: {
            roomCode: "123456",
            revision: 1,
            state: "question_open",
            quizTitle: "Programming Language or Pokemon",
            joinLocked: false,
            currentQuestionIndex: 0,
            currentQuestion: leakedQuestion,
            openedAt: 1,
            baseDeadline: 2,
            answerDeadline: 2,
            players: [],
          },
        },
      }),
    ).toThrow();
  });
});
