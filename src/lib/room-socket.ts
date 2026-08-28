import type { ClientMessage, ServerMessage } from "../domain/protocol";
import { serverMessageSchema } from "../domain/protocol";

const ALWAYS_APPLY = new Set(["player.welcome", "answer.received", "error", "room.paused"]);

export type RoomSocketOptions = {
  url: string;
  resume?: { playerId: string; reconnectToken: string } | null;
  join?: { displayName: string } | null;
  WebSocket?: typeof WebSocket;
  random?: () => number;
  schedule?: (callback: () => void, delayMs: number) => number;
};

export function reconnectDelay(attempt: number, random = Math.random): number {
  const base = Math.min(8_000, 250 * 2 ** Math.max(0, attempt));
  return base / 2 + random() * (base / 2);
}

export class RoomSocket {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private revision = -1;
  private closed = false;
  private resume: RoomSocketOptions["resume"];
  private join: RoomSocketOptions["join"];
  private readonly listeners = new Set<(message: ServerMessage) => void>();
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly random: () => number;
  private readonly schedule: (callback: () => void, delayMs: number) => number;

  constructor(private readonly options: RoomSocketOptions) {
    this.resume = options.resume ?? null;
    this.join = options.join ?? null;
    this.WebSocketImpl = options.WebSocket ?? WebSocket;
    this.random = options.random ?? Math.random;
    this.schedule = options.schedule ?? ((callback, delayMs) => window.setTimeout(callback, delayMs));
  }

  setIdentity(resume: { playerId: string; reconnectToken: string }) {
    this.resume = resume;
    this.join = null;
  }

  connect() {
    if (this.closed) return;
    this.ws = new this.WebSocketImpl(this.options.url);
    this.ws.addEventListener("open", () => {
      this.attempt = 0;
      if (this.resume) {
        this.send({
          version: 1,
          roomRevision: Math.max(0, this.revision),
          type: "player.resume",
          payload: this.resume,
        });
      } else if (this.join) {
        this.send({
          version: 1,
          roomRevision: Math.max(0, this.revision),
          type: "player.join",
          payload: { displayName: this.join.displayName },
        });
      }
    });
    this.ws.addEventListener("message", (event) => {
      const message = parseMessage(String(event.data));
      if (!message) return;
      if (message.type === "room.snapshot") {
        if (message.roomRevision < this.revision) return;
        this.revision = message.roomRevision;
        this.emit(message);
        return;
      }
      if (!ALWAYS_APPLY.has(message.type) && message.roomRevision <= this.revision) return;
      if (message.roomRevision > this.revision) this.revision = message.roomRevision;
      this.emit(message);
    });
    this.ws.addEventListener("close", () => {
      if (this.closed) return;
      const delay = reconnectDelay(this.attempt, this.random);
      this.attempt += 1;
      this.schedule(() => this.connect(), delay);
    });
  }

  send(message: ClientMessage) {
    this.ws?.send(JSON.stringify(message));
  }

  subscribe(listener: (message: ServerMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    this.closed = true;
    this.ws?.close();
  }

  private emit(message: ServerMessage) {
    for (const listener of this.listeners) listener(message);
  }
}

function parseMessage(raw: string): ServerMessage | null {
  try {
    return serverMessageSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function roomSocketUrl(code: string, params: Record<string, string> = {}): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/api/rooms/${code}/socket`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}
