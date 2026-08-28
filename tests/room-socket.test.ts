import { describe, expect, it, vi } from "vitest";

import { reconnectDelay, RoomSocket } from "../src/lib/room-socket";
import type { ServerMessage } from "../src/domain/protocol";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  listeners: Record<string, Array<(event: { data?: string }) => void>> = { open: [], message: [], close: [] };

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.listeners.open.forEach((listener) => listener({})));
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void) {
    this.listeners[type]?.push(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {}
}

describe("room socket", () => {
  it("caps and jitters reconnect delays", () => {
    expect(reconnectDelay(10, () => 0)).toBe(4_000);
    expect(reconnectDelay(10, () => 1)).toBe(8_000);
    expect(reconnectDelay(0, () => 0)).toBe(125);
  });

  it("sends resume before later messages and ignores stale revisions", async () => {
    FakeWebSocket.instances = [];
    const socket = new RoomSocket({
      url: "ws://localhost/api/rooms/123456/socket",
      resume: { playerId: "p1", reconnectToken: "token" },
      WebSocket: FakeWebSocket as unknown as typeof WebSocket,
      random: () => 0,
      schedule: () => 0,
    });
    const received: ServerMessage[] = [];
    socket.subscribe((message) => received.push(message));
    socket.connect();
    await Promise.resolve();
    const ws = FakeWebSocket.instances[0];
    expect(ws.sent[0]).toContain("player.resume");

    ws.listeners.message.forEach((listener) => listener({
      data: JSON.stringify({
        version: 1,
        roomRevision: 5,
        type: "lobby.updated",
        payload: { snapshot: snapshot(5) },
      }),
    }));
    ws.listeners.message.forEach((listener) => listener({
      data: JSON.stringify({
        version: 1,
        roomRevision: 4,
        type: "lobby.updated",
        payload: { snapshot: snapshot(4) },
      }),
    }));

    expect(received).toHaveLength(1);
    expect(received[0]?.roomRevision).toBe(5);
  });
});

function snapshot(revision: number) {
  return {
    roomCode: "123456",
    revision,
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
}

void vi;
