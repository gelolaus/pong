# Pong event MVP design

**Date:** 2026-08-28  
**Status:** Approved in chat, pending written review  
**Deadline:** Same-day event, about two hours from project start  
**Capacity target:** 150 players in one room; verify with 200 simulated connections

## Goal

Ship a host-paced live quiz for today's event. Players join with a six-digit code and display name. The host runs a seeded "Programming Language or Pokemon" game, reveals results after each round, and ends on a top-three podium.

The event build must keep the live room usable through short connection losses. It must reject duplicate and late answers according to the server clock. A player who reconnects with the token stored on their device recovers the same score and identity.

## Delivery split

### Event build

- Google OAuth for the host, restricted to `hello@gelolaus.com`
- one seeded 20-question quiz
- optional image URL, 2 to 4 text answers, explanation, and timer per question
- six-digit room code and join QR code
- lobby with player removal and join locking
- host-paced question, close, reveal, leaderboard, and podium states
- 20-second default timer, adjustable from 5 to 120 seconds
- live `+15 seconds` control
- correctness-first scoring with a small speed bonus
- keyboard, screen-reader, reduced-motion, and high-contrast support
- Cloudflare deployment and a local Wrangler fallback
- Turso persistence at quiz, round, and session boundaries

### After the event

- browser-based quiz maker and richer game list management
- direct image upload and asset management
- quiz duplication, drafts, publishing, and playtesting
- analytics, exports, reusable themes, and additional game types
- multi-host permissions and a configurable email allowlist

The event build includes the database shape for multiple quizzes. It does not spend event preparation time on the general-purpose editor.

## Product routes

| Route | Audience | Purpose |
| --- | --- | --- |
| `/` | Player | Join with game code and display name |
| `/play/:code` | Player | Lobby, question, answer receipt, results, leaderboard, and podium |
| `/host` | Host | Google sign-in and quiz list |
| `/host/:code` | Host | Lobby moderation and live game controls |
| `/display/:code` | Shared screen | Question, answer count, round results, leaderboard, and podium without host controls |
| `/api/*` | Browser clients | Auth, quiz reads, room creation, and WebSocket upgrade |

The shared display route closes a gap in the original request. The host can keep controls on a laptop while a projector shows a clean audience view.

## Visual system

The selected direction is **Center Court**.

- Wantap contributes warm ink, coral accents, quiet host chrome, generous spacing, and restrained display type.
- Jose contributes cream play surfaces, chunky controls, physical button depth, short motion, friendly status copy, and immediate feedback.
- The Pong wordmark uses a ping-pong ball as the `o` and an exclamation mark for game-stage moments.
- Answer options use text and numbered keys. Color supports recognition but never carries the answer identity by itself.
- Player avatars are deterministic ping-pong characters generated from an avatar seed. No remote avatar service is required.
- Motion uses short paddle, bounce, and score-pop transitions. `prefers-reduced-motion` removes movement while preserving state changes.

The host dashboard stays calmer than the game stage. The projected display and player screen carry most of the color and motion.

## Runtime architecture

```text
React + Vite client
        |
Cloudflare Worker API and static assets
        |
        +-- Google OAuth and signed host session
        +-- Turso reads and writes
        +-- WebSocket upgrade
                 |
        Durable Object named by game code
                 |
        room state, timer, sockets, scoring
```

One Cloudflare Worker deployment serves the built React assets and API. Each game code maps to one Durable Object. That object is the authority for room state, deadlines, accepted answers, scores, and broadcasts.

Turso stores quiz content, session records, player results, and accepted answers. It does not coordinate live broadcasts. Round play continues when Turso has a short outage; the Durable Object queues the round snapshot for another persistence attempt.

Local development uses Wrangler and the same Durable Object implementation. A local SQLite-compatible test adapter replaces remote Turso calls in tests. The local runtime is also the event fallback if cloud deployment cannot be completed.

## Authentication

Only host routes require an account. Players never create accounts.

