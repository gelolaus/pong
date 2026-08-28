# Task 7 report — Player client

## GREEN

```text
npm test -- tests/player-session.test.ts tests/room-socket.test.ts tests/answer-board.test.tsx tests/join-page.test.tsx
```

PASS

## Behavior

- Same-origin HTTP and WebSocket URLs
- Capped exponential reconnect with jitter
- Session storage keyed by room code; malformed values are cleared
- Resume on reconnect after a successful join
- Join validation: six-digit code and display name 2–24 characters
- Number keys 1–4 unless an editable field is focused
- Broken images hide without removing the prompt
- Timer announcements at 10, 5, 4, 3, 2, and 1 seconds
- Lobby, question, locked, closed, reveal, leaderboard, pause, removal, and podium states

## Accessibility

- 44px minimum answer targets
- Selected/correct/incorrect use text and icons, not color alone
- Polite live regions for timer and status; alerts for removal
- Reduced-motion CSS remains in `src/styles.css`
