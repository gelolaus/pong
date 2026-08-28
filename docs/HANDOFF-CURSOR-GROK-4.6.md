# Pong implementation handoff for Cursor Grok 4.6

## Instruction to the next AI

Continue the Pong event MVP in `C:\Users\gelo\Desktop\dev\pong` from the current working tree. Do not restart, scaffold a second app, rewrite completed modules, stage files, commit, push, deploy, or alter the user's other repositories.

Read the files listed below before editing. The design spec is the product authority. The implementation plan defines task order. The SDD ledger tells you what is complete and what was interrupted.

The current resume point is **Task 4 at RED**. Tasks 1 through 3 are complete, tested, reviewed, and must be treated as existing contracts.

This handoff is intended for a cloud clone. The local `.superpowers` directory is ignored by Git and will not exist in Cursor Cloud. All requirements needed to continue are repeated in this tracked document and the tracked implementation plan.

## Non-negotiable user instructions

1. Do not run `git add`, `git commit`, `git push`, or create a pull request.
2. Angelo Laus must perform the commit personally.
3. At the end, inspect every changed and untracked file and draft a Conventional Commit message using the manual GitHub commit-message format. Do not commit it.
4. Only `hello@gelolaus.com` may sign in as host through Google OAuth. No password flow.
5. Players use only a six-digit game code and display name. No player account.
6. The target room size is 150 players. The load check must simulate 200 clients.
7. The host controls the pace. Timer expiry closes answers; it never reveals or advances automatically.
8. Use Cloudflare Workers Static Assets plus one Durable Object per room. Use Turso for durable quiz and result storage, not live broadcasts.
9. Preserve accessibility: full answer text, number keys, visible focus, at least 44 by 44 pixel touch targets, screen-reader status, and reduced motion.
10. Do not read, copy, print, or modify secrets from `C:\Users\gelo\Desktop\dev\wantap.cc\.env`. Pong needs its own `.dev.vars` and Cloudflare secrets.

## Read order

Read these files in order:

1. `docs/superpowers/specs/2026-08-28-pong-event-mvp-design.md`
2. `docs/superpowers/plans/2026-08-28-pong-event-mvp.md`
3. `src/domain/quiz.ts`
4. `src/domain/scoring.ts`
5. `src/domain/protocol.ts`
6. `worker/room-state.ts`
7. `tests/db.test.ts`

Create `docs/IMPLEMENTATION-PROGRESS.md` when work resumes. Record task completions, review findings, test commands, and any rulings there so progress survives future cloud sessions. Do not reconstruct or depend on the ignored local `.superpowers` directory.

## Product summary

Pong is a Kahoot-style live quiz designed for an event with 150 attendees. The first game is "Programming Language or Pokemon." The host signs in with Google, starts a room, shares a code and QR, controls each question, reveals results, shows the leaderboard, and ends on a top-three podium.

Players join without accounts. They answer from their phones using large text buttons or keys 1 through 4. The server owns timers and scores. Reconnecting with the token stored on the player's device restores identity, answer receipt, score, streak, and room state.

The visual direction is **Center Court**:

- warm cream play surface
- warm black ink chrome
- coral primary accent
- sky, gold, and leaf secondary answer colors
- rounded display type
- tactile 3D button depth
- ping-pong motion that disappears under `prefers-reduced-motion`
- calmer host dashboard, brighter player and projector stages

## Approved architecture

```text
React + Vite client
        |
Cloudflare Worker API and static assets
        |
        +-- Google OAuth and signed host session
        +-- Turso reads and round/session writes
        +-- WebSocket upgrade
                 |
        Durable Object named by six-digit game code
                 |
        room state, sockets, alarms, answers, scoring
```

The Durable Object is the authority for the active room. Turso must not delay answer acceptance, state transitions, or broadcasts. Save round results after close, and retry a transient Turso failure without stopping gameplay.

The host uses a short-lived room-bound ticket to open the privileged WebSocket. Players receive random reconnect tokens; only token hashes belong in private server state. Never expose raw tokens, hashes, correct indexes, or explanations in public snapshots while a question is open.

## Current verified state

The repository has no commits. Every file is untracked by Git. This is expected and must remain so until Angelo commits.

Installed dependencies include React, Vite, Cloudflare's Vite plugin, Wrangler, Hono, Zod, jose, Turso's serverless SDK, Vitest, Testing Library, Playwright, QRCode, and TypeScript.

Verified immediately before this handoff:

