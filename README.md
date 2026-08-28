# Pong

Live, host-paced quiz rooms for an event crowd. Players join with a six-digit code and a display name. Only `hello@gelolaus.com` can host, through Google.

## Local development

```bash
cp .dev.vars.example .dev.vars
# fill AUTH_* and TURSO_* values
npm install
npm test
npm run dev
```

`npm run dev` serves the Vite client and Cloudflare Worker together. Open `/` to join and `/host` to sign in.

Required `.dev.vars` names (never commit real values):

- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `AUTH_SECRET`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `PONG_TEST_MODE` (`0` in production)

Google callback URL:

```text
http://localhost:5173/api/auth/google/callback
```

## Database

Create a dedicated Turso database for Pong. Then:

```bash
npm run db:seed
```

The command applies `worker/schema.sql` and upserts the 20-question event quiz. It prints record counts only.

## Tests

```bash
npm test
npm run build
npm run test:e2e
```

End-to-end tests enable `PONG_TEST_MODE=1` and a dummy `AUTH_SECRET`. Fixture routes return 404 unless that flag is set.

## Load check

Start the local Worker, then:

```bash
PONG_TEST_MODE=1 npm run dev
npm run load -- --base-url http://localhost:5173 --players 200
```

The script opens 200 WebSocket clients in batches of 20, joins one disposable room, submits one answer each, and fails unless every client receives the same closed-round revision within 10 seconds.

## Deploy

1. Authenticate Wrangler to the intended Cloudflare account.
2. Create the Pong Turso database and token.
3. Set Cloudflare secrets: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`.
4. Add the deployed `/api/auth/google/callback` URL to the Google OAuth client.
5. Run `npm run db:seed` against that database.
6. Run `npm run deploy` only after the operator approves publishing.
7. Smoke-test `/`, `/host`, `/display/:code`, and a 200-client load run against a disposable room.

Keep local Wrangler as the venue fallback if deployment is blocked.

## Venue

- Host laptop: `/host/:code`
- Projector: `/display/:code`
- Players: join at `/` with the six-digit code
- Default timer is 20 seconds; the host can add 15 seconds or close early
- Timer expiry closes answers; the host still reveals and advances
