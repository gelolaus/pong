# Pong implementation progress

Tracked ledger for Cursor Cloud sessions. The design spec and implementation plan remain the product authority.

## Status

- Tasks 1–9: complete for local verification
- Cloudflare production deploy is blocked until Angelo supplies credentials and approves `npm run deploy`

## Task 4 — Turso repository

Complete. Report: `docs/cursor-reports/task-4-report.md`

- Focused: `npm test -- tests/db.test.ts tests/quiz.test.ts` PASS
- Regression: `npm test` PASS
- Build: `npm run build` PASS

## Task 5 — Google OAuth and host tickets

Complete. Report: `docs/cursor-reports/task-5-report.md`

- Focused: `npm test -- tests/auth.test.ts` PASS (5)
- Allowlist is applied only after verified Google claims
- One-minute room tickets fail closed for missing, expired, and wrong-room values

## Task 6 — Durable Object and Worker API

Complete. Report: `docs/cursor-reports/task-6-report.md`

- Focused: `npm test -- tests/worker` PASS
- Hibernation-ready `PongRoom`, host tickets, private welcome/receipts, alarm close, Turso retry warning
- Test fixtures return 404 unless `PONG_TEST_MODE=1`

## Task 7 — Player client

Complete. Report: `docs/cursor-reports/task-7-report.md`

- Focused: `npm test -- tests/player-session.test.ts tests/room-socket.test.ts tests/answer-board.test.tsx tests/join-page.test.tsx` PASS

## Task 8 — Host, display, leaderboard, podium

Complete. Report: `docs/cursor-reports/task-8-report.md`

- Focused: `npm test -- tests/host-room.test.tsx tests/leaderboard.test.tsx tests/podium.test.tsx` PASS
- Projector route has no host commands

## Task 9 — E2E, load, docs

Complete. Report: `docs/cursor-reports/task-9-report.md`

- `npm test` PASS (16 files, 56 tests)
- `npm run build` PASS
- `npm run test:e2e` PASS (podium reached)
- `npm run load -- --base-url http://127.0.0.1:5173 --players 200` PASS: 200 connected, 200 accepted, 0 divergent revisions, 0 failures

## Deferred minors

- Task 2: `scoreAnswer` assumes a positive finite base duration; protocol tests do not cover invalid protocol-version/revision values
- Task 3: `isPlayerAway` can label a removed player away; one finish test name is inaccurate
- Task 4: `SCHEMA_SQL` in `worker/db.ts` is duplicated from `worker/schema.sql`
- `player.welcome` was added to the WebSocket protocol so join can return a private reconnect token without leaking it in public snapshots

## Rulings

- Do not deploy without Angelo's credentials and explicit approval.
- Host allowlist remains `hello@gelolaus.com` only.
- No real secrets in Git.
- Local verification used `PONG_TEST_MODE=1` and an in-memory repository because Turso credentials were not provided.
