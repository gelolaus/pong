import { describe, expect, it } from "vitest";

import { eventQuiz } from "../../src/domain/quiz";
import { createHostTicket, HOST_EMAIL } from "../../worker/auth";
import { createMemoryRepository } from "../../worker/memory-db";
import { RoomController } from "../../worker/room";
import type { Env } from "../../worker/env";
import { FakeDurableObjectState, FakeSocket } from "../helpers/fake-durable";

const env = {
  AUTH_GOOGLE_ID: "google-client-id",
  AUTH_GOOGLE_SECRET: "google-client-secret",
  AUTH_SECRET: "a-very-long-auth-secret-for-hs256-tests",
  TURSO_DATABASE_URL: "",
  TURSO_AUTH_TOKEN: "",
  PONG_TEST_MODE: "1",
  ROOMS: {} as Env["ROOMS"],
  ASSETS: { fetch: async () => new Response("asset") } as unknown as Env["ASSETS"],
} satisfies Env;

function message(type: string, payload: unknown, roomRevision = 0) {
  return JSON.stringify({ version: 1, roomRevision, type, payload });
}

describe("PongRoom controller", () => {
  it("joins two players, keeps reconnect tokens private, accepts one answer, and closes on the alarm", async () => {
    const ctx = new FakeDurableObjectState();
    const saved: unknown[] = [];
    const repository = {
      ...createMemoryRepository(),
      async saveRound(input: never) {
        saved.push(input);
      },
    };
    let now = 2_000;
    let ids = 0;
    const room = new RoomController(ctx as unknown as DurableObjectState, env, {
      now: () => now,
      repository,
      randomUUID: () => `player-${++ids}`,
      randomToken: () => `token-${ids}`,
    });

    await room.fetch(new Request("http://room/init", {
      method: "POST",
      body: JSON.stringify({
        roomCode: "123456",
        sessionId: "session-1",
        hostSub: "host-sub",
        quiz: eventQuiz,
      }),
    }));

    const host = new FakeSocket();
    const alice = new FakeSocket();
    const bob = new FakeSocket();
    ctx.acceptWebSocket(host);
    ctx.acceptWebSocket(alice);
    ctx.acceptWebSocket(bob);
    const ticket = await createHostTicket({
      env,
      session: { sub: "host-sub", email: HOST_EMAIL, exp: 9_999_999_999 },
      roomCode: "123456",
      now,
    });
    host.serializeAttachment({ role: "host", roomCode: "123456", violations: 0 });
    alice.serializeAttachment({ role: "player", roomCode: "123456", violations: 0 });
    bob.serializeAttachment({ role: "player", roomCode: "123456", violations: 0 });
    await room.onSocketOpen(host);
    await room.onSocketOpen(alice);
    await room.onSocketOpen(bob);

    await room.onSocketMessage(alice, message("player.join", { displayName: "Alex" }));
    await room.onSocketMessage(bob, message("player.join", { displayName: "Bea" }));

    const welcome = alice.messages().find((item) => item.type === "player.welcome");
    expect(welcome?.payload.reconnectToken).toBe("token-1");
    expect(JSON.stringify(bob.messages())).not.toContain("token-1");
    expect(JSON.stringify(host.messages())).not.toContain("token-1");

    await room.onSocketMessage(host, message("host.open_question", {
      hostTicket: ticket,
      idempotencyKey: "open-0",
      questionIndex: 0,
    }, 2));

    await room.onSocketMessage(alice, message("player.answer", {
      questionId: eventQuiz.questions[0].id,
      answerIndex: 0,
      idempotencyKey: "answer-a",
    }, 3));

    const receipt = alice.messages().filter((item) => item.type === "answer.received");
    expect(receipt).toHaveLength(1);
    expect(bob.messages().some((item) => item.type === "answer.received")).toBe(false);

    now = 22_000;
    await room.onAlarm();
    await ctx.flush();

    expect(alice.messages().some((item) => item.type === "question.closed")).toBe(true);
    expect(saved).toHaveLength(1);
    expect(ctx.storageMap.has("room")).toBe(true);

    const restored = new RoomController(ctx as unknown as DurableObjectState, env, {
      now: () => now,
      repository,
    });
    const snapshot = await restored.fetch(new Request("http://room/snapshot"));
    const body = await snapshot.json() as { snapshot: { state: string; revision: number } };
    expect(body.snapshot.state).toBe("question_closed");
    expect(body.snapshot.revision).toBeGreaterThan(0);
  });

  it("rejects a host socket without a valid room ticket", async () => {
    const ctx = new FakeDurableObjectState();
    const room = new RoomController(ctx as unknown as DurableObjectState, env, {
      now: () => 2_000,
      repository: createMemoryRepository(),
    });
    await room.fetch(new Request("http://room/init", {
      method: "POST",
      body: JSON.stringify({ roomCode: "123456", sessionId: "session-1", hostSub: "host-sub", quiz: eventQuiz }),
    }));
    const host = new FakeSocket();
    ctx.acceptWebSocket(host);
    host.serializeAttachment({ role: "host", roomCode: "123456", violations: 0 });
    await room.onSocketMessage(host, message("host.open_question", {
      hostTicket: "nope",
      idempotencyKey: "open-0",
      questionIndex: 0,
    }));
    expect(host.messages()[0]).toMatchObject({ type: "error", payload: { code: "FORBIDDEN" } });
  });
});
