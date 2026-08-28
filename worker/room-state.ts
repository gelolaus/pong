import type { Quiz } from "../src/domain/quiz";
import type { RoomSnapshot, RoomState as RoomPhase, ServerMessage } from "../src/domain/protocol";
import { scoreAnswer } from "../src/domain/scoring";

export type RoomErrorCode =
  | "ANSWER_CLOSED"
  | "ANSWER_LATE"
  | "DUPLICATE_ANSWER"
  | "DUPLICATE_HOST_COMMAND"
  | "INVALID_ANSWER"
  | "INVALID_QUESTION"
  | "INVALID_RECONNECT_TOKEN"
  | "INVALID_STATE"
  | "JOIN_LOCKED"
  | "PLAYER_EXISTS"
  | "PLAYER_NOT_FOUND"
  | "PLAYER_REMOVED";

export interface AcceptedAnswer {
  readonly answerIndex: number;
  readonly receivedAt: number;
  readonly responseMs: number;
  readonly correct: boolean;
  readonly points: number;
  readonly idempotencyKey: string;
}

export interface PlayerState {
  readonly id: string;
  readonly originalDisplayName: string;
  readonly displayName: string;
  readonly reconnectTokenHash: string;
  readonly score: number;
  readonly streak: number;
  readonly connected: boolean;
  readonly disconnectedAt: number | null;
  readonly joinOrder: number;
  readonly rank: number | null;
  readonly rankMovement: number;
  readonly totalResponseMs: number;
  readonly responseCount: number;
  readonly removed: boolean;
}

export interface RoomState {
  readonly quiz: Quiz;
  readonly snapshot: RoomSnapshot;
  readonly players: readonly PlayerState[];
  readonly answers: Readonly<Record<string, Readonly<Record<string, AcceptedAnswer>>>>;
  readonly hostIdempotencyKeys: readonly string[];
}

export type TransitionResult =
  | { ok: true; state: RoomState; events: ServerMessage[] }
  | { ok: false; state: RoomState; code: RoomErrorCode; message: string };

export type JoinResult =
  | { ok: true; state: RoomState; events: ServerMessage[]; player: { id: string; reconnectToken: string } }
  | { ok: false; state: RoomState; code: RoomErrorCode; message: string };

interface CreateRoomInput {
  roomCode: string;
  quiz: Quiz;
  joinLocked?: boolean;
}

interface HostInput {
  idempotencyKey: string;
  now: number;
}

interface StateParts {
  quiz: Quiz;
  roomCode: string;
  revision: number;
  phase: RoomPhase;
  joinLocked: boolean;
  currentQuestionIndex: number | null;
  openedAt: number | null;
  baseDeadline: number | null;
  answerDeadline: number | null;
  players: readonly PlayerState[];
  answers: Readonly<Record<string, Readonly<Record<string, AcceptedAnswer>>>>;
  hostIdempotencyKeys: readonly string[];
}

const AWAY_AFTER_MS = 30_000;

export function createRoomState({ roomCode, quiz, joinLocked = false }: CreateRoomInput): RoomState {
  return makeState({
    quiz: copyQuiz(quiz),
    roomCode,
    revision: 0,
    phase: "lobby",
    joinLocked,
    currentQuestionIndex: null,
    openedAt: null,
    baseDeadline: null,
    answerDeadline: null,
    players: [],
    answers: {},
    hostIdempotencyKeys: [],
  });
}

export function joinPlayer(
  state: RoomState,
  input: { playerId: string; displayName: string; reconnectToken: string; now: number },
): JoinResult {
  if (state.snapshot.state !== "lobby") {
    return joinFailure(state, "INVALID_STATE", "Players can only join while the room is in the lobby.");
  }
  if (state.snapshot.joinLocked) {
    return joinFailure(state, "JOIN_LOCKED", "Joining is locked.");
  }
  if (state.players.some((player) => player.id === input.playerId)) {
    return joinFailure(state, "PLAYER_EXISTS", "That player ID already belongs to this room.");
  }

  const originalDisplayName = input.displayName.trim();
  const player: PlayerState = {
    id: input.playerId,
    originalDisplayName,
    displayName: uniqueDisplayName(state.players, originalDisplayName),
    reconnectTokenHash: sha256(input.reconnectToken),
    score: 0,
    streak: 0,
    connected: true,
    disconnectedAt: null,
    joinOrder: state.players.length,
    rank: null,
    rankMovement: 0,
    totalResponseMs: 0,
    responseCount: 0,
    removed: false,
  };
  const next = makeState(nextParts(state, { players: [...state.players, player] }));

  return {
    ok: true,
    state: next,
    events: [lobbyUpdated(next)],
    player: { id: input.playerId, reconnectToken: input.reconnectToken },
  };
}

