import { clientMessageSchema, PROTOCOL_VERSION, type ClientMessage, type ServerMessage } from "../src/domain/protocol";
import type { Quiz } from "../src/domain/quiz";
import { verifyHostTicket } from "./auth";
import { createTursoRepository, type PongRepository, type SaveRoundInput } from "./db";
import type { Env } from "./env";
import { createMemoryRepository } from "./memory-db";
import {
  acceptAnswer,
  closeQuestion,
  createRoomState,
  disconnectPlayer,
  extendTime,
  finishGame,
  joinPlayer,
  openQuestion,
  removePlayer,
  resumePlayer,
  revealRound,
  setJoinLocked,
  showLeaderboard,
  advanceQuestion,
  type RoomState,
  type TransitionResult,
} from "./room-state";

const PRIVATE_EVENTS = new Set(["player.welcome", "answer.received"]);
const MAX_PROTOCOL_VIOLATIONS = 3;

export type RoomSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
  readyState?: number;
};

type SocketAttachment = {
  role: "player" | "host" | "display";
  roomCode: string;
  playerId?: string;
  violations: number;
};

type StoredRoom = {
  state: RoomState;
  sessionId: string;
  hostSub: string;
  persistenceWarning: string | null;
  pendingRound: SaveRoundInput | null;
};

export type RoomDeps = {
  now: () => number;
  repository: PongRepository;
  randomUUID: () => string;
  randomToken: () => string;
};

let testRepository: PongRepository | undefined;

export function repositoryFromEnv(env: Env): PongRepository {
  if (env.TURSO_DATABASE_URL && env.TURSO_AUTH_TOKEN) {
    return createTursoRepository(env);
  }
  if (env.PONG_TEST_MODE === "1") {
    testRepository ??= createMemoryRepository();
    return testRepository;
  }
  throw new Error("Turso is not configured.");
}

