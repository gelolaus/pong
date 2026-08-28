# Task 4 report — Turso repository

## RED

Command:

```text
npm test -- tests/db.test.ts
```

Result before implementation:

- Failed to resolve `../worker/db`
- `toMatchObject<PongRepositoryError>` used an unsupported Vitest generic at the conflict assertion

The missing-module failure was the intended TDD checkpoint.

## GREEN

Corrected the conflict assertion to a typed `Pick<PongRepositoryError, "code">` literal so Vitest accepts it without weakening `{ code: "conflict" }`.

Created:

- `worker/schema.sql` — idempotent `IF NOT EXISTS` tables and indexes
- `worker/db.ts` — `TursoTransport`, `PongRepository`, `PongRepositoryError`, `applySchema`, `createTursoRepository`
- `scripts/seed-turso.ts` — reads Turso env vars, applies schema.sql, upserts the event quiz, prints counts only

Commands:

```text
npm test -- tests/db.test.ts tests/quiz.test.ts
```

PASS: 2 files, 8 tests

```text
npm test
```

PASS: 6 files, 31 tests

```text
npm run build
```

PASS: Worker and client production builds

## Behavior

- Schema application is repeatable (`IF NOT EXISTS`)
- Quiz rows parse through `quizSchema`, preserving question order and optional image URLs
- Duplicate active room codes map to `conflict`
- `saveRound` retries one transient batch failure
- Answer inserts use `ON CONFLICT DO NOTHING` so a retry cannot duplicate the unique `(session_id, question_id, player_id)` row
- Database errors map to `transient`, `conflict`, or `invalid_data`
- Error messages do not include SQL, URLs, or tokens
- Seed refuses to run without env vars and never prints secret values
- Unit tests inject `FakeTransport` and do not contact Turso

## Security review

- No credentials in source
- Transport is injectable; tests never open a network database
- Unique active room-code index and one-answer unique index are in schema
- Repository errors are generic; underlying driver messages stay in `cause` for logs, not client payloads

## Remaining risks

- Live Turso seeding and Cloudflare secrets still require Angelo
- `SCHEMA_SQL` must stay aligned with `worker/schema.sql`
