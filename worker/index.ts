import { Hono } from "hono";
import { z } from "zod";

import { eventQuiz } from "../src/domain/quiz";
import {
  beginGoogleAuth,
  createHostTicket,
  finishGoogleAuth,
  HOST_EMAIL,
  issueHostSessionCookie,
  readHostSession,
  type AuthResult,
} from "./auth";
import type { Env } from "./env";
import { createMemoryRepository } from "./memory-db";
import { PongRoom, repositoryFromEnv, RoomController } from "./room";
import type { PongRepository } from "./db";

export { PongRoom, RoomController };

export type AppOptions = {
  repository?: PongRepository;
  now?: () => number;
  fetch?: typeof fetch;
};

const createRoomSchema = z.object({ quizId: z.string().min(1) });

export function createApp(options: AppOptions = {}) {
  const app = new Hono<{ Bindings: Env }>();
  const now = options.now ?? (() => Date.now());

  const repo = (env: Env) => options.repository ?? repositoryFromEnv(env);

  app.get("/api/auth/google", async (c) => {
    const result = await beginGoogleAuth({ env: c.env, requestUrl: c.req.url, now: now() });
    return applyAuth(result);
  });

  app.get("/api/auth/google/callback", async (c) => {
    const result = await finishGoogleAuth({
      env: c.env,
      requestUrl: c.req.url,
      cookieHeader: c.req.header("cookie"),
      now: now(),
      fetch: options.fetch,
    });
    return applyAuth(result);
  });

  app.post("/api/auth/logout", async (c) => {
    const url = new URL(c.req.url);
    return applyAuth({
      status: 204,
      setCookies: ["pong_host=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (url.protocol === "https:" ? "; Secure" : "")],
    });
  });

  app.get("/api/auth/session", async (c) => {
    const session = await readHostSession({ env: c.env, cookieHeader: c.req.header("cookie"), now: now() });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    return c.json({ email: session.email, sub: session.sub });
  });

  app.get("/api/quizzes", async (c) => {
    const session = await readHostSession({ env: c.env, cookieHeader: c.req.header("cookie"), now: now() });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    return c.json({ quizzes: await listHostQuizzes(repo(c.env)) });
  });

  app.post("/api/rooms", async (c) => {
    const session = await readHostSession({ env: c.env, cookieHeader: c.req.header("cookie"), now: now() });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const parsed = createRoomSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_data" }, 400);

    const quiz = await repo(c.env).getQuiz(parsed.data.quizId).catch(async () => {
      return createMemoryRepository().getQuiz(parsed.data.quizId).catch(() => null);
    });
    if (!quiz) return c.json({ error: "invalid_data" }, 400);

    for (let attempt = 0; attempt < 8; attempt++) {
      const roomCode = randomRoomCode();
      const sessionId = crypto.randomUUID();
      try {
        await repo(c.env).createSession({
          id: sessionId,
          quizId: quiz.id,
          roomCode,
          hostId: session.sub,
          createdAt: now(),
        });
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "conflict") continue;
      }

      const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(roomCode));
      await stub.fetch(new Request("https://pong.internal/init", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roomCode, sessionId, hostSub: session.sub, quiz }),
      }));
      const hostTicket = await createHostTicket({ env: c.env, session, roomCode, now: now() });
      return c.json({ roomCode, hostTicket }, 201);
    }

    return c.json({ error: "conflict" }, 409);
  });

  app.get("/api/rooms/:code", async (c) => {
    const roomCode = c.req.param("code");
    if (!/^\d{6}$/.test(roomCode)) return c.json({ error: "invalid_data" }, 400);
    const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(roomCode));
    return stub.fetch(new Request("https://pong.internal/snapshot"));
  });

  app.get("/api/rooms/:code/ticket", async (c) => {
    const session = await readHostSession({ env: c.env, cookieHeader: c.req.header("cookie"), now: now() });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const roomCode = c.req.param("code");
    if (!/^\d{6}$/.test(roomCode)) return c.json({ error: "invalid_data" }, 400);
    const hostTicket = await createHostTicket({ env: c.env, session, roomCode, now: now() });
    return c.json({ hostTicket, roomCode });
  });

  app.get("/api/rooms/:code/socket", async (c) => {
    const roomCode = c.req.param("code");
    if (!/^\d{6}$/.test(roomCode)) return c.json({ error: "invalid_data" }, 400);
    const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(roomCode));
    return await stub.fetch(c.req.raw);
  });

  app.post("/api/test/host-session", async (c) => {
    if (c.env.PONG_TEST_MODE !== "1") return c.body(null, 404);
    const cookie = await issueHostSessionCookie({
      env: c.env,
      sub: "test-host",
      now: now(),
      secure: new URL(c.req.url).protocol === "https:",
    });
    return new Response(JSON.stringify({ email: HOST_EMAIL }), {
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": cookie },
    });
  });

  app.post("/api/test/rooms", async (c) => {
    if (c.env.PONG_TEST_MODE !== "1") return c.body(null, 404);
    const cookie = await issueHostSessionCookie({
      env: c.env,
      sub: "test-host",
      now: now(),
      secure: new URL(c.req.url).protocol === "https:",
    });
    const session = await readHostSession({ env: c.env, cookieHeader: cookie.split(";")[0], now: now() });
    if (!session) return c.json({ error: "unauthorized" }, 401);
    const quiz = await repo(c.env).getQuiz(eventQuiz.id).catch(async () => {
      const memory = createMemoryRepository();
      return memory.getQuiz(eventQuiz.id);
    });
    const roomCode = randomRoomCode();
    const sessionId = crypto.randomUUID();
    await repo(c.env).createSession({
      id: sessionId,
      quizId: quiz.id,
      roomCode,
      hostId: session.sub,
      createdAt: now(),
    }).catch(() => undefined);
    const stub = c.env.ROOMS.get(c.env.ROOMS.idFromName(roomCode));
    await stub.fetch(new Request("https://pong.internal/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roomCode, sessionId, hostSub: session.sub, quiz }),
    }));
    const hostTicket = await createHostTicket({ env: c.env, session, roomCode, now: now() });
    return new Response(JSON.stringify({ roomCode, hostTicket }), {
      status: 201,
      headers: { "content-type": "application/json", "set-cookie": cookie },
    });
  });

  app.all("/api/*", (c) => c.json({ error: "not_found" }, 404));
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}

async function listHostQuizzes(repository: PongRepository) {
  try {
    const quizzes = await repository.listQuizzes();
    const detailed = [];
    for (const quiz of quizzes) {
      try {
        const full = await repository.getQuiz(quiz.id);
        detailed.push({ id: quiz.id, title: quiz.title, questionCount: full.questions.length });
      } catch {
        continue;
      }
    }
    if (detailed.length > 0) return detailed;
  } catch {
    // Turso may be unseeded or unreachable; fall back to the bundled event quiz.
  }
  const fallback = await createMemoryRepository().getQuiz(eventQuiz.id);
  return [{ id: fallback.id, title: fallback.title, questionCount: fallback.questions.length }];
}

function applyAuth(result: AuthResult): Response {
  const headers = new Headers();
  for (const cookie of result.setCookies) headers.append("Set-Cookie", cookie);
  if (result.location) headers.set("Location", result.location);
  if (result.body) headers.set("content-type", "text/plain; charset=utf-8");
  return new Response(result.body ?? null, { status: result.status, headers });
}

function randomRoomCode(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

const app = createApp();

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