export class RoomController {
  private readonly now: () => number;
  private readonly repository: PongRepository;
  private readonly randomUUID: () => string;
  private readonly randomToken: () => string;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
    deps: Partial<RoomDeps> = {},
  ) {
    this.now = deps.now ?? (() => Date.now());
    this.repository = deps.repository ?? repositoryFromEnv(env);
    this.randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
    this.randomToken = deps.randomToken ?? randomReconnectToken;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname.endsWith("/init")) {
      const body = await request.json() as { roomCode: string; sessionId: string; hostSub: string; quiz: Quiz };
      await this.init(body);
      return Response.json({ ok: true });
    }
    if (request.method === "GET" && url.pathname.endsWith("/snapshot")) {
      const stored = await this.load();
      if (!stored) return Response.json({ error: "not_found" }, { status: 404 });
      return Response.json({ snapshot: stored.state.snapshot });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      return this.upgrade(request);
    }
    return new Response("Not found", { status: 404 });
  }

  async onSocketOpen(socket: RoomSocket): Promise<void> {
    const stored = await this.load();
    if (!stored) return;
    this.send(socket, envelope(stored.state, "room.snapshot", { snapshot: stored.state.snapshot }));
    if (stored.persistenceWarning && attachment(socket)?.role === "host") {
      this.send(socket, envelope(stored.state, "error", { code: "PERSISTENCE_WARNING", message: stored.persistenceWarning }));
    }
  }

  async onSocketMessage(socket: RoomSocket, raw: string): Promise<void> {
    const stored = await this.load();
    if (!stored) {
      this.send(socket, envelope(null, "error", { code: "INVALID_STATE", message: "This room is not ready." }));
      return;
    }

    let parsed: ClientMessage;
    try {
      parsed = clientMessageSchema.parse(JSON.parse(raw));
    } catch {
      await this.protocolViolation(socket, stored, "That message is not valid.");
      return;
    }

    const meta = attachment(socket);
    if (!meta) {
      this.send(socket, envelope(stored.state, "error", { code: "FORBIDDEN", message: "The socket is not attached to this room." }));
      return;
    }

    if (parsed.type.startsWith("host.") && meta.role !== "host") {
      this.send(socket, envelope(stored.state, "error", { code: "FORBIDDEN", message: "Host commands are not allowed." }));
      return;
    }
    if (parsed.type.startsWith("player.") && meta.role !== "player") {
      this.send(socket, envelope(stored.state, "error", { code: "FORBIDDEN", message: "Player commands are not allowed." }));
      return;
    }
    if (meta.role === "display") {
      this.send(socket, envelope(stored.state, "error", { code: "FORBIDDEN", message: "The display view is read-only." }));
      return;
    }

    if (parsed.type.startsWith("host.")) {
      const ticket = await verifyHostTicket({
        env: this.env,
        ticket: "hostTicket" in parsed.payload ? parsed.payload.hostTicket : "",
        roomCode: stored.state.snapshot.roomCode,
        now: this.now(),
      });
      if (!ticket) {
        this.send(socket, envelope(stored.state, "error", { code: "FORBIDDEN", message: "The host ticket is invalid." }));
        return;
      }
    }

    switch (parsed.type) {
      case "player.join":
        await this.join(socket, stored, parsed.payload.displayName);
        return;
      case "player.resume":
        await this.resume(socket, stored, parsed.payload.playerId, parsed.payload.reconnectToken);
        return;
      case "player.answer":
        await this.answer(socket, stored, parsed.payload);
        return;
      case "host.lock_joining":
        await this.apply(stored, setJoinLocked(stored.state, { locked: parsed.payload.locked, idempotencyKey: parsed.payload.idempotencyKey, now: this.now() }));
        return;
      case "host.remove_player":
        await this.apply(stored, removePlayer(stored.state, { playerId: parsed.payload.playerId, idempotencyKey: parsed.payload.idempotencyKey, now: this.now() }));
        return;
      case "host.open_question":
        await this.apply(stored, openQuestion(stored.state, { questionIndex: parsed.payload.questionIndex, idempotencyKey: parsed.payload.idempotencyKey, now: this.now() }));
        return;
      case "host.extend_time":
        await this.apply(stored, extendTime(stored.state, { additionalSeconds: parsed.payload.additionalSeconds, idempotencyKey: parsed.payload.idempotencyKey, now: this.now() }));
        return;
      case "host.close_question":
        await this.apply(stored, closeQuestion(stored.state, { idempotencyKey: parsed.payload.idempotencyKey, now: this.now() }));
        return;
      case "host.reveal_round":
        await this.apply(stored, revealRound(stored.state, { idempotencyKey: parsed.payload.idempotencyKey, now: this.now() }));
        return;
      case "host.show_leaderboard":
        await this.apply(stored, showLeaderboard(stored.state, { idempotencyKey: parsed.payload.idempotencyKey, now: this.now() }));
        return;
      case "host.next_question":
        await this.apply(stored, advanceQuestion(stored.state, { idempotencyKey: parsed.payload.idempotencyKey, now: this.now() }));
        return;
      case "host.end_game":
        await this.apply(stored, finishGame(stored.state, { idempotencyKey: parsed.payload.idempotencyKey, now: this.now() }));
        return;
      default:
        await this.protocolViolation(socket, stored, "That message is not valid.");
    }
  }

  async onSocketClose(socket: RoomSocket): Promise<void> {
    const stored = await this.load();
    if (!stored) return;
    const meta = attachment(socket);
    if (meta?.role === "player" && meta.playerId) {
      const result = disconnectPlayer(stored.state, { playerId: meta.playerId, now: this.now() });
      if (result.ok) {
        await this.persist({ ...stored, state: result.state });
        this.broadcast(result.events, result.state);
      }
    }
    if (meta?.role === "host") {
      const hosts = this.sockets().filter((item) => item !== socket && attachment(item)?.role === "host" && item.readyState !== 3);
      if (hosts.length === 0) {
        this.broadcast([envelope(stored.state, "room.paused", { reason: "Host disconnected" })], stored.state);
      }
    }
  }

  async onAlarm(): Promise<void> {
    const stored = await this.load();
    if (!stored) return;
    const now = this.now();
    if (stored.state.snapshot.state === "question_open" && stored.state.snapshot.answerDeadline !== null && now >= stored.state.snapshot.answerDeadline) {
      const questionId = stored.state.snapshot.currentQuestion?.id ?? "question";
      await this.apply(stored, closeQuestion(stored.state, {
        idempotencyKey: `timer-close:${questionId}:${stored.state.snapshot.openedAt}`,
        now,
      }));
      return;
    }
    if (stored.pendingRound) {
      await this.persistRound(stored, stored.pendingRound);
    }
  }

  private async init(input: { roomCode: string; sessionId: string; hostSub: string; quiz: Quiz }): Promise<void> {
    const existing = await this.load();
    if (existing) return;
    await this.persist({
      state: createRoomState({ roomCode: input.roomCode, quiz: input.quiz }),
      sessionId: input.sessionId,
      hostSub: input.hostSub,
      persistenceWarning: null,
      pendingRound: null,
    });
  }

  private async join(socket: RoomSocket, stored: StoredRoom, displayName: string): Promise<void> {
    const name = displayName.trim();
    if (name.length < 2 || name.length > 24) {
      this.send(socket, envelope(stored.state, "error", { code: "INVALID_DISPLAY_NAME", message: "Display names must be 2 to 24 characters." }));
      return;
    }
    const playerId = this.randomUUID();
    const reconnectToken = this.randomToken();
    const result = joinPlayer(stored.state, { playerId, displayName: name, reconnectToken, now: this.now() });
    if (!result.ok) {
      this.send(socket, envelope(result.state, "error", { code: result.code, message: result.message }));
      return;
    }
    socket.serializeAttachment({ ...attachment(socket), playerId, violations: 0 });
    await this.persist({ ...stored, state: result.state });
    this.send(socket, envelope(result.state, "player.welcome", {
      playerId,
      reconnectToken,
      displayName: result.player ? result.state.players.find((player) => player.id === playerId)?.displayName ?? name : name,
      avatarSeed: playerId,
    }));
    this.broadcast(result.events, result.state);
  }

  private async resume(socket: RoomSocket, stored: StoredRoom, playerId: string, reconnectToken: string): Promise<void> {
    const result = resumePlayer(stored.state, { playerId, reconnectToken, now: this.now() });
    if (!result.ok) {
      this.send(socket, envelope(result.state, "error", { code: result.code, message: result.message }));
      return;
    }
    socket.serializeAttachment({ ...attachment(socket), playerId, violations: 0 });
    await this.persist({ ...stored, state: result.state });
    this.broadcast(result.events, result.state, socket);
  }

  private async answer(socket: RoomSocket, stored: StoredRoom, payload: Extract<ClientMessage, { type: "player.answer" }>["payload"]): Promise<void> {
    const playerId = attachment(socket)?.playerId;
    if (!playerId) {
      this.send(socket, envelope(stored.state, "error", { code: "PLAYER_NOT_FOUND", message: "Join the room before answering." }));
      return;
    }
    const result = acceptAnswer(stored.state, {
      playerId,
      questionId: payload.questionId,
      answerIndex: payload.answerIndex,
      idempotencyKey: payload.idempotencyKey,
      now: this.now(),
    });
    if (!result.ok) {
      this.send(socket, envelope(result.state, "error", { code: result.code, message: result.message }));
      return;
    }
    await this.persist({ ...stored, state: result.state });
    for (const event of result.events) this.send(socket, event);
  }

  private async apply(stored: StoredRoom, result: TransitionResult): Promise<void> {
    if (!result.ok) {
      this.broadcast([envelope(result.state, "error", { code: result.code, message: result.message })], result.state, undefined, "host");
      return;
    }
    let next: StoredRoom = { ...stored, state: result.state };
    await this.persist(next);
    await this.scheduleAlarm(next.state);
    this.broadcast(result.events, result.state);
    if (result.events.some((event) => event.type === "question.closed")) {
      const pending = roundRecord(next);
      this.ctx.waitUntil(this.persistRound(next, pending));
    }
    if (result.events.some((event) => event.type === "game.finished")) {
      this.ctx.waitUntil(this.repository.finishSession({
        sessionId: stored.sessionId,
        finishedAt: this.now(),
        players: result.state.players.filter((player) => !player.removed).map((player) => ({
          playerId: player.id,
          displayName: player.displayName,
          avatarSeed: player.id,
          tokenHash: player.reconnectTokenHash,
          score: player.score,
          streak: player.streak,
          connected: player.connected,
          lastSeenAt: this.now(),
        })),
      }).catch(() => undefined));
    }
  }

  private async persistRound(stored: StoredRoom, input: SaveRoundInput): Promise<void> {
    try {
      await this.repository.saveRound(input);
      const current = await this.load();
      if (current) {
        await this.persist({ ...current, persistenceWarning: null, pendingRound: null });
      }
    } catch {
      const current = await this.load() ?? stored;
      const warning = "Scores are live, but saving this round failed. Retrying.";
      await this.persist({ ...current, persistenceWarning: warning, pendingRound: input });
      this.broadcast([envelope(current.state, "error", { code: "PERSISTENCE_WARNING", message: warning })], current.state, undefined, "host");
      await this.ctx.storage.setAlarm(this.now() + 1_000);
    }
  }

  private async persist(stored: StoredRoom): Promise<void> {
    await this.ctx.storage.put("room", JSON.parse(JSON.stringify(stored)));
  }

  private async load(): Promise<StoredRoom | null> {
    return (await this.ctx.storage.get<StoredRoom>("room")) ?? null;
  }

  private async scheduleAlarm(state: RoomState): Promise<void> {
    if (state.snapshot.state === "question_open" && state.snapshot.answerDeadline !== null) {
      await this.ctx.storage.setAlarm(state.snapshot.answerDeadline);
    }
  }

  private async upgrade(request: Request): Promise<Response> {
    const stored = await this.load();
    if (!stored) return new Response("Room not found", { status: 404 });
    const url = new URL(request.url);
    const role = url.searchParams.get("role") === "host" ? "host" : url.searchParams.get("role") === "display" ? "display" : "player";
    if (role === "host") {
      const ticket = await verifyHostTicket({
        env: this.env,
        ticket: url.searchParams.get("ticket") ?? "",
        roomCode: stored.state.snapshot.roomCode,
        now: this.now(),
      });
      if (!ticket) return new Response("Forbidden", { status: 403 });
    }
    if (typeof WebSocketPair === "undefined") {
      return new Response("WebSocket upgrade is not available.", { status: 426 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    pair[1].serializeAttachment({ role, roomCode: stored.state.snapshot.roomCode, violations: 0 } satisfies SocketAttachment);
    this.ctx.waitUntil(this.onSocketOpen(pair[1] as unknown as RoomSocket));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  private async protocolViolation(socket: RoomSocket, stored: StoredRoom, message: string): Promise<void> {
    const meta = attachment(socket) ?? { role: "player" as const, roomCode: stored.state.snapshot.roomCode, violations: 0 };
    const violations = meta.violations + 1;
    socket.serializeAttachment({ ...meta, violations });
    this.send(socket, envelope(stored.state, "error", { code: "PROTOCOL", message }));
    if (violations >= MAX_PROTOCOL_VIOLATIONS) socket.close(1002, "Protocol error");
  }

  private sockets(): RoomSocket[] {
    return this.ctx.getWebSockets() as unknown as RoomSocket[];
  }

  private broadcast(events: ServerMessage[], state: RoomState, only?: RoomSocket, role?: SocketAttachment["role"]): void {
    for (const event of events) {
      if (PRIVATE_EVENTS.has(event.type) && !only) continue;
      for (const socket of only ? [only] : this.sockets()) {
        if (socket.readyState === 3) continue;
        const meta = attachment(socket);
        if (role && meta?.role !== role) continue;
        if (event.type === "error" && event.payload.code === "PERSISTENCE_WARNING" && meta?.role !== "host") continue;
        this.send(socket, event.type === "room.snapshot" || event.type === "lobby.updated"
          ? { ...event, payload: { snapshot: state.snapshot } }
          : event);
      }
    }
  }

  private send(socket: RoomSocket, event: ServerMessage): void {
    socket.send(JSON.stringify(event));
  }
}

export class PongRoom implements DurableObject {
  private readonly controller: RoomController;

  constructor(ctx: DurableObjectState, env: Env) {
    this.controller = new RoomController(ctx, env);
  }

  fetch(request: Request): Promise<Response> {
    return this.controller.fetch(request);
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === "string" ? message : new TextDecoder().decode(message);
    await this.controller.onSocketMessage(ws as unknown as RoomSocket, raw);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.controller.onSocketClose(ws as unknown as RoomSocket);
  }

  async alarm(): Promise<void> {
    await this.controller.onAlarm();
  }
}

function attachment(socket: RoomSocket): SocketAttachment | null {
  const value = socket.deserializeAttachment();
  if (!value || typeof value !== "object") return null;
  return value as SocketAttachment;
}

function envelope(state: RoomState | null, type: ServerMessage["type"], payload: unknown): ServerMessage {
  return {
    version: PROTOCOL_VERSION,
    roomRevision: state?.snapshot.revision ?? 0,
    type,
    payload,
  } as ServerMessage;
}

function roundRecord(stored: StoredRoom): SaveRoundInput {
  const questionId = stored.state.snapshot.currentQuestion?.id ?? stored.state.quiz.questions[stored.state.snapshot.currentQuestionIndex ?? 0]?.id ?? "question";
  const roundAnswers = stored.state.answers[questionId] ?? {};
  return {
    sessionId: stored.sessionId,
    questionId,
    answers: Object.entries(roundAnswers).map(([playerId, answer]) => ({
      playerId,
      answerIndex: answer.answerIndex,
      receivedAt: answer.receivedAt,
      responseMs: answer.responseMs,
      correct: answer.correct,
      points: answer.points,
      idempotencyKey: answer.idempotencyKey,
    })),
    players: stored.state.players.filter((player) => !player.removed).map((player) => ({
      playerId: player.id,
      displayName: player.displayName,
      avatarSeed: player.id,
      tokenHash: player.reconnectTokenHash,
      score: player.score,
      streak: player.streak,
      connected: player.connected,
      lastSeenAt: player.disconnectedAt ?? stored.state.snapshot.openedAt ?? 0,
    })),
  };
}

function randomReconnectToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