export function resumePlayer(
  state: RoomState,
  input: { playerId: string; reconnectToken: string; now: number },
): TransitionResult {
  const player = findPlayer(state, input.playerId);
  if (!player) {
    return failure(state, "PLAYER_NOT_FOUND", "The player does not belong to this room.");
  }
  if (player.removed) {
    return failure(state, "PLAYER_REMOVED", "This player has been removed from the room.");
  }
  if (player.reconnectTokenHash !== sha256(input.reconnectToken)) {
    return failure(state, "INVALID_RECONNECT_TOKEN", "The reconnect token is invalid.");
  }

  const next = makeState(nextParts(state, {
    players: replacePlayer(state.players, { ...player, connected: true, disconnectedAt: null }),
  }));
  return success(next, [snapshotEvent(next)]);
}

export function disconnectPlayer(
  state: RoomState,
  input: { playerId: string; now: number },
): TransitionResult {
  const player = findPlayer(state, input.playerId);
  if (!player || player.removed) {
    return failure(state, "PLAYER_NOT_FOUND", "The player does not belong to this active room.");
  }
  if (!player.connected) {
    return failure(state, "INVALID_STATE", "The player is already disconnected.");
  }

  const next = makeState(nextParts(state, {
    players: replacePlayer(state.players, { ...player, connected: false, disconnectedAt: input.now }),
  }));
  return success(next, [snapshotEvent(next)]);
}

export function isPlayerAway(state: RoomState, playerId: string, now: number): boolean {
  const player = findPlayer(state, playerId);
  return Boolean(player && !player.connected && player.disconnectedAt !== null && now - player.disconnectedAt >= AWAY_AFTER_MS);
}

export function setJoinLocked(
  state: RoomState,
  input: HostInput & { locked: boolean },
): TransitionResult {
  const duplicate = duplicateHostCommand(state, input.idempotencyKey);
  if (duplicate) return duplicate;
  if (state.snapshot.state !== "lobby") {
    return failure(state, "INVALID_STATE", "Joining can only be changed in the lobby.");
  }

  const next = makeState(nextParts(state, {
    joinLocked: input.locked,
    hostIdempotencyKeys: [...state.hostIdempotencyKeys, input.idempotencyKey],
  }));
  return success(next, [lobbyUpdated(next)]);
}

export function removePlayer(
  state: RoomState,
  input: HostInput & { playerId: string },
): TransitionResult {
  const duplicate = duplicateHostCommand(state, input.idempotencyKey);
  if (duplicate) return duplicate;
  const player = findPlayer(state, input.playerId);
  if (!player || player.removed) {
    return failure(state, "PLAYER_NOT_FOUND", "The player does not belong to this active room.");
  }

  const next = makeState(nextParts(state, {
    players: replacePlayer(state.players, { ...player, connected: false, disconnectedAt: input.now, removed: true }),
    hostIdempotencyKeys: [...state.hostIdempotencyKeys, input.idempotencyKey],
  }));
  return success(next, [lobbyUpdated(next)]);
}

export function openQuestion(
  state: RoomState,
  input: HostInput & { questionIndex: number },
): TransitionResult {
  const duplicate = duplicateHostCommand(state, input.idempotencyKey);
  if (duplicate) return duplicate;
  if (state.snapshot.state !== "lobby" && state.snapshot.state !== "leaderboard") {
    return failure(state, "INVALID_STATE", "A question can only open from the lobby or leaderboard.");
  }
  const question = state.quiz.questions[input.questionIndex];
  if (!question) {
    return failure(state, "INVALID_QUESTION", "The requested question does not exist.");
  }

  const baseDeadline = input.now + question.timerSeconds * 1_000;
  const next = makeState(nextParts(state, {
    phase: "question_open",
    currentQuestionIndex: input.questionIndex,
    openedAt: input.now,
    baseDeadline,
    answerDeadline: baseDeadline,
    hostIdempotencyKeys: [...state.hostIdempotencyKeys, input.idempotencyKey],
  }));
  return success(next, [message(next, "question.opened", {
    question: publicQuestion(question),
    openedAt: input.now,
    baseDeadline,
    answerDeadline: baseDeadline,
  })]);
}

