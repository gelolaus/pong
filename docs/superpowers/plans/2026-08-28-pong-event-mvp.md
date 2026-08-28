# Pong Event MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a Cloudflare-hosted, host-paced Pong quiz that supports 150 players in one room and survives short connection losses.

**Architecture:** A React and Vite client shares one Cloudflare Worker deployment with a Hono API. One Durable Object owns each room's state and WebSocket connections; Turso stores quiz content and completed round data outside the live broadcast path.

**Tech Stack:** TypeScript, React, Vite, Cloudflare Workers Static Assets, Durable Objects WebSocket Hibernation API, Hono, Turso serverless SDK, Zod, jose, Vitest, Testing Library, Playwright

**Spec:** `docs/superpowers/specs/2026-08-28-pong-event-mvp-design.md`

## Global Constraints

- The event starts on 2026-08-28; ship the event build before post-event editor work.
- Support 150 players in one room and run a 200-client load check.
- Only `hello@gelolaus.com` may authenticate as host.
- Players join with a six-digit code and display name; no player account is created.
- The default timer is 20 seconds and accepts values from 5 through 120 seconds.
- A correct answer earns 1,000 points plus up to 250 speed points; extension time grants only the base points.
- The Durable Object is authoritative for room state, deadlines, accepted answers, and scores.
- Turso stays outside the live answer and broadcast path.
- Answer meaning must remain clear without color; touch targets are at least 44 by 44 pixels.
- Do not run `git add`, `git commit`, `git push`, or create a pull request. Angelo Laus commits manually.

## File structure

```text
package.json                         scripts and dependency boundary
vite.config.ts                      React and Cloudflare Vite integration
wrangler.jsonc                      Worker, assets, Durable Object, and migrations
worker/index.ts                     HTTP routing and Durable Object dispatch
worker/env.ts                       Cloudflare binding and secret types
worker/room.ts                      PongRoom Durable Object lifecycle and protocol
worker/room-state.ts                pure room transition functions
worker/auth.ts                      Google OAuth, ID token checks, and host sessions
worker/db.ts                        Turso connection and repository adapter
worker/schema.sql                   idempotent Turso schema
src/main.tsx                        client bootstrap
src/app.tsx                         route selection
src/styles.css                      Center Court tokens, layout, motion, accessibility
src/domain/quiz.ts                  quiz schema and event seed
src/domain/protocol.ts              shared WebSocket message schemas and types
src/domain/scoring.ts               score calculation
src/lib/api.ts                      typed HTTP calls
src/lib/room-socket.ts              reconnecting WebSocket client
src/lib/player-session.ts           reconnect token storage
src/components/join-page.tsx        public join form
src/components/player-room.tsx      player state router
src/components/answer-board.tsx     accessible answer controls
src/components/host-page.tsx        host login and quiz list
src/components/host-room.tsx        lobby moderation and game controls
src/components/display-room.tsx     projector view
src/components/leaderboard.tsx      ranked list and movement
src/components/podium.tsx           top-three ending
src/components/pong-avatar.tsx      deterministic local avatar
tests/*.test.ts(x)                  unit and component tests
tests/worker/*.test.ts              Worker and Durable Object tests
e2e/event-flow.spec.ts              host and player smoke path
scripts/load-room.mjs               200-client WebSocket check
scripts/seed-turso.ts               schema and seed command
```

---

### Task 1: Cloudflare React foundation and Center Court shell

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `wrangler.jsonc`
- Create: `index.html`
- Create: `.gitignore`
- Create: `.dev.vars.example`
- Create: `worker/env.ts`
- Create: `worker/index.ts`
- Create: `src/main.tsx`
- Create: `src/app.tsx`
- Create: `src/styles.css`
- Test: `tests/app.test.tsx`

**Interfaces:**
- Produces: `Env` with `ROOMS`, `ASSETS`, `AUTH_*`, and `TURSO_*` bindings.
- Produces: client routes `/`, `/play/:code`, `/host`, `/host/:code`, and `/display/:code`.

- [ ] **Step 1: Write the shell test**

