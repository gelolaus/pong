import {
  createRemoteJWKSet,
  jwtVerify,
  SignJWT,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";

export const HOST_EMAIL = "hello@gelolaus.com" as const;
export const HOST_TICKET_AUDIENCE = "pong-room";
export const HOST_SESSION_COOKIE = "pong_host";
export const OAUTH_COOKIE = "pong_oauth";

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;
const OAUTH_TTL_MS = 10 * 60 * 1_000;
const TICKET_TTL_MS = 60 * 1_000;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export type HostSession = { sub: string; email: typeof HOST_EMAIL; exp: number };
export type HostTicket = { sub: string; roomCode: string; aud: typeof HOST_TICKET_AUDIENCE; iat: number; exp: number };

export type AuthEnv = {
  AUTH_GOOGLE_ID: string;
  AUTH_GOOGLE_SECRET: string;
  AUTH_SECRET: string;
};

export type AuthResult = {
  status: number;
  location?: string;
  body?: string;
  setCookies: string[];
};

type OAuthState = {
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
};

export async function beginGoogleAuth(input: {
  env: AuthEnv;
  requestUrl: string;
  now?: number;
  randomBytes?: (size: number) => Uint8Array;
}): Promise<AuthResult> {
  const now = input.now ?? Date.now();
  const requestUrl = new URL(input.requestUrl);
  const redirectUri = new URL("/api/auth/google/callback", requestUrl.origin).toString();
  const randomBytes = input.randomBytes ?? defaultRandomBytes;
  const state = base64Url(randomBytes(32));
  const nonce = base64Url(randomBytes(32));
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(await sha256(verifier));

  const location = new URL(GOOGLE_AUTH_URL);
  location.searchParams.set("client_id", input.env.AUTH_GOOGLE_ID);
  location.searchParams.set("redirect_uri", redirectUri);
  location.searchParams.set("response_type", "code");
  location.searchParams.set("scope", "openid email profile");
  location.searchParams.set("state", state);
  location.searchParams.set("nonce", nonce);
  location.searchParams.set("code_challenge", challenge);
  location.searchParams.set("code_challenge_method", "S256");

  const oauthToken = await signToken(input.env.AUTH_SECRET, {
    aud: "pong-oauth",
    state,
    nonce,
    verifier,
    redirectUri,
    exp: seconds(now + OAUTH_TTL_MS),
  });

  return {
    status: 302,
    location: location.toString(),
    setCookies: [
      serializeCookie(OAUTH_COOKIE, oauthToken, {
        maxAge: OAUTH_TTL_MS / 1000,
        secure: isSecureRequest(requestUrl),
      }),
    ],
  };
}

export async function finishGoogleAuth(input: {
  env: AuthEnv;
  requestUrl: string;
  cookieHeader?: string | null;
  now?: number;
  fetch?: typeof fetch;
  getGoogleKey?: JWTVerifyGetKey;
}): Promise<AuthResult> {
  const now = input.now ?? Date.now();
  const requestUrl = new URL(input.requestUrl);
  const secure = isSecureRequest(requestUrl);
  const clearOAuth = serializeCookie(OAUTH_COOKIE, "", { maxAge: 0, secure });

  try {
    const code = requestUrl.searchParams.get("code");
    const returnedState = requestUrl.searchParams.get("state");
    const pending = await readOAuthState(input.env.AUTH_SECRET, input.cookieHeader, now);
    if (!code || !returnedState || !pending || pending.state !== returnedState) {
      return { status: 400, body: "Invalid Google sign-in request.", setCookies: [clearOAuth] };
    }

    const tokenResponse = await (input.fetch ?? fetch)(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: input.env.AUTH_GOOGLE_ID,
        client_secret: input.env.AUTH_GOOGLE_SECRET,
        redirect_uri: pending.redirectUri,
        code_verifier: pending.verifier,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      return { status: 400, body: "Google sign-in failed.", setCookies: [clearOAuth] };
    }

    const tokenBody = (await tokenResponse.json()) as { id_token?: string };
    if (!tokenBody.id_token) {
      return { status: 400, body: "Google sign-in failed.", setCookies: [clearOAuth] };
    }

    const verified = await jwtVerify(tokenBody.id_token, input.getGoogleKey ?? defaultGoogleKey(), {
      issuer: GOOGLE_ISSUERS,
      audience: input.env.AUTH_GOOGLE_ID,
      currentDate: new Date(now),
    });
    const claims = verified.payload;
    if (claims.nonce !== pending.nonce) {
      return { status: 400, body: "Google sign-in failed.", setCookies: [clearOAuth] };
    }
    if (claims.email_verified !== true && claims.email_verified !== "true") {
      return { status: 403, body: "Access denied.", setCookies: [clearOAuth] };
    }

    const email = normalizeEmail(String(claims.email ?? ""));
    if (email !== HOST_EMAIL) {
      return { status: 403, body: "Access denied.", setCookies: [clearOAuth] };
    }

    const exp = seconds(now + SESSION_TTL_MS);
    const sessionToken = await signToken(input.env.AUTH_SECRET, {
      aud: "pong-host",
      sub: String(claims.sub ?? ""),
      email: HOST_EMAIL,
      exp,
    });

    return {
      status: 302,
      location: "/host",
      setCookies: [
        serializeCookie(HOST_SESSION_COOKIE, sessionToken, {
          maxAge: SESSION_TTL_MS / 1000,
          secure,
        }),
        clearOAuth,
      ],
    };
  } catch {
    return { status: 400, body: "Google sign-in failed.", setCookies: [clearOAuth] };
  }
}

export async function readHostSession(input: {
  env: AuthEnv;
  cookieHeader?: string | null;
  now?: number;
}): Promise<HostSession | null> {
  const token = readCookie(input.cookieHeader, HOST_SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await hmacKey(input.env.AUTH_SECRET), {
      audience: "pong-host",
      currentDate: new Date(input.now ?? Date.now()),
    });
    const email = normalizeEmail(String(payload.email ?? ""));
    if (email !== HOST_EMAIL || typeof payload.sub !== "string" || !payload.sub || typeof payload.exp !== "number") {
      return null;
    }
    return { sub: payload.sub, email: HOST_EMAIL, exp: payload.exp };
  } catch {
    return null;
  }
}