export function extendTime(
  state: RoomState,
  input: HostInput & { additionalSeconds: number },
): TransitionResult {
  const duplicate = duplicateHostCommand(state, input.idempotencyKey);
  if (duplicate) return duplicate;
  if (state.snapshot.state !== "question_open" || state.snapshot.answerDeadline === null) {
    return failure(state, "INVALID_STATE", "Time can only be extended while a question is open.");
  }
  if (input.additionalSeconds !== 15) {
    return failure(state, "INVALID_QUESTION", "Only 15 seconds can be added to a question.");
  }

  const next = makeState(nextParts(state, {
    answerDeadline: state.snapshot.answerDeadline + input.additionalSeconds * 1_000,
    hostIdempotencyKeys: [...state.hostIdempotencyKeys, input.idempotencyKey],
  }));
  return success(next, [snapshotEvent(next)]);
}

export function closeQuestion(state: RoomState, input: HostInput): TransitionResult {
  const duplicate = duplicateHostCommand(state, input.idempotencyKey);
  if (duplicate) return duplicate;
  if (state.snapshot.state !== "question_open") {
    return failure(state, "INVALID_STATE", "Answers are not open.");
  }

  const next = makeState(nextParts(state, {
    phase: "question_closed",
    hostIdempotencyKeys: [...state.hostIdempotencyKeys, input.idempotencyKey],
  }));
  return success(next, [message(next, "question.closed", { closedAt: input.now })]);
}

export function acceptAnswer(
  state: RoomState,
  input: { playerId: string; questionId: string; answerIndex: number; idempotencyKey: string; now: number },
): TransitionResult {
  if (state.snapshot.state !== "question_open" || state.snapshot.currentQuestionIndex === null || state.snapshot.openedAt === null || state.snapshot.baseDeadline === null || state.snapshot.answerDeadline === null) {
    return failure(state, "ANSWER_CLOSED", "Answers are closed.");
  }
  if (input.now > state.snapshot.answerDeadline) {
    return failure(state, "ANSWER_LATE", "The answer deadline has passed.");
  }
  const player = findPlayer(state, input.playerId);
  if (!player || player.removed) {
    return failure(state, "PLAYER_NOT_FOUND", "The player does not belong to this active room.");
  }
  const question = state.quiz.questions[state.snapshot.currentQuestionIndex];
  if (question.id !== input.questionId) {
    return failure(state, "INVALID_QUESTION", "The answer does not match the current question.");
  }
  if (input.answerIndex < 0 || input.answerIndex >= question.answers.length) {
    return failure(state, "INVALID_ANSWER", "The answer index is invalid for this question.");
  }
  if (state.answers[input.questionId]?.[input.playerId]) {
    return failure(state, "DUPLICATE_ANSWER", "Only the first answer is accepted.");
  }

  const responseMs = Math.max(0, input.now - state.snapshot.openedAt);
  const answer: AcceptedAnswer = {
    answerIndex: input.answerIndex,
    receivedAt: input.now,
    responseMs,
    correct: input.answerIndex === question.correctIndex,
    points: scoreAnswer({
      correct: input.answerIndex === question.correctIndex,
      responseMs,
      baseDurationMs: state.snapshot.baseDeadline - state.snapshot.openedAt,
    }),
    idempotencyKey: input.idempotencyKey,
  };
  const answers = {
    ...state.answers,
    [input.questionId]: { ...state.answers[input.questionId], [input.playerId]: answer },
  };
  const next = makeState(nextParts(state, { answers }));
  return success(next, [message(next, "answer.received", {
    questionId: input.questionId,
    answerIndex: input.answerIndex,
    receivedAt: input.now,
  })]);
}

