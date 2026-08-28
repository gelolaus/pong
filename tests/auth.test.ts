import { describe, expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";

import {
  beginGoogleAuth,
  createHostTicket,
  finishGoogleAuth,
  HOST_EMAIL,
  readHostSession,
  verifyHostTicket,
} from "../worker/auth";

const env = {
  AUTH_GOOGLE_ID: "google-client-id",
  AUTH_GOOGLE_SECRET: "google-client-secret",
  AUTH_SECRET: "a-very-long-auth-secret-for-hs256-tests",
};

const now = 1_700_000_000_000;

function cookieHeader(setCookies: string[]): string {
  return setCookies
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

describe("Google host authentication", () => {
  it("starts the Google Authorization Code flow with state, nonce, and SHA-256 PKCE", async () => {
    const result = await beginGoogleAuth({
      env,
      requestUrl: "http://localhost:8787/api/auth/google",
      now,
      randomBytes: sequentialBytes(),
    });

    const location = new URL(result.location ?? "");
    expect(result.status).toBe(302);
    expect(location.origin).toBe("https://accounts.google.com");
    expect(location.searchParams.get("client_id")).toBe(env.AUTH_GOOGLE_ID);
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(location.searchParams.get("scope")).toContain("email");
    expect(location.searchParams.get("redirect_uri")).toBe("http://localhost:8787/api/auth/google/callback");
    expect(location.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(location.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(location.searchParams.get("code_challenge")).not.toBe(location.searchParams.get("state"));

    const oauthCookie = result.setCookies.find((cookie) => cookie.startsWith("pong_oauth="));
    expect(oauthCookie).toContain("HttpOnly");
    expect(oauthCookie).toContain("SameSite=Lax");
    expect(oauthCookie).toContain("Path=/");
    expect(oauthCookie).not.toContain("Secure");
  });

  it("sets Secure on the session cookie outside local development", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const started = await beginGoogleAuth({
      env,
      requestUrl: "https://pong.example/api/auth/google",
      now,
      randomBytes: sequentialBytes(),
    });
    const oauth = cookieHeader(started.setCookies);
    const nonce = new URL(started.location ?? "").searchParams.get("nonce") ?? "";
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" }] });

    const result = await finishGoogleAuth({
      env,
      requestUrl: `https://pong.example/api/auth/google/callback?code=abc&state=${new URL(started.location ?? "").searchParams.get("state")}`,
      cookieHeader: oauth,
      now: now + 1_000,
      fetch: tokenFetch(await googleIdToken({ privateKey, nonce, email: "Hello@Gelolaus.com" })),
      getGoogleKey: jwks,
    });

    const sessionCookie = result.setCookies.find((cookie) => cookie.startsWith("pong_host="));
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).toContain("Path=/");
    expect(result.status).toBe(302);
    expect(result.location).toBe("/host");
  });

  it("accepts only the normalized host email after verifying Google claims", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const started = await beginGoogleAuth({
      env,
      requestUrl: "http://127.0.0.1:8787/api/auth/google",
      now,
      randomBytes: sequentialBytes(),
    });
    const state = new URL(started.location ?? "").searchParams.get("state") ?? "";
    const nonce = new URL(started.location ?? "").searchParams.get("nonce") ?? "";
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" }] });

    const allowed = await finishGoogleAuth({
      env,
      requestUrl: `http://127.0.0.1:8787/api/auth/google/callback?code=ok&state=${state}`,
      cookieHeader: cookieHeader(started.setCookies),
      now: now + 1_000,
      fetch: tokenFetch(await googleIdToken({ privateKey, nonce, email: "Hello@Gelolaus.com" })),
      getGoogleKey: jwks,
    });

    const denied = await finishGoogleAuth({
      env,
      requestUrl: `http://127.0.0.1:8787/api/auth/google/callback?code=ok&state=${state}`,
      cookieHeader: cookieHeader(started.setCookies),
      now: now + 1_000,
      fetch: tokenFetch(await googleIdToken({ privateKey, nonce, email: "other@example.com", sub: "other-sub" })),
      getGoogleKey: jwks,
    });

    expect(allowed.status).toBe(302);
    const session = await readHostSession({
      env,
      cookieHeader: cookieHeader(allowed.setCookies),
      now: now + 2_000,
    });
    expect(session).toEqual({ sub: "host-sub", email: HOST_EMAIL, exp: expect.any(Number) });

    expect(denied.status).toBe(403);
    expect(denied.body).toMatch(/access denied/i);
    expect(denied.setCookies.some((cookie) => cookie.startsWith("pong_host=") && !cookie.includes("pong_host=;"))).toBe(false);
    await expect(
      readHostSession({ env, cookieHeader: cookieHeader(denied.setCookies), now: now + 2_000 }),
    ).resolves.toBeNull();
  });

  it("rejects an expired host session", async () => {
    const { publicKey, privateKey } = await generateKeyPair("RS256");
    const started = await beginGoogleAuth({
      env,
      requestUrl: "http://localhost:8787/api/auth/google",
      now,
      randomBytes: sequentialBytes(),
    });
    const state = new URL(started.location ?? "").searchParams.get("state") ?? "";
    const nonce = new URL(started.location ?? "").searchParams.get("nonce") ?? "";
    const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: "test", alg: "RS256" }] });
    const allowed = await finishGoogleAuth({
      env,
      requestUrl: `http://localhost:8787/api/auth/google/callback?code=ok&state=${state}`,
      cookieHeader: cookieHeader(started.setCookies),
      now: now + 1_000,
      fetch: tokenFetch(await googleIdToken({ privateKey, nonce, email: HOST_EMAIL })),
      getGoogleKey: jwks,
    });

    await expect(
      readHostSession({
        env,
        cookieHeader: cookieHeader(allowed.setCookies),
        now: now + 13 * 60 * 60 * 1_000,
      }),
    ).resolves.toBeNull();
  });

  it("issues a one-minute room ticket and rejects missing, expired, and wrong-room tickets", async () => {
    const session = { sub: "host-sub", email: HOST_EMAIL, exp: Math.floor((now + 60_000) / 1000) + 3_600 };
    const ticket = await createHostTicket({ env, session, roomCode: "123456", now });

    await expect(verifyHostTicket({ env, ticket, roomCode: "123456", now: now + 1_000 })).resolves.toMatchObject({
      sub: "host-sub",
      roomCode: "123456",
      aud: "pong-room",
    });
    await expect(verifyHostTicket({ env, ticket: "", roomCode: "123456", now: now + 1_000 })).resolves.toBeNull();
    await expect(verifyHostTicket({ env, ticket, roomCode: "999999", now: now + 1_000 })).resolves.toBeNull();
    await expect(verifyHostTicket({ env, ticket, roomCode: "123456", now: now + 61_000 })).resolves.toBeNull();
  });
});

function sequentialBytes() {
  let next = 1;
  return (size: number) => Uint8Array.from({ length: size }, () => next++);
}

function tokenFetch(idToken: string): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    if (!url.includes("oauth2.googleapis.com/token")) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    const body = String(init?.body ?? "");
    expect(body).toContain("code_verifier=");
    expect(body).toContain("client_secret=");
    return new Response(JSON.stringify({ id_token: idToken, token_type: "Bearer" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

async function googleIdToken(input: {
  privateKey: CryptoKey;
  nonce: string;
  email: string;
  sub?: string;
  emailVerified?: boolean;
}) {
  return new SignJWT({
    email: input.email,
    email_verified: input.emailVerified ?? true,
    nonce: input.nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .setIssuer("https://accounts.google.com")
    .setAudience(env.AUTH_GOOGLE_ID)
    .setSubject(input.sub ?? "host-sub")
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + 3600)
    .sign(input.privateKey);
}