```tsx
it("shows the join form at the root route", () => {
  window.history.replaceState({}, "", "/");
  render(<App />);
  expect(screen.getByRole("heading", { name: /join pong/i })).toBeVisible();
  expect(screen.getByLabelText(/game code/i)).toHaveAttribute("inputmode", "numeric");
});
```

- [ ] **Step 2: Run the shell test and verify the missing app failure**

Run: `npm test -- tests/app.test.tsx`

Expected: FAIL because `App` and its route components do not exist.

- [ ] **Step 3: Add the package, Worker, Vite, and test configuration**

Use React with the Cloudflare Vite plugin. Configure SPA fallback in `wrangler.jsonc`, bind `ROOMS` to `PongRoom`, and export a SQLite-backed Durable Object migration. Add scripts for `dev`, `build`, `preview`, `test`, `test:e2e`, `deploy`, `db:seed`, and `load`.

```ts
export interface Env {
  ROOMS: DurableObjectNamespace;
  ASSETS: Fetcher;
  AUTH_GOOGLE_ID: string;
  AUTH_GOOGLE_SECRET: string;
  AUTH_SECRET: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
}
```

- [ ] **Step 4: Add the route shell and Center Court CSS**

Implement route selection from `window.location.pathname`. Define cream, ink, coral, sky, gold, and leaf tokens; rounded display typography; 3D answer depth; focus-visible states; responsive spacing; and reduced-motion overrides. The root route renders a working join form, while unfinished route components render named page shells.

- [ ] **Step 5: Run the test, type check, and build**

Run: `npm test -- tests/app.test.tsx && npm run build`

Expected: PASS and a Cloudflare Worker build with static assets.

- [ ] **Step 6: Review the task diff without committing**

Run: `git diff -- package.json tsconfig.json vite.config.ts wrangler.jsonc index.html .gitignore .dev.vars.example worker src tests/app.test.tsx`

Expected: foundation files only; no staged changes.

---

### Task 2: Quiz schema, seed, scoring, and protocol

**Files:**
- Create: `src/domain/quiz.ts`
- Create: `src/domain/scoring.ts`
- Create: `src/domain/protocol.ts`
- Test: `tests/quiz.test.ts`
- Test: `tests/scoring.test.ts`
- Test: `tests/protocol.test.ts`

**Interfaces:**
- Produces: `Question`, `Quiz`, `eventQuiz`, and `quizSchema`.
- Produces: `scoreAnswer(input: ScoreInput): number`.
- Produces: `ClientMessage`, `ServerMessage`, `RoomSnapshot`, and their Zod schemas.

- [ ] **Step 1: Write scoring boundary tests**

```ts
expect(scoreAnswer({ correct: true, responseMs: 0, baseDurationMs: 20_000 })).toBe(1250);
expect(scoreAnswer({ correct: true, responseMs: 10_000, baseDurationMs: 20_000 })).toBe(1125);
expect(scoreAnswer({ correct: true, responseMs: 21_000, baseDurationMs: 20_000 })).toBe(1000);
expect(scoreAnswer({ correct: false, responseMs: 100, baseDurationMs: 20_000 })).toBe(0);
```

- [ ] **Step 2: Write quiz and protocol validation tests**

Assert that the 20-question seed parses, every timer is between 5 and 120 seconds, every correct index exists, player answers require an idempotency key, and host commands require a host ticket.

- [ ] **Step 3: Run the domain tests and verify missing-module failures**

Run: `npm test -- tests/quiz.test.ts tests/scoring.test.ts tests/protocol.test.ts`

Expected: FAIL because the domain modules do not exist.

- [ ] **Step 4: Implement the schemas and score function**

```ts
export function scoreAnswer(input: ScoreInput): number {
  if (!input.correct) return 0;
  const remaining = 1 - input.responseMs / input.baseDurationMs;
  return 1000 + Math.round(250 * Math.max(0, Math.min(1, remaining)));
}
```

Define the room states `lobby`, `question_open`, `question_closed`, `round_reveal`, `leaderboard`, and `finished`. Define discriminated unions for every client and server event in the spec.

- [ ] **Step 5: Add the typed 20-question event seed**

Use unambiguous programming language and Pokemon names. Include a one-sentence explanation, two text answers (`Programming language`, `Pokemon`), a 20-second timer, and optional image URL support on every question.