export function revealRound(state: RoomState, input: HostInput): TransitionResult {
  const duplicate = duplicateHostCommand(state, input.idempotencyKey);
  if (duplicate) return duplicate;
  if (state.snapshot.state !== "question_closed" || state.snapshot.currentQuestionIndex === null) {
    return failure(state, "INVALID_STATE", "A closed question is required before revealing the round.");
  }
  const question = state.quiz.questions[state.snapshot.currentQuestionIndex];
  const roundAnswers = state.answers[question.id] ?? {};
  const scoredPlayers = state.players.map((player) => {
    if (player.removed) return player;
    const answer = roundAnswers[player.id];
    return {
      ...player,
      score: player.score + (answer?.points ?? 0),
      streak: answer?.correct ? player.streak + 1 : 0,
      totalResponseMs: player.totalResponseMs + (answer?.responseMs ?? 0),
      responseCount: player.responseCount + (answer ? 1 : 0),
    };
  });
  const rankedPlayers = rankPlayers(scoredPlayers);
  const next = makeState(nextParts(state, {
    phase: "round_reveal",
    players: rankedPlayers,
    hostIdempotencyKeys: [...state.hostIdempotencyKeys, input.idempotencyKey],
  }));
  return success(next, [message(next, "round.revealed", {
    questionId: question.id,
    correctIndex: question.correctIndex,
    explanation: question.explanation,
    standings: next.snapshot.players,
  })]);
}

export function showLeaderboard(state: RoomState, input: HostInput): TransitionResult {
  const duplicate = duplicateHostCommand(state, input.idempotencyKey);
  if (duplicate) return duplicate;
  if (state.snapshot.state !== "round_reveal") {
    return failure(state, "INVALID_STATE", "A round must be revealed before showing the leaderboard.");
  }
  const next = makeState(nextParts(state, {
    phase: "leaderboard",
    hostIdempotencyKeys: [...state.hostIdempotencyKeys, input.idempotencyKey],
  }));
  return success(next, [message(next, "leaderboard.updated", { standings: next.snapshot.players })]);
}

export function advanceQuestion(state: RoomState, input: HostInput): TransitionResult {
  const duplicate = duplicateHostCommand(state, input.idempotencyKey);
  if (duplicate) return duplicate;
  if (state.snapshot.state !== "leaderboard") {
    return failure(state, "INVALID_STATE", "The leaderboard must be visible before advancing.");
  }
  const next = makeState(nextParts(state, {
    phase: "lobby",
    currentQuestionIndex: null,
    openedAt: null,
    baseDeadline: null,
    answerDeadline: null,
    hostIdempotencyKeys: [...state.hostIdempotencyKeys, input.idempotencyKey],
  }));
  return success(next, [snapshotEvent(next)]);
}

export function finishGame(state: RoomState, input: HostInput): TransitionResult {
  const duplicate = duplicateHostCommand(state, input.idempotencyKey);
  if (duplicate) return duplicate;
  if (state.snapshot.state === "finished") {
    return failure(state, "INVALID_STATE", "The game has already finished.");
  }
  const next = makeState(nextParts(state, {
    phase: "finished",
    players: rankPlayers(state.players),
    hostIdempotencyKeys: [...state.hostIdempotencyKeys, input.idempotencyKey],
  }));
  return success(next, [message(next, "game.finished", { standings: next.snapshot.players })]);
}

function nextParts(state: RoomState, changes: Partial<StateParts>): StateParts {
  return {
    quiz: state.quiz,
    roomCode: state.snapshot.roomCode,
    revision: state.snapshot.revision + 1,
    phase: state.snapshot.state,
    joinLocked: state.snapshot.joinLocked,
    currentQuestionIndex: state.snapshot.currentQuestionIndex,
    openedAt: state.snapshot.openedAt,
    baseDeadline: state.snapshot.baseDeadline,
    answerDeadline: state.snapshot.answerDeadline,
    players: state.players,
    answers: state.answers,
    hostIdempotencyKeys: state.hostIdempotencyKeys,
    ...changes,
  };
}

function makeState(parts: StateParts): RoomState {
  const currentQuestion = parts.currentQuestionIndex === null ? null : publicQuestion(parts.quiz.questions[parts.currentQuestionIndex]);
  const players = parts.players.filter((player) => !player.removed).sort(playerOrder).map((player) => ({
    id: player.id,
    displayName: player.displayName,
    score: player.score,
    streak: player.streak,
    connected: player.connected,
    rank: player.rank,
    rankMovement: player.rankMovement,
  }));
  const snapshot: RoomSnapshot = {
    roomCode: parts.roomCode,
    revision: parts.revision,
    state: parts.phase,
    quizTitle: parts.quiz.title,
    joinLocked: parts.joinLocked,
    currentQuestionIndex: parts.currentQuestionIndex,
    currentQuestion,
    openedAt: parts.openedAt,
    baseDeadline: parts.baseDeadline,
    answerDeadline: parts.answerDeadline,
    players,
  };
  return deepFreeze({
    quiz: parts.quiz,
    snapshot,
    players: [...parts.players],
    answers: parts.answers,
    hostIdempotencyKeys: [...parts.hostIdempotencyKeys],
  });
}