```text
npm test -- tests/app.test.tsx tests/quiz.test.ts tests/scoring.test.ts tests/protocol.test.ts tests/room-state.test.ts

5 test files passed
27 tests passed
```

The full build currently fails on purpose because Task 4 has only its failing test:

```text
tests/db.test.ts: cannot resolve ../worker/db
tests/db.test.ts:85: toMatchObject<PongRepositoryError> uses an unsupported generic
```

Fix the second test typing issue during Task 4. Remove the unsupported generic argument or replace it with a typed literal that Vitest accepts. Do not weaken the behavioral assertion.

Task 4's focused RED command is:

```text
npm test -- tests/db.test.ts
```

It currently fails because `worker/db.ts` does not exist. This is the correct TDD checkpoint.

## Completed work

### Task 1: Cloudflare React foundation

Complete and reviewed.

Important files:

- `package.json`
- `vite.config.ts`
- `vitest.config.ts`
- `wrangler.jsonc`
- `worker/env.ts`
- `worker/index.ts`
- `src/main.tsx`
- `src/app.tsx`
- `src/styles.css`
- `tests/app.test.tsx`

Contracts:

- `Env` already declares `ROOMS`, `ASSETS`, Google auth secrets, Turso secrets, and `PONG_TEST_MODE`.
- Wrangler already binds `ROOMS` to `PongRoom` with SQLite storage.
- App route shells exist for `/`, `/play/:code`, `/host`, `/host/:code`, and `/display/:code`.
- Root join form is functional at shell level.
- Center Court tokens, focus treatment, responsive layout, and reduced-motion CSS exist.

Deferred minor: `index.html` needs a full document shell, `lang="en"`, and Pong title during Task 9.

### Task 2: Domain schemas, seed, scoring, protocol

Complete and reviewed after one fix round.

Important exports:

- `Question`, `Quiz`, `eventQuiz`, `quizSchema` from `src/domain/quiz.ts`
- `scoreAnswer` from `src/domain/scoring.ts`
- `ClientMessage`, `ServerMessage`, `RoomSnapshot`, schemas, and `PROTOCOL_VERSION` from `src/domain/protocol.ts`

The event seed contains 20 validated, unambiguous entries with two answers: `Programming language` and `Pokemon`. Each question has a 20-second timer and a short explanation. Optional image URLs are supported.

Scoring:

```text
wrong = 0
correct = 1000 + round(250 * remaining base-time fraction)
correct after the original deadline but during extension = 1000
```

Public question schemas are strict. An outbound open-question payload containing `correctIndex` or `explanation` is rejected instead of silently stripped.

Deferred minors:

- `scoreAnswer` assumes a positive finite base duration. Quiz schema already enforces 5 through 120 seconds.
- Protocol tests do not directly cover invalid protocol-version and revision values.

### Task 3: Pure room transitions

Complete and reviewed after one fix round.

Important file: `worker/room-state.ts`

Important exports:

- `createRoomState`
- `joinPlayer`
- `resumePlayer`
- `removePlayer`
- `setJoinLocked`
- `openQuestion`
- `extendTime`
- `closeQuestion`
- `acceptAnswer`
- `revealRound`
- `showLeaderboard`
- `advanceQuestion`
- `finishGame`
- public-snapshot and rank helpers defined by that module

Behavior already covered:

- immutable accepted and rejected transitions
- exactly one revision increment per accepted transition
- one answer per player and question
- server deadlines
- host command idempotency
- added-time correctness without restored speed points
- SHA-256 reconnect-token hashes
- removal invalidates reconnect
- first available duplicate-name suffix (`Alex`, `Alex 2`, then `Alex 3`)
- players with real responses rank ahead of unanswered equal-score players
- score descending, response duration ascending, join order tie-break
- 30-second away threshold

Do not send the private `RoomState` over a socket. Derive public snapshots and private receipts.

Deferred minors:

- `isPlayerAway` can label a removed player away. Task 6 must keep removal as the terminal public status.
- One finish test has an inaccurate name about its starting phase. Correct the test name if that file is touched again.

## Exact resume instructions

### Resume Task 4: Turso repository

Only `tests/db.test.ts` exists from Task 4. The prior agent was interrupted before production code or a report was written.

Read Task 4 in `docs/superpowers/plans/2026-08-28-pong-event-mvp.md`, then:

1. Run `npm test -- tests/db.test.ts` and confirm it fails because `../worker/db` is missing.
2. Fix the unsupported Vitest generic at `tests/db.test.ts:85` without changing the expected conflict code.
3. Create `worker/schema.sql` with idempotent `IF NOT EXISTS` statements for:
   - `users`
   - `quizzes`
   - `questions`
   - `game_sessions`
   - `session_players`
   - `answers`