- [ ] **Step 6: Run the domain tests**

Run: `npm test -- tests/quiz.test.ts tests/scoring.test.ts tests/protocol.test.ts`

Expected: PASS.

- [ ] **Step 7: Review the domain diff without committing**

Run: `git diff -- src/domain tests/quiz.test.ts tests/scoring.test.ts tests/protocol.test.ts`

Expected: pure schemas, seed data, and score logic with no network code.

---

### Task 3: Pure room transitions

**Files:**
- Create: `worker/room-state.ts`
- Test: `tests/room-state.test.ts`

**Interfaces:**
- Consumes: `Quiz`, `RoomSnapshot`, `scoreAnswer`.
- Produces: `createRoomState`, `joinPlayer`, `resumePlayer`, `removePlayer`, `openQuestion`, `extendTime`, `closeQuestion`, `acceptAnswer`, `revealRound`, `showLeaderboard`, `advanceQuestion`, and `finishGame`.

- [ ] **Step 1: Write transition tests for the happy path**

Create a room, join two players, open question zero, accept one correct answer, close, reveal, show leaderboard, and advance. Assert revision increases once per accepted transition and the correct player receives the expected points.

- [ ] **Step 2: Write rejection and reconnect tests**

Test late answers, duplicate answers, removed tokens, locked joins, duplicate display-name suffixes, a 30-second away threshold, host idempotency keys, and added time that does not restore speed bonus.

- [ ] **Step 3: Run the room-state tests and verify the missing-module failure**

Run: `npm test -- tests/room-state.test.ts`

Expected: FAIL because `worker/room-state.ts` does not exist.

- [ ] **Step 4: Implement immutable transition results**

Each function returns one of these values:

```ts
type TransitionResult =
  | { ok: true; state: RoomState; events: ServerMessage[] }
  | { ok: false; state: RoomState; code: RoomErrorCode; message: string };
```

Hash reconnect tokens with SHA-256. Keep the raw token only in the join result sent to that player. Store accepted answers by question ID and player ID. Calculate rankings with score descending, response duration ascending, then join order.

- [ ] **Step 5: Run room-state and domain tests**

Run: `npm test -- tests/room-state.test.ts tests/scoring.test.ts tests/protocol.test.ts`

Expected: PASS.

- [ ] **Step 6: Review the transition diff without committing**

Run: `git diff -- worker/room-state.ts tests/room-state.test.ts`

Expected: deterministic functions with injected timestamps and no Cloudflare bindings.

---

### Task 4: Turso repository and seed command

**Files:**
- Create: `worker/schema.sql`
- Create: `worker/db.ts`
- Create: `scripts/seed-turso.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: `PongRepository` with `listQuizzes`, `getQuiz`, `createSession`, `saveRound`, and `finishSession`.
- Produces: `createTursoRepository(env): PongRepository`.

- [ ] **Step 1: Write repository contract tests with a fake transport**

Assert that schema application is idempotent, quiz reads parse through `quizSchema`, active codes remain unique, and `saveRound` retries once after a transient failure without duplicating answers.

- [ ] **Step 2: Run the repository test and verify the missing-module failure**

Run: `npm test -- tests/db.test.ts`

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Add the SQL schema**

Create `users`, `quizzes`, `questions`, `game_sessions`, `session_players`, and `answers`. Add a partial unique index for active room codes and a unique index on `(session_id, question_id, player_id)`.

- [ ] **Step 4: Implement the Turso adapter**

Use `@tursodatabase/serverless`. Batch round answers in one transaction-compatible request. Translate database errors into `PongRepositoryError` with `transient`, `conflict`, and `invalid_data` codes.

- [ ] **Step 5: Add the seed command**

The command reads `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, applies `worker/schema.sql`, upserts the event quiz by stable ID, replaces its ordered questions in one batch, and prints only record counts.

- [ ] **Step 6: Run repository tests**

Run: `npm test -- tests/db.test.ts tests/quiz.test.ts`

Expected: PASS.

- [ ] **Step 7: Review the database diff without committing**

Run: `git diff -- worker/schema.sql worker/db.ts scripts/seed-turso.ts tests/db.test.ts`

Expected: no secret values and no Wantap table references.

---

