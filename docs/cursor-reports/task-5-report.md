# Task 5 report — Google OAuth and host tickets

## RED

Command:

```text
npm test -- tests/auth.test.ts
```

Result: failed to resolve `../worker/auth`.

## GREEN

Command:

```text
npm test -- tests/auth.test.ts
```

PASS: 5 tests

HMAC secrets are imported as WebCrypto keys so jsdom and Workers both satisfy jose. Google ID token verification uses the injected clock.

## Behavior

- Authorization Code flow with state, nonce, and SHA-256 PKCE
- ID token issuer, audience, nonce, and email verification checks
- Allowlist is applied only after verified Google claims
- Only normalized `hello@gelolaus.com` receives a session
- Session cookie: HttpOnly, SameSite=Lax, Path=/, Secure outside local HTTP
- Expired sessions fail closed
- One-minute room tickets bound to host subject, room code, and audience `pong-room`
- Missing, expired, and wrong-room tickets return null

## Security review

- No Google network calls in unit tests
- Disallowed emails get 403 and no `pong_host` cookie
- Secrets stay in env; cookies are signed JWTs
- Tickets are short-lived and room-bound

## Remaining risks

- Production still needs a real Google client, `AUTH_SECRET`, and callback URL
