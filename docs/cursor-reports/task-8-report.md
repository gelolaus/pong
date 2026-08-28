# Task 8 report — Host, display, leaderboard, podium

## GREEN

```text
npm test -- tests/host-room.test.tsx tests/leaderboard.test.tsx tests/podium.test.tsx
```

PASS

## Behavior

- Google sign-in when logged out; seeded quiz list and Start game when logged in
- Room code, QR, connected/away counts, join lock, and player removal
- Legal actions only for the current phase, including `+15 seconds`
- Persistence warning shown only on the host view
- Shared display has no host commands or tickets
- Display leaderboard is top 10; host standings are complete
- Podium visual order is second, first, third, then remaining standings
- Reduced-motion podium skips entrance animation

## Accessibility

- QR image has an accessible name
- Rank movement has text labels, not color alone
- End-game confirmation is a browser confirm for unfinished games