function rankPlayers(players: readonly PlayerState[]): PlayerState[] {
  const active = players.filter((player) => !player.removed).sort((left, right) =>
    right.score - left.score
    || Number(left.responseCount === 0) - Number(right.responseCount === 0)
    || left.totalResponseMs - right.totalResponseMs
    || left.joinOrder - right.joinOrder,
  );
  const ranks = new Map(active.map((player, index) => [player.id, index + 1]));
  return players.map((player) => {
    if (player.removed) return player;
    const rank = ranks.get(player.id) ?? null;
    return { ...player, rank, rankMovement: player.rank === null || rank === null ? 0 : player.rank - rank };
  });
}

function playerOrder(left: PlayerState, right: PlayerState): number {
  if (left.rank !== null && right.rank !== null) return left.rank - right.rank;
  if (left.rank !== null) return -1;
  if (right.rank !== null) return 1;
  return left.joinOrder - right.joinOrder;
}

function publicQuestion(question: Quiz["questions"][number]) {
  return {
    id: question.id,
    prompt: question.prompt,
    ...(question.imageUrl ? { imageUrl: question.imageUrl } : {}),
    answers: [...question.answers],
    timerSeconds: question.timerSeconds,
  };
}

function uniqueDisplayName(players: readonly PlayerState[], originalDisplayName: string): string {
  const activeNames = new Set(players.filter((player) => !player.removed).map((player) => player.displayName.toLocaleLowerCase()));
  if (!activeNames.has(originalDisplayName.toLocaleLowerCase())) return originalDisplayName;

  for (let suffix = 2; ; suffix++) {
    const candidate = `${originalDisplayName} ${suffix}`;
    if (!activeNames.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

function findPlayer(state: RoomState, playerId: string): PlayerState | undefined {
  return state.players.find((player) => player.id === playerId);
}

function replacePlayer(players: readonly PlayerState[], replacement: PlayerState): PlayerState[] {
  return players.map((player) => player.id === replacement.id ? replacement : player);
}

function duplicateHostCommand(state: RoomState, idempotencyKey: string): TransitionResult | null {
  return state.hostIdempotencyKeys.includes(idempotencyKey)
    ? failure(state, "DUPLICATE_HOST_COMMAND", "This host command has already been applied.")
    : null;
}

function success(state: RoomState, events: ServerMessage[]): TransitionResult {
  return { ok: true, state, events };
}

function failure(state: RoomState, code: RoomErrorCode, message: string): TransitionResult {
  return { ok: false, state, code, message };
}

function joinFailure(state: RoomState, code: RoomErrorCode, message: string): JoinResult {
  return { ok: false, state, code, message };
}

function snapshotEvent(state: RoomState): ServerMessage {
  return message(state, "room.snapshot", { snapshot: state.snapshot });
}

function lobbyUpdated(state: RoomState): ServerMessage {
  return message(state, "lobby.updated", { snapshot: state.snapshot });
}

function message(state: RoomState, type: ServerMessage["type"], payload: unknown): ServerMessage {
  return { version: 1, roomRevision: state.snapshot.revision, type, payload } as ServerMessage;
}

function copyQuiz(quiz: Quiz): Quiz {
  return {
    ...quiz,
    questions: quiz.questions.map((question) => ({ ...question, answers: [...question.answers] })),
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function sha256(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);

  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index++) {
      const left = words[index - 15];
      const right = words[index - 2];
      const sigma0 = rotateRight(left, 7) ^ rotateRight(left, 18) ^ (left >>> 3);
      const sigma1 = rotateRight(right, 17) ^ rotateRight(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index++) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choice + constants[index] + words[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0; hash[1] = (hash[1] + b) >>> 0; hash[2] = (hash[2] + c) >>> 0; hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0; hash[5] = (hash[5] + f) >>> 0; hash[6] = (hash[6] + g) >>> 0; hash[7] = (hash[7] + h) >>> 0;
  }
  return hash.map((part) => part.toString(16).padStart(8, "0")).join("");
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}
