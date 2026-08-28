import { z } from "zod";

export const PROTOCOL_VERSION = 1;

const versionSchema = z.literal(PROTOCOL_VERSION);
const revisionSchema = z.number().int().nonnegative();
const idempotencyKeySchema = z.string().min(1).max(256);
const timestampSchema = z.number().int().nonnegative();
const roomStateSchema = z.enum([
  "lobby",
  "question_open",
  "question_closed",
  "round_reveal",
  "leaderboard",
  "finished",
]);

const publicQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1),
  imageUrl: z.string().url().optional(),
  answers: z.array(z.string().min(1)).min(2).max(4),
  timerSeconds: z.number().int().min(5).max(120),
}).strict();

const playerSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  score: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
  connected: z.boolean(),
  rank: z.number().int().positive().nullable(),
  rankMovement: z.number().int(),
});

export const roomSnapshotSchema = z.object({
  roomCode: z.string().regex(/^\d{6}$/),
  revision: revisionSchema,
  state: roomStateSchema,
  quizTitle: z.string().min(1),
  joinLocked: z.boolean(),
  currentQuestionIndex: z.number().int().nonnegative().nullable(),
  currentQuestion: publicQuestionSchema.nullable(),
  openedAt: timestampSchema.nullable(),
  baseDeadline: timestampSchema.nullable(),
  answerDeadline: timestampSchema.nullable(),
  players: z.array(playerSchema),
});

const hostCommandPayload = z.object({
  hostTicket: z.string().min(1),
  idempotencyKey: idempotencyKeySchema,
});

const clientEnvelope = z.object({
  version: versionSchema,
  roomRevision: revisionSchema,
});

export const clientMessageSchema = z.discriminatedUnion("type", [
  clientEnvelope.extend({
    type: z.literal("player.join"),
    payload: z.object({ displayName: z.string().trim().min(1).max(80) }),
  }),
  clientEnvelope.extend({
    type: z.literal("player.resume"),
    payload: z.object({ playerId: z.string().min(1), reconnectToken: z.string().min(1) }),
  }),
  clientEnvelope.extend({
    type: z.literal("player.answer"),
    payload: z.object({
      questionId: z.string().min(1),
      answerIndex: z.number().int().nonnegative(),
      idempotencyKey: idempotencyKeySchema,
    }),
  }),
  clientEnvelope.extend({
    type: z.literal("host.lock_joining"),
    payload: hostCommandPayload.extend({ locked: z.boolean() }),
  }),
  clientEnvelope.extend({
    type: z.literal("host.remove_player"),
    payload: hostCommandPayload.extend({ playerId: z.string().min(1) }),
  }),
  clientEnvelope.extend({
    type: z.literal("host.open_question"),
    payload: hostCommandPayload.extend({ questionIndex: z.number().int().nonnegative() }),
  }),
  clientEnvelope.extend({
    type: z.literal("host.extend_time"),
    payload: hostCommandPayload.extend({ additionalSeconds: z.literal(15) }),
  }),
  clientEnvelope.extend({ type: z.literal("host.close_question"), payload: hostCommandPayload }),
  clientEnvelope.extend({ type: z.literal("host.reveal_round"), payload: hostCommandPayload }),
  clientEnvelope.extend({ type: z.literal("host.show_leaderboard"), payload: hostCommandPayload }),
  clientEnvelope.extend({ type: z.literal("host.next_question"), payload: hostCommandPayload }),
  clientEnvelope.extend({ type: z.literal("host.end_game"), payload: hostCommandPayload }),
]);

const serverEnvelope = z.object({ version: versionSchema, roomRevision: revisionSchema });
const standingsSchema = z.array(playerSchema);

export const serverMessageSchema = z.discriminatedUnion("type", [
  serverEnvelope.extend({ type: z.literal("room.snapshot"), payload: z.object({ snapshot: roomSnapshotSchema }) }),
  serverEnvelope.extend({ type: z.literal("lobby.updated"), payload: z.object({ snapshot: roomSnapshotSchema }) }),
  serverEnvelope.extend({
    type: z.literal("question.opened"),
    payload: z.object({
      question: publicQuestionSchema,
      openedAt: timestampSchema,
      baseDeadline: timestampSchema,
      answerDeadline: timestampSchema,
    }),
  }),
  serverEnvelope.extend({ type: z.literal("question.closed"), payload: z.object({ closedAt: timestampSchema }) }),
  serverEnvelope.extend({
    type: z.literal("answer.received"),
    payload: z.object({ questionId: z.string().min(1), answerIndex: z.number().int().nonnegative(), receivedAt: timestampSchema }),
  }),
  serverEnvelope.extend({
    type: z.literal("round.revealed"),
    payload: z.object({
      questionId: z.string().min(1),
      correctIndex: z.number().int().nonnegative(),
      explanation: z.string().min(1),
      standings: standingsSchema,
    }),
  }),
  serverEnvelope.extend({ type: z.literal("leaderboard.updated"), payload: z.object({ standings: standingsSchema }) }),
  serverEnvelope.extend({ type: z.literal("game.finished"), payload: z.object({ standings: standingsSchema }) }),
  serverEnvelope.extend({ type: z.literal("room.paused"), payload: z.object({ reason: z.string().min(1) }) }),
  serverEnvelope.extend({ type: z.literal("error"), payload: z.object({ code: z.string().min(1), message: z.string().min(1) }) }),
]);

export type RoomState = z.infer<typeof roomStateSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ServerMessage = z.infer<typeof serverMessageSchema>;