4. Enforce unique active room codes and one answer per `(session_id, question_id, player_id)`.
5. Create `worker/db.ts` with:
   - `TursoTransport`
   - `PongRepository`
   - `PongRepositoryError`
   - `applySchema`
   - `createTursoRepository`
   - methods `listQuizzes`, `getQuiz`, `createSession`, `saveRound`, and `finishSession`
6. Keep transport injectable. Existing `FakeTransport` in `tests/db.test.ts` defines the desired testing boundary.
7. Retry one transient round batch failure. Use idempotent answer inserts so retry cannot duplicate accepted answers.
8. Parse database quiz rows through the real `quizSchema`.
9. Create `scripts/seed-turso.ts`. It reads only `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, applies schema, upserts the stable event quiz, replaces ordered questions in a batch, and prints counts without secret values.
10. Run:

```text
npm test -- tests/db.test.ts tests/quiz.test.ts
npm test
npm run build
```

11. Write `docs/cursor-reports/task-4-report.md` with RED and GREEN evidence.
12. Review only Task 4 files against the brief. Fix Important findings before marking Task 4 complete in the ledger.

Do not connect to a live Turso database during tests.

## Remaining task order

Complete tasks sequentially because their interfaces build on each other.

### Task 5: Google OAuth and host tickets

Requirements: Task 5 in `docs/superpowers/plans/2026-08-28-pong-event-mvp.md` plus the constraints below.

Create `worker/auth.ts` and `tests/auth.test.ts` with strict TDD.

Required behavior:

- Google Authorization Code flow with state, nonce, and SHA-256 PKCE
- verify Google ID token issuer, audience, nonce, email verification, and normalized email
- allow only `hello@gelolaus.com`
- HTTP-only session cookie
- `SameSite=Lax`
- `Secure` outside local development
- session cookie path `/`
- signed short-lived host session using `jose`
- one-minute ticket bound to host subject, room code, audience `pong-room`, issue time, and expiry
- missing, expired, and wrong-room tickets fail closed

Inject fetch and time at external boundaries. Unit tests must not contact Google.

Run focused tests, full tests, and build. Write a Task 5 report and review it before Task 6.

### Task 6: Durable Object and Worker API

Requirements: Task 6 in `docs/superpowers/plans/2026-08-28-pong-event-mvp.md` plus the constraints below.

This is the main integration task. Use `gpt-5.6`-level reasoning if Cursor allows model selection.

Create `worker/room.ts`; complete `worker/index.ts`; add `tests/worker/room.test.ts` and `tests/worker/api.test.ts`.

Required behavior:

- Hibernation WebSocket API through `state.acceptWebSocket`
- serialized socket attachment with role, room code, and player ID
- validate every incoming message through `clientMessageSchema`
- protocol errors return an error event; repeated violations close the socket
- private join token and answer receipts go only to the requesting player
- public broadcasts never expose private room state or correct answers during open questions
- write Durable Object snapshot after accepted transitions
- alarm at `answerDeadline` closes answers only
- host manually reveals and advances
- call Turso after round close, outside broadcast latency
- transient Turso failure adds host-only warning and one retry
- auth routes, quiz list, room create/read, socket upgrade, and static fallback
- guarded fixture endpoints exist only when `PONG_TEST_MODE=1`; production returns 404
- removed players remain removed, not merely away

Do not bypass the pure functions in `worker/room-state.ts` by writing a second room engine.

### Task 7: Player client

Create:

- `src/lib/api.ts`
- `src/lib/room-socket.ts`
- `src/lib/player-session.ts`
- `src/components/join-page.tsx`
- `src/components/player-room.tsx`
- `src/components/answer-board.tsx`
- `src/components/pong-avatar.tsx`
- matching tests

Required behavior:

- same-origin HTTP and WebSocket URLs
- capped exponential reconnect backoff with jitter
- stored room code, player ID, and raw reconnect token
- resume before requesting full snapshot
- replace state on snapshot; ignore stale revisions
- join validation: six digits and display name 2 through 24 trimmed characters
- local deterministic ping-pong avatar
- lobby, open question, locked receipt, close, reveal, leaderboard, pause, removal, and podium states
- number keys 1 through 4 unless focus is in an editable control
- one answer send only
- broken images disappear without hiding prompt or answers
- timer announcements at 10, 5, 4, 3, 2, and 1 seconds
- reduced motion

### Task 8: Host and projector client

Create:

- `src/components/host-page.tsx`
- `src/components/host-room.tsx`
- `src/components/display-room.tsx`
- `src/components/leaderboard.tsx`
- `src/components/podium.tsx`
- matching tests

Required behavior:

- Google login when signed out
- seeded quiz list and Start game
- room code and QR
- connected and away counts
- join lock and player removal
- legal host actions for the current room phase only
- `+15 seconds`
- close, reveal, leaderboard, next, end
- persistence warning shown only to host
- shared display has no host commands or host ticket
- top 10 on shared leaderboard, full standings for host
- final podium orders second, first, third visually, followed by remaining standings
- reduced-motion podium has no entrance movement

### Task 9: End-to-end, load, deployment readiness, handoff

Create:

- `playwright.config.ts`
- `e2e/event-flow.spec.ts`
- `scripts/load-room.mjs`
- `README.md`

Finish `index.html` with standards doctype, language, metadata, and Pong title.

Required verification:

```text
npm test
npm run build
npm run test:e2e
```

The load script must create 200 WebSocket clients in batches of 20, join one disposable room, submit one answer each, and fail unless every client receives the same closed-round revision within 10 seconds. Print connected count, accepted count, p50 and p95 receipt latency, divergent revisions, and failures.

The local load command should be:

```text
npm run load -- --base-url http://localhost:8787 --players 200
```

Guard all test fixture endpoints behind `PONG_TEST_MODE=1`.

## TDD and review rules

For each remaining task:

1. Write one behavioral test first.
2. Run it and confirm it fails for the intended missing behavior, not a typo.
3. Add the smallest production change that passes.
4. Run the focused test.
5. Run affected tests.
6. Run the full suite and build before declaring the task complete.
7. Read the task diff or exact changed files against the brief.
8. Fix every Critical or Important review issue.
9. Record deferred Minor issues in `docs/IMPLEMENTATION-PROGRESS.md`.
10. Write `docs/cursor-reports/task-N-report.md` with RED/GREEN commands and output.
11. Do not commit.

Tests should exercise real code. Mock only the external Google and Turso network boundary. Do not assert that mocks exist; assert the application's observable behavior.

## Deployment requires user participation

Do not invent, expose, or reuse credentials.

When all local verification is green, ask Angelo to complete or approve these external steps:

1. Authenticate Wrangler to the intended Cloudflare account.
2. Create a separate Pong Turso database and token.
3. Place local secrets in `.dev.vars`, which is ignored by Git.
4. Set Cloudflare secrets:
   - `AUTH_GOOGLE_ID`
   - `AUTH_GOOGLE_SECRET`
   - `AUTH_SECRET`
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
5. Add the deployed Google callback URL to the OAuth client.
6. Run the Turso schema and seed command.
7. Deploy with `npm run deploy` only after the user approves publishing.
8. Run smoke and 200-client checks against a disposable deployed room.

If Cloudflare deployment is blocked, keep the verified Wrangler local runtime as the fallback. Do not claim the event is ready until the 200-client check passes against the environment attendees will use.

## Final manual commit-message handoff

After all implementation and verification, run read-only Git inspection:

```text
git status --short
git diff --stat
git diff
git diff --cached   # only if Angelo staged files
```

Because the repository currently has no commit, normal `git diff` will not show untracked content. Inspect every untracked file explicitly before drafting the message.

Return the commit text in this format, adjusted to the actual final files:

```text
feat(game): launch real-time Pong quiz rooms

- add host-only Google authentication and Turso-backed quiz persistence
- coordinate 150-player rooms through Cloudflare Durable Object WebSockets
- add accessible player, host, leaderboard, and podium experiences
```

Then write:

```text
Created by: Angelo Laus
```

Do not stage or commit the files.

## Definition of done

Do not call Pong complete unless all items below are true:

- `hello@gelolaus.com` signs in and another verified Google email is rejected
- 150 players can join one room by code and display name
- 200 simulated clients complete one question with zero divergent revisions or duplicate scores
- host can lock joins, remove a player, start, extend, close, reveal, show leaderboard, advance, and end
- reconnect restores identity, score, streak, receipt, and current state
- answers work by touch, keyboard, and screen reader without relying on color
- every round shows correctness, explanation, points, streak, rank, and movement
- final view shows top-three podium plus full standings
- a short Turso outage does not stop the active round
- all tests, build, browser smoke, and load checks pass
- no file was staged or committed by the AI