export async function createHostTicket(input: {
  env: AuthEnv;
  session: HostSession;
  roomCode: string;
  now?: number;
}): Promise<string> {
  const now = input.now ?? Date.now();
  return signToken(input.env.AUTH_SECRET, {
    aud: HOST_TICKET_AUDIENCE,
    sub: input.session.sub,
    roomCode: input.roomCode,
    iat: seconds(now),
    exp: seconds(now + TICKET_TTL_MS),
  });
}

export async function issueHostSessionCookie(input: {
  env: AuthEnv;
  sub?: string;
  now?: number;
  secure: boolean;
}): Promise<string> {
  const now = input.now ?? Date.now();
  const sessionToken = await signToken(input.env.AUTH_SECRET, {
    aud: "pong-host",
    sub: input.sub ?? "test-host",
    email: HOST_EMAIL,
    exp: seconds(now + SESSION_TTL_MS),
  });
  return serializeCookie(HOST_SESSION_COOKIE, sessionToken, {
    maxAge: SESSION_TTL_MS / 1000,
    secure: input.secure,
  });
}

export async function verifyHostTicket(input: {
  env: AuthEnv;
  ticket: string;
  roomCode: string;
  now?: number;
}): Promise<HostTicket | null> {
  if (!input.ticket) return null;
  try {
    const { payload } = await jwtVerify(input.ticket, await hmacKey(input.env.AUTH_SECRET), {
      audience: HOST_TICKET_AUDIENCE,
      currentDate: new Date(input.now ?? Date.now()),
    });
    if (payload.roomCode !== input.roomCode || typeof payload.sub !== "string" || !payload.sub) {
      return null;
    }
    return {
      sub: payload.sub,
      roomCode: input.roomCode,
      aud: HOST_TICKET_AUDIENCE,
      iat: Number(payload.iat ?? 0),
      exp: Number(payload.exp ?? 0),
    };
  } catch {
    return null;
  }
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge: number; secure: boolean },
): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function isSecureRequest(url: URL): boolean {
  if (url.protocol === "http:") return false;
  return url.hostname !== "localhost" && url.hostname !== "127.0.0.1";
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function defaultRandomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

function defaultGoogleKey(): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signToken(secret: string, payload: JWTPayload): Promise<string> {
  const jwt = new SignJWT(payload).setProtectedHeader({ alg: "HS256" });
  if (typeof payload.sub === "string") jwt.setSubject(payload.sub);
  if (typeof payload.aud === "string") jwt.setAudience(payload.aud);
  if (typeof payload.iat === "number") jwt.setIssuedAt(payload.iat);
  if (typeof payload.exp === "number") jwt.setExpirationTime(payload.exp);
  return jwt.sign(await hmacKey(secret));
}

async function readOAuthState(secret: string, cookieHeader: string | null | undefined, now: number): Promise<OAuthState | null> {
  const token = readCookie(cookieHeader, OAUTH_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, await hmacKey(secret), {
      audience: "pong-oauth",
      currentDate: new Date(now),
    });
    if (
      typeof payload.state !== "string"
      || typeof payload.nonce !== "string"
      || typeof payload.verifier !== "string"
      || typeof payload.redirectUri !== "string"
    ) {
      return null;
    }
    return {
      state: payload.state,
      nonce: payload.nonce,
      verifier: payload.verifier,
      redirectUri: payload.redirectUri,
    };
  } catch {
    return null;
  }
}

function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return null;
}

function seconds(ms: number): number {
  return Math.floor(ms / 1000);
}