### Task 5: Google OAuth and host authorization

**Files:**
- Create: `worker/auth.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Produces: `beginGoogleAuth`, `finishGoogleAuth`, `readHostSession`, `createHostTicket`, and `verifyHostTicket`.
- Consumes: `Env.AUTH_GOOGLE_ID`, `Env.AUTH_GOOGLE_SECRET`, and `Env.AUTH_SECRET`.

- [ ] **Step 1: Write auth tests**

Test state and PKCE cookie creation, nonce and audience verification, normalization of `hello@gelolaus.com`, rejection of another verified Google email, secure session-cookie flags, expired sessions, and room-bound host tickets.

- [ ] **Step 2: Run auth tests and verify the missing-module failure**

Run: `npm test -- tests/auth.test.ts`

Expected: FAIL because `worker/auth.ts` does not exist.

- [ ] **Step 3: Implement OAuth and signed sessions**

Use `jose` for ID token verification through Google's JWKS and for short-lived signed host sessions. Use SHA-256 PKCE. Set cookies as `HttpOnly`, `Secure` outside local development, `SameSite=Lax`, and scoped to `/`.

```ts
export const HOST_EMAIL = "hello@gelolaus.com";
export type HostSession = { sub: string; email: typeof HOST_EMAIL; exp: number };
```

- [ ] **Step 4: Implement one-minute room tickets**

Bind each ticket to host subject, room code, audience `pong-room`, issued time, and expiry. Durable Objects reject a missing, expired, or wrong-room ticket.

- [ ] **Step 5: Run auth tests**

Run: `npm test -- tests/auth.test.ts`

Expected: PASS.

- [ ] **Step 6: Review the auth diff without committing**

Run: `git diff -- worker/auth.ts tests/auth.test.ts`

Expected: allowlist enforcement occurs after verified Google claims, not from query parameters.

---

### Task 6: Durable Object room server and Worker API

**Files:**
- Create: `worker/room.ts`
- Modify: `worker/index.ts`
- Test: `tests/worker/room.test.ts`
- Test: `tests/worker/api.test.ts`

**Interfaces:**
- Consumes: room transitions, auth tickets, protocol schemas, and `PongRepository`.
- Produces: `PongRoom extends DurableObject<Env>`.
- Produces HTTP endpoints for auth, quiz list, room creation, room snapshot, and `/api/rooms/:code/socket`.

- [ ] **Step 1: Write Worker API tests**

Assert that room creation needs a host session, produces a six-digit code, unauthenticated quiz-list requests fail, player WebSocket upgrades accept join messages, and host upgrades require a valid room ticket.

- [ ] **Step 2: Write Durable Object lifecycle tests**

Connect a host and two players. Verify lobby broadcasts, private reconnect tokens, one accepted answer, automatic close at the alarm deadline, host-controlled reveal, persisted room snapshots, and state restoration after object re-instantiation.

- [ ] **Step 3: Run Worker tests and verify failures**

Run: `npm test -- tests/worker/room.test.ts tests/worker/api.test.ts`

Expected: FAIL because `PongRoom` and API routes are incomplete.

- [ ] **Step 4: Implement Hibernation WebSocket handling**

Accept sockets with `state.acceptWebSocket`. Store role, player ID, and room code in serialized attachments. Parse every incoming message through `clientMessageSchema`; send `error` for invalid payloads and close after repeated protocol violations.

- [ ] **Step 5: Implement broadcasts and snapshots**

Send private answer receipts only to the submitting player. Broadcast public room revisions to matching sockets. Strip the correct answer from snapshots while a question is open. Write the room snapshot to Durable Object storage after each state transition.

- [ ] **Step 6: Implement deadlines and persistence**

Set a Durable Object alarm for `answerDeadline`. The alarm closes the question and broadcasts the new state. On round close, call `saveRound`; catch transient errors, set a host-only warning, and retry once through another alarm without blocking gameplay.

- [ ] **Step 7: Implement Worker routes**

Route `/api/auth/*`, `/api/quizzes`, `/api/rooms`, `/api/rooms/:code`, and WebSocket upgrades. Fall through unmatched navigation requests to the asset binding.

- [ ] **Step 8: Run Worker and domain tests**

Run: `npm test -- tests/worker tests/room-state.test.ts tests/auth.test.ts tests/db.test.ts`

Expected: PASS.

- [ ] **Step 9: Review the server diff without committing**

Run: `git diff -- worker tests/worker`

Expected: live transitions do not wait for Turso before broadcasting.

---

### Task 7: Reconnecting client and player experience

**Files:**
- Create: `src/lib/api.ts`
- Create: `src/lib/room-socket.ts`
- Create: `src/lib/player-session.ts`
- Create: `src/components/join-page.tsx`
- Create: `src/components/player-room.tsx`
- Create: `src/components/answer-board.tsx`
- Create: `src/components/pong-avatar.tsx`
- Modify: `src/app.tsx`
- Test: `tests/player-session.test.ts`
- Test: `tests/room-socket.test.ts`
- Test: `tests/answer-board.test.tsx`
- Test: `tests/join-page.test.tsx`

**Interfaces:**
- Produces: `RoomSocket` with `connect`, `send`, `subscribe`, and `close`.
- Produces: `savePlayerSession`, `readPlayerSession`, and `clearPlayerSession`.
- Consumes: public `RoomSnapshot` and server events.

- [ ] **Step 1: Write storage and reconnect tests**

Assert that a player session is keyed by room code, malformed storage is removed, reconnect delays are capped and jittered, stale revisions are ignored, and reconnect sends `player.resume` before requesting a snapshot.

- [ ] **Step 2: Write accessible answer tests**

Render four answers. Press `2`, assert one answer message, visible `Answer locked`, disabled buttons, and an accessible selected label. Verify number keys do nothing when an input has focus. Verify failed images are removed without hiding the prompt.

- [ ] **Step 3: Run client tests and verify missing-module failures**

Run: `npm test -- tests/player-session.test.ts tests/room-socket.test.ts tests/answer-board.test.tsx tests/join-page.test.tsx`

Expected: FAIL because the client modules do not exist.

- [ ] **Step 4: Implement API, storage, and socket clients**

Use same-origin HTTP and WebSocket URLs. Reconnect with capped exponential backoff plus jitter. Replace client state on `room.snapshot`; apply incremental events only when their revision exceeds the current revision.

- [ ] **Step 5: Implement join and avatar components**

Normalize the code to six digits, trim the display name to 2 through 24 characters, show server validation errors inline, and navigate to `/play/:code` after a successful join receipt. Generate the avatar from the server-provided seed using local CSS shapes and an accessible text label.

- [ ] **Step 6: Implement player room states**

Render lobby, question, closed receipt, reveal, leaderboard, pause, removal, and podium states. Announce the timer at 10, 5, 4, 3, 2, and 1 seconds. Keep selected answer text visible after lock.

- [ ] **Step 7: Run player tests**

Run: `npm test -- tests/player-session.test.ts tests/room-socket.test.ts tests/answer-board.test.tsx tests/join-page.test.tsx`

Expected: PASS.

- [ ] **Step 8: Review the player diff without committing**

Run: `git diff -- src/lib src/components/join-page.tsx src/components/player-room.tsx src/components/answer-board.tsx src/components/pong-avatar.tsx tests`

Expected: no answer meaning depends on color or shape alone.

---

### Task 8: Host controls, shared display, leaderboard, and podium

**Files:**
- Create: `src/components/host-page.tsx`
- Create: `src/components/host-room.tsx`
- Create: `src/components/display-room.tsx`
- Create: `src/components/leaderboard.tsx`
- Create: `src/components/podium.tsx`
- Modify: `src/app.tsx`
- Test: `tests/host-room.test.tsx`
- Test: `tests/leaderboard.test.tsx`
- Test: `tests/podium.test.tsx`

**Interfaces:**
- Consumes: authenticated API calls, `RoomSocket`, host commands, and room snapshots.
- Produces: complete `/host`, `/host/:code`, and `/display/:code` experiences.

- [ ] **Step 1: Write host control tests**

Assert the lobby shows code, QR, count, lock toggle, and player removal. Assert each room state exposes only legal actions. Confirm `+15 seconds` sends one idempotent command and host warnings remain visible.

- [ ] **Step 2: Write leaderboard and podium tests**

Assert stable rank ordering, rank movement labels, top-ten display behavior, full host standings, podium ordering as second, first, third visually, and reduced-motion rendering without entrance animation.

- [ ] **Step 3: Run host tests and verify missing-component failures**

Run: `npm test -- tests/host-room.test.tsx tests/leaderboard.test.tsx tests/podium.test.tsx`

Expected: FAIL because the host and results components do not exist.

- [ ] **Step 4: Implement host login and quiz list**

Show one Google sign-in action when logged out. When logged in, list the seeded quiz with question count and `Start game`. Room creation navigates to `/host/:code`.

- [ ] **Step 5: Implement host room controls**

Show the six-digit code and locally generated QR code, connected and away counts, lock toggle, player removal, question preview, answer count, remaining time, persistence warning, and legal state action. Require confirmation only for ending an unfinished game.

- [ ] **Step 6: Implement display, leaderboard, and podium**

Keep display controls absent. Render projected question text and optional image, answer count without player choices, reveal explanation, rank movement, and the top-three podium. List all remaining players below the podium.

- [ ] **Step 7: Run host and client tests**

Run: `npm test -- tests/host-room.test.tsx tests/leaderboard.test.tsx tests/podium.test.tsx tests/answer-board.test.tsx`

Expected: PASS.

- [ ] **Step 8: Review the host diff without committing**

Run: `git diff -- src/components src/app.tsx tests`

Expected: projector routes contain no host command buttons or host tickets.

---

### Task 9: End-to-end flow, load check, deployment readiness, and manual handoff

**Files:**
- Create: `playwright.config.ts`
- Create: `e2e/event-flow.spec.ts`
- Create: `scripts/load-room.mjs`
- Create: `README.md`
- Modify: `.dev.vars.example`
- Modify: `package.json`

**Interfaces:**
- Consumes: the complete Worker, browser client, and protocol.
- Produces: repeatable smoke, load, seed, local fallback, and deployment commands.

- [ ] **Step 1: Write the browser event flow**

The test signs in through a test-only host-session fixture, creates a room, joins two player contexts, starts a five-second question, submits one correct and one wrong answer, reveals results, displays the leaderboard, finishes, and checks the podium. The fixture endpoint exists only when `PONG_TEST_MODE=1`; production requests receive `404`.

- [ ] **Step 2: Add the 200-client load script**

The script creates WebSocket clients in batches of 20, joins them with unique names, waits for one shared room revision, submits one answer per client, and fails unless every client receives the same closed-round revision within 10 seconds. It prints connection count, accepted answers, p50 and p95 receipt latency, divergent revisions, and failures.

- [ ] **Step 3: Add operator documentation**

Document local setup, secret names, Turso schema and seed, Google callback URLs, Wrangler login, deploy, smoke test, load test, projector route, venue checklist, and local fallback. Do not include real credentials.

- [ ] **Step 4: Run the full local verification**

Run: `npm test && npm run build && npm run test:e2e`

Expected: all tests pass, the Worker build completes, and the browser event flow reaches the podium.

- [ ] **Step 5: Run the local 200-client check**

Run the local Worker on Wrangler's default port, then run: `npm run load -- --base-url http://localhost:8787 --players 200`. In local test mode the script creates and destroys its own disposable room through guarded test endpoints.

Expected: 200 connected, 200 accepted answers, zero divergent revisions, and zero failed clients.

- [ ] **Step 6: Deploy when credentials are available**

Run: `npm run db:seed`, set Cloudflare secrets with Wrangler, then run `npm run deploy`. Add the deployed Google callback URL before testing host login.

Expected: one `*.workers.dev` URL serves player, host, display, API, and WebSocket routes.

- [ ] **Step 7: Run deployed smoke and load verification**

Run the browser smoke test against the deployed base URL, then run the 200-client load check against a disposable deployed room.

Expected: the smoke path reaches the podium and the load report has zero failed clients.

- [ ] **Step 8: Perform the manual commit-message review without committing**

Run `git status --short`, `git diff --stat`, `git diff`, inspect every untracked file, and run `git diff --cached` only if the user staged files. Draft one Conventional Commit subject and body for Angelo Laus. Do not stage or commit.