1. `/api/auth/google` creates a state value and PKCE verifier, stores them in a short-lived signed cookie, and redirects to Google.
2. The callback exchanges the code, verifies the ID token issuer, audience, nonce, and email verification status, then compares the normalized email to `hello@gelolaus.com`.
3. An allowed login receives an HTTP-only, secure, same-site host session cookie signed with `AUTH_SECRET`.
4. A disallowed login receives a plain access-denied screen and no session.
5. Host WebSocket connections use a short-lived signed room ticket issued by the authenticated Worker API. The Durable Object checks the ticket before accepting host commands.

Required secrets:

- `AUTH_GOOGLE_ID`
- `AUTH_GOOGLE_SECRET`
- `AUTH_SECRET`
- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`

No password tables, password reset routes, or signup routes are included.

## Room state

The room has these states:

```text
lobby -> question_open -> question_closed -> round_reveal
      -> leaderboard -> question_open ... -> finished
```

- **Lobby:** players join, reconnect, or are removed. The host can lock new joins.
- **Question open:** the server publishes the question, choices, and absolute deadline. It does not publish the correct answer.
- **Question closed:** the timer expired or the host closed answers. Players wait for the host.
- **Round reveal:** correctness, explanation, earned points, streak, and rank movement are visible.
- **Leaderboard:** the shared display shows the leading players. The full ranked list remains available to the host.
- **Finished:** the top three appear on the podium and the complete standings are saved.

The host starts every question and manually advances every reveal. Timer expiry closes answers but does not advance the room.

## Live protocol

Client messages:

- `player.join`
- `player.resume`
- `player.answer`
- `host.lock_joining`
- `host.remove_player`
- `host.open_question`
- `host.extend_time`
- `host.close_question`
- `host.reveal_round`
- `host.show_leaderboard`
- `host.next_question`
- `host.end_game`

Server messages:

- `room.snapshot`
- `lobby.updated`
- `question.opened`
- `question.closed`
- `answer.received`
- `round.revealed`
- `leaderboard.updated`
- `game.finished`
- `room.paused`
- `error`

Every message has a protocol version, room revision, event type, and payload. Clients discard older revisions. Host commands include an idempotency key so a retry cannot open or reveal the same round twice.

## Player identity and reconnects

A successful join returns a player ID and a random reconnect token. The browser stores the room code, player ID, and token locally. Only a token hash is stored by the server.

- A disconnected player keeps their place, score, streak, and submitted answer.
- The UI marks the player as reconnecting immediately and as away after 30 seconds.
- The reconnect token can reclaim the identity for the rest of the active room, even after the 30-second status grace period.
- Removing a player invalidates the token.
- Duplicate display names receive a short numeric suffix. The stored original name is unchanged for moderation records.

The player client reconnects with capped exponential backoff and jitter. It requests a full room snapshot after reconnecting instead of replaying missed incremental events.

## Timer and scoring

The Durable Object records `openedAt`, `baseDeadline`, and `answerDeadline` using server time.

- Default duration: 20 seconds
- Allowed per-question duration: 5 to 120 seconds
- Untimed questions: supported after the event, not exposed in today's host controls
- `+15 seconds`: extends `answerDeadline`
- The speed bonus reaches zero at `baseDeadline`; extension time allows the 1,000 correctness points but does not restore speed points.

For a correct answer submitted before `baseDeadline`:

```text
speedBonus = round(250 * (1 - responseMs / baseDurationMs))
points = 1000 + clamp(speedBonus, 0, 250)
```

A correct answer during added time receives 1,000 points. Wrong, missing, duplicate, or late answers receive zero. Streak is displayed but does not add points in the event build.

The server accepts at most one answer per player and question. The unique key is `(sessionId, questionId, playerId)`. The first accepted answer wins.

## Persistence

Turso tables:

- `users`: host identity and normalized email
- `quizzes`: title, status, created and updated timestamps
- `questions`: order, prompt, image URL, answers JSON, correct index, explanation, and timer
- `game_sessions`: quiz, code, state, current question, host, and timestamps
- `session_players`: display name, avatar seed, token hash, score, streak, connection status, and last seen time
- `answers`: selected index, receipt time, response duration, correctness, points, and idempotency key

The database enforces unique room codes for active sessions and one answer per player per question. The Durable Object stores the current room snapshot in its own storage after each state transition. Turso receives batched answer and standings writes when a round closes, then a final session write at game end.

## Quiz seed

The repository contains a typed 20-question seed for "Programming Language or Pokemon." Each record passes the same schema validation used for database reads.

Images are optional URLs in today's build. A missing or failed image leaves the prompt and answers fully usable. Direct upload needs object storage, image validation, and deletion rules, so it remains post-event work.

The seed avoids ambiguous entries unless the answer set explicitly includes `Both`. Each explanation states what the term is in one short sentence.

## Accessibility

- All answers show their full text and a visible number from 1 to 4.
- Number keys work when focus is not in an editable field.
- Answer buttons have at least a 44 by 44 pixel target.
- Focus indicators remain visible against every answer surface.
- Correct, incorrect, selected, and unavailable states pair color with text and icons.
- The timer has a numeric value and progress bar. Screen readers receive announcements at 10 and 5 seconds, then each final second.
- Dynamic status uses polite live regions. Errors and removal notices use alert semantics.
- Reduced-motion mode removes bounce, shake, confetti, and podium movement.
- The host can add time or close a round early without requiring drag gestures.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Player connection drops | Reconnect with stored token and replace state from a room snapshot |
| Host connection drops | Pause the room; keep the deadline from advancing the flow |
| Duplicate answer arrives | Return the original receipt; do not change points |
| Answer arrives after deadline | Reject with `ANSWER_CLOSED` and server timestamp |
| Turso write fails | Keep the room active, queue one retry, and show the host a persistence warning |
| Question image fails | Hide the broken image region and keep text answers usable |
| Host refreshes | Restore host controls from the Durable Object snapshot |
| Player is removed | Close that socket, invalidate its token, and show a removal message |
| Worker deploy fails | Run the same build through local Wrangler and expose it with a tunnel only if needed |

## Verification

Unit tests cover:

- score boundaries and added-time behavior
- timer transitions
- one-answer enforcement
- idempotent host commands
- reconnect token hashing and validation
- duplicate display-name suffixes
- quiz seed validation
- host email allowlist normalization

Worker tests cover room creation, joins, reconnects, answer rejection, host authorization, state transitions, and Turso retry behavior. Client tests cover keyboard answers, focus, live status, broken images, and reduced motion.

One browser smoke test runs a host and two players through a complete short game. A Node load script opens 200 WebSocket clients against one room, joins them, submits one answer each, and checks that every client receives the same room revision and leaderboard.

## Deployment checklist

1. Authenticate Wrangler with the intended Cloudflare account.
2. Create a separate Pong Turso database and token. Do not point Pong at Wantap's production tables.
3. set the five required secrets in Cloudflare.
4. Add the deployed callback URL to the existing Google OAuth client or create a Pong client.
5. apply the Turso schema and seed.
6. deploy the Worker and assets together.
7. run the browser smoke test against the deployed URL.
8. run the 200-client load check against a disposable room.
9. test the projector view and host controls on the venue network.
10. keep the local Wrangler command and last known quiz seed ready as the fallback.

## Acceptance criteria

1. `hello@gelolaus.com` can sign in; any other Google email is rejected.
2. At least 150 players can join one room by code and display name.
3. A 200-client load run completes one question without duplicate scores or divergent room revisions.
4. The host can lock joining, remove a player, start and close a question, add time, reveal results, show the leaderboard, advance, and end the game.
5. Reconnecting with the stored token restores identity, score, streak, and current room state.
6. Every answer works by touch and keyboard and remains understandable without color.
7. Each round reveals correctness, explanation, points, streak, rank, and movement.
8. The final view shows a top-three podium and complete standings.
9. A short Turso outage does not stop the current round.
10. No files are staged or committed by Codex.
