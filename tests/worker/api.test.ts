import { describe, expect, it } from "vitest";

import { eventQuiz } from "../../src/domain/quiz";
import { HOST_EMAIL, readHostSession } from "../../worker/auth";
import { createApp } from "../../worker/index";
import { createMemoryRepository } from "../../worker/memory-db";
import { RoomController } from "../../worker/room";
import type { Env } from "../../worker/env";
import { FakeDurableObjectState } from "../helpers/fake-durable";

const authEnv = {
  AUTH_GOOGLE_ID: "google-client-id",
  AUTH_GOOGLE_SECRET: "google-client-secret",
  AUTH_SECRET: "a-very-long-auth-secret-for-hs256-tests",
};

function testEnv(overrides: Partial<Env> = {}): Env {
  const rooms = createMemoryRoomNamespace();
  return {
    ...authEnv,
    TURSO_DATABASE_URL: "",
    TURSO_AUTH_TOKEN: "",
    PONG_TEST_MODE: "1",
    ROOMS: rooms as Env["ROOMS"],
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Env["ASSETS"],
    ...overrides,
  };
}

function createMemoryRoomNamespace() {
  const rooms = new Map<string, RoomController>();
  return {
    idFromName(name: string) {
      return { toString: () => name };
    },
    get(id: { toString(): string }) {
      const code = id.toString();
      return {
        fetch: async (request: Request) => {
          let controller = rooms.get(code);
          if (!controller) {
            const ctx = new FakeDurableObjectState();
            controller = new RoomController(ctx as unknown as DurableObjectState, testEnv(), {
              now: () => Date.now(),
              repository: createMemoryRepository(),
            });
            rooms.set(code, controller);
          }
          return controller.fetch(request);
        },
      };
    },
  };
}

describe("Worker API", () => {
  it("rejects unauthenticated quiz list and room creation", async () => {
    const app = createApp({ repository: createMemoryRepository() });
    const env = testEnv({ PONG_TEST_MODE: "0" });

    const quizzes = await app.fetch(new Request("http://localhost/api/quizzes"), env);
    const created = await app.fetch(new Request("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quizId: eventQuiz.id }),
    }), env);

    expect(quizzes.status).toBe(401);
    expect(created.status).toBe(401);
  });

  it("creates a six-digit room for a signed-in host", async () => {
    const app = createApp({ repository: createMemoryRepository(), now: () => 1_700_000_000_000 });
    const env = testEnv();
    const fixture = await app.fetch(new Request("http://localhost/api/test/host-session", { method: "POST" }), env);
    const cookie = fixture.headers.get("set-cookie") ?? "";

    const created = await app.fetch(new Request("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ quizId: eventQuiz.id }),
    }), env);
    const body = await created.json() as { roomCode: string; hostTicket: string };

    expect(created.status).toBe(201);
    expect(body.roomCode).toMatch(/^\d{6}$/);
    expect(body.hostTicket).toMatch(/\S/);
    await expect(readHostSession({ env, cookieHeader: cookie.split(";")[0], now: 1_700_000_000_000 })).resolves.toMatchObject({
      email: HOST_EMAIL,
    });
  });

  it("hides test fixtures when PONG_TEST_MODE is not enabled", async () => {
    const app = createApp({ repository: createMemoryRepository() });
    const env = testEnv({ PONG_TEST_MODE: "0" });
    const response = await app.fetch(new Request("http://localhost/api/test/host-session", { method: "POST" }), env);
    expect(response.status).toBe(404);
  });

  it("starts Google auth for the host", async () => {
    const app = createApp();
    const env = testEnv();
    const response = await app.fetch(new Request("http://localhost/api/auth/google"), env);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toContain("accounts.google.com");
  });
});
