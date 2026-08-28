import { describe, expect, it } from "vitest";

import { eventQuiz } from "../src/domain/quiz";
import {
  acceptAnswer,
  advanceQuestion,
  closeQuestion,
  createRoomState,
  disconnectPlayer,
  extendTime,
  finishGame,
  isPlayerAway,
  joinPlayer,
  openQuestion,
  removePlayer,
  resumePlayer,
  revealRound,
  setJoinLocked,
  showLeaderboard,
  type RoomState,
  type TransitionResult,
} from "../worker/room-state";

const roomInput = { roomCode: "123456", quiz: eventQuiz };

function success(result: TransitionResult): RoomState {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.state;
}

function join(state: RoomState, playerId: string, displayName: string, token: string, now = 1_000) {
  const result = joinPlayer(state, { playerId, displayName, reconnectToken: token, now });
  expect(result.ok).toBe(true);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result;
}

describe("room transitions", () => {
  it("moves two players through a round and increments revision once per accepted transition", () => {
    const created = createRoomState(roomInput);
    const alice = join(created, "player-a", "Alex", "alice-token");
    const bob = join(alice.state, "player-b", "Bea", "bob-token", 1_001);
    const opened = success(openQuestion(bob.state, { questionIndex: 0, idempotencyKey: "open-0", now: 2_000 }));
    const answered = success(acceptAnswer(opened, {
      playerId: "player-a",
      questionId: eventQuiz.questions[0].id,
      answerIndex: eventQuiz.questions[0].correctIndex,
      idempotencyKey: "answer-a-0",
      now: 2_000,
    }));
    const closed = success(closeQuestion(answered, { idempotencyKey: "close-0", now: 3_000 }));
    const revealed = success(revealRound(closed, { idempotencyKey: "reveal-0", now: 3_001 }));
    const leaderboard = success(showLeaderboard(revealed, { idempotencyKey: "leaderboard-0", now: 3_002 }));
    const advanced = success(advanceQuestion(leaderboard, { idempotencyKey: "next-0", now: 3_003 }));

    expect(advanced.snapshot.state).toBe("lobby");
    expect(advanced.snapshot.currentQuestionIndex).toBeNull();
    expect(revealed.snapshot.players.find((player) => player.id === "player-a")).toMatchObject({
      score: 1250,
      streak: 1,
      rank: 1,
    });
    expect(advanced.snapshot.revision).toBe(8);
  });

  it("rejects late and duplicate answers without changing the room revision", () => {
    const joined = join(createRoomState(roomInput), "player-a", "Alex", "alice-token");
    const opened = success(openQuestion(joined.state, { questionIndex: 0, idempotencyKey: "open-0", now: 2_000 }));
    const accepted = success(acceptAnswer(opened, {
      playerId: "player-a",
      questionId: eventQuiz.questions[0].id,
      answerIndex: 0,
      idempotencyKey: "answer-a-0",
      now: 2_001,
    }));
    const duplicate = acceptAnswer(accepted, {
      playerId: "player-a",
      questionId: eventQuiz.questions[0].id,
      answerIndex: 0,
      idempotencyKey: "answer-a-0-retry",
      now: 2_002,
    });
    const late = acceptAnswer(opened, {
      playerId: "player-a",
      questionId: eventQuiz.questions[0].id,
      answerIndex: 0,
      idempotencyKey: "answer-a-late",
      now: 22_001,
    });

    expect(duplicate).toMatchObject({ ok: false, code: "DUPLICATE_ANSWER", state: accepted });
    expect(late).toMatchObject({ ok: false, code: "ANSWER_LATE", state: opened });
  });

  it("hashes the reconnect token, suffixes duplicate names, and rejects a removed token", () => {
    const first = join(createRoomState(roomInput), "player-a", "Alex", "super-secret-token");
    const second = join(first.state, "player-b", "Alex", "bob-token", 1_001);
    const removed = success(removePlayer(second.state, { playerId: "player-a", idempotencyKey: "remove-a", now: 1_002 }));
    const resumed = resumePlayer(removed, { playerId: "player-a", reconnectToken: "super-secret-token", now: 1_003 });

    expect(first.player.reconnectToken).toBe("super-secret-token");
    expect(JSON.stringify(first.state)).not.toContain("super-secret-token");
    expect(first.state.players[0].reconnectTokenHash).toBe("599a7f359d1e11124054f8afeae201f2d265b8988d91cb5b7d4dc4c9e2225c30");
    expect(second.state.snapshot.players.map((player) => player.displayName)).toEqual(["Alex", "Alex 2"]);
    expect(resumed).toMatchObject({ ok: false, code: "PLAYER_REMOVED", state: removed });
  });

  it("uses the first unused suffix when an active name already has a numeric suffix", () => {
    const first = join(createRoomState(roomInput), "player-a", "Alex", "alice-token");
    const suffixed = join(first.state, "player-b", "Alex 2", "bob-token", 1_001);
    const duplicate = join(suffixed.state, "player-c", "Alex", "cam-token", 1_002);

    expect(duplicate.state.snapshot.players.map((player) => player.displayName)).toEqual(["Alex", "Alex 2", "Alex 3"]);
  });

  it("locks joins and marks a disconnected player away at the 30-second threshold", () => {
    const joined = join(createRoomState(roomInput), "player-a", "Alex", "alice-token");
    const locked = success(setJoinLocked(joined.state, { locked: true, idempotencyKey: "lock", now: 1_001 }));
    const blocked = joinPlayer(locked, { playerId: "player-b", displayName: "Bea", reconnectToken: "bob-token", now: 1_002 });
    const disconnected = success(disconnectPlayer(locked, { playerId: "player-a", now: 5_000 }));

    expect(blocked).toMatchObject({ ok: false, code: "JOIN_LOCKED", state: locked });
    expect(isPlayerAway(disconnected, "player-a", 34_999)).toBe(false);
    expect(isPlayerAway(disconnected, "player-a", 35_000)).toBe(true);
    expect(disconnectPlayer(disconnected, { playerId: "player-a", now: 5_001 })).toMatchObject({
      ok: false,
      code: "INVALID_STATE",
      state: disconnected,
    });
  });

  it("does not apply a repeated host idempotency key twice", () => {
    const joined = join(createRoomState(roomInput), "player-a", "Alex", "alice-token");
    const opened = success(openQuestion(joined.state, { questionIndex: 0, idempotencyKey: "open-0", now: 2_000 }));
    const retried = openQuestion(opened, { questionIndex: 0, idempotencyKey: "open-0", now: 2_001 });

    expect(retried).toMatchObject({ ok: false, code: "DUPLICATE_HOST_COMMAND", state: opened });
  });

  it("allows correctness points during added time without restoring the speed bonus", () => {
    const joined = join(createRoomState(roomInput), "player-a", "Alex", "alice-token");
    const opened = success(openQuestion(joined.state, { questionIndex: 0, idempotencyKey: "open-0", now: 2_000 }));
    const extended = success(extendTime(opened, { additionalSeconds: 15, idempotencyKey: "extend-0", now: 21_000 }));
    const answered = success(acceptAnswer(extended, {
      playerId: "player-a",
      questionId: eventQuiz.questions[0].id,
      answerIndex: eventQuiz.questions[0].correctIndex,
      idempotencyKey: "answer-a-0",
      now: 22_000,
    }));
    const closed = success(closeQuestion(answered, { idempotencyKey: "close-0", now: 22_001 }));
    const revealed = success(revealRound(closed, { idempotencyKey: "reveal-0", now: 22_002 }));

    expect(revealed.snapshot.players[0]).toMatchObject({ score: 1000, streak: 1 });
  });

  it("orders equal scores by response duration and then join order", () => {
    const first = join(createRoomState(roomInput), "player-a", "Alex", "alice-token");
    const second = join(first.state, "player-b", "Bea", "bob-token", 1_001);
    const third = join(second.state, "player-c", "Cam", "cam-token", 1_002);
    const opened = success(openQuestion(third.state, { questionIndex: 0, idempotencyKey: "open-0", now: 2_000 }));
    const firstAnswer = success(acceptAnswer(opened, { playerId: "player-a", questionId: eventQuiz.questions[0].id, answerIndex: 1, idempotencyKey: "a", now: 2_100 }));
    const secondAnswer = success(acceptAnswer(firstAnswer, { playerId: "player-b", questionId: eventQuiz.questions[0].id, answerIndex: 1, idempotencyKey: "b", now: 2_100 }));
    const thirdAnswer = success(acceptAnswer(secondAnswer, { playerId: "player-c", questionId: eventQuiz.questions[0].id, answerIndex: 1, idempotencyKey: "c", now: 2_200 }));
    const closed = success(closeQuestion(thirdAnswer, { idempotencyKey: "close-0", now: 3_000 }));
    const revealed = success(revealRound(closed, { idempotencyKey: "reveal-0", now: 3_001 }));

    expect(revealed.snapshot.players.map((player) => player.id)).toEqual(["player-a", "player-b", "player-c"]);
    expect(revealed.snapshot.players.map((player) => player.rank)).toEqual([1, 2, 3]);
  });

  it("ranks an answered zero-point player ahead of an unanswered zero-point player", () => {
    const first = join(createRoomState(roomInput), "player-a", "Alex", "alice-token");
    const second = join(first.state, "player-b", "Bea", "bob-token", 1_001);
    const opened = success(openQuestion(second.state, { questionIndex: 0, idempotencyKey: "open-0", now: 2_000 }));
    const answered = success(acceptAnswer(opened, {
      playerId: "player-a",
      questionId: eventQuiz.questions[0].id,
      answerIndex: 1,
      idempotencyKey: "answer-a-0",
      now: 2_100,
    }));
    const closed = success(closeQuestion(answered, { idempotencyKey: "close-0", now: 3_000 }));
    const revealed = success(revealRound(closed, { idempotencyKey: "reveal-0", now: 3_001 }));

    expect(revealed.snapshot.players.map((player) => player.id)).toEqual(["player-a", "player-b"]);
  });

  it("recognizes a delayed join-lock retry after the room leaves the lobby", () => {
    const joined = join(createRoomState(roomInput), "player-a", "Alex", "alice-token");
    const locked = success(setJoinLocked(joined.state, { locked: true, idempotencyKey: "lock", now: 1_001 }));
    const opened = success(openQuestion(locked, { questionIndex: 0, idempotencyKey: "open-0", now: 2_000 }));
    const retried = setJoinLocked(opened, { locked: true, idempotencyKey: "lock", now: 2_001 });

    expect(retried).toMatchObject({ ok: false, code: "DUPLICATE_HOST_COMMAND", state: opened });
  });

  it("recognizes a delayed extension retry after the question closes", () => {
    const joined = join(createRoomState(roomInput), "player-a", "Alex", "alice-token");
    const opened = success(openQuestion(joined.state, { questionIndex: 0, idempotencyKey: "open-0", now: 2_000 }));
    const extended = success(extendTime(opened, { additionalSeconds: 15, idempotencyKey: "extend-0", now: 2_001 }));
    const closed = success(closeQuestion(extended, { idempotencyKey: "close-0", now: 3_000 }));
    const retried = extendTime(closed, { additionalSeconds: 15, idempotencyKey: "extend-0", now: 3_001 });

    expect(retried).toMatchObject({ ok: false, code: "DUPLICATE_HOST_COMMAND", state: closed });
  });

  it("finishes from the leaderboard and emits the final standings", () => {
    const state = createRoomState(roomInput);
    const finished = success(finishGame(state, { idempotencyKey: "finish", now: 2_000 }));

    expect(finished.snapshot.state).toBe("finished");
  });
});
