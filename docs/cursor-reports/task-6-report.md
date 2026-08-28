# Task 6 report — Durable Object and Worker API

## RED

`tests/worker/api.test.ts` and `tests/worker/room.test.ts` failed until `PongRoom`, `RoomController`, and HTTP routes existed.

## GREEN

```text
npm test -- tests/worker tests/auth.test.ts
```

PASS: 11 tests

```text
npm test
npm run build
```

PASS after the remaining client tasks landed.

## Behavior

- Auth, quiz list, room create, snapshot, host ticket refresh, and WebSocket upgrade
- Durable Object owns room transitions through `worker/room-state.ts`
- Private `player.welcome` and `answer.received` events
- Alarm closes answers only
- Transient persistence failure warns the host and retries once
- `PONG_TEST_MODE=1` fixtures; otherwise 404
- Removed players stay removed

## Security / accessibility

- Host commands require a room-bound ticket
- Unauthenticated quiz list and room create return 401
- Public snapshots omit correct answers while questions are open
- Test fixtures cannot be used in production (`PONG_TEST_MODE=0`)

## Remaining risks

- Production needs Turso; local test mode uses an in-memory repository
