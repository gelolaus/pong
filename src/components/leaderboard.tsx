type Standing = {
  id: string;
  displayName: string;
  score: number;
  streak: number;
  rank: number | null;
  rankMovement: number;
  connected?: boolean;
};

type LeaderboardProps = {
  standings: Standing[];
  variant?: "display" | "host";
  currentPlayerId?: string;
};

export function Leaderboard({ standings, variant = "display", currentPlayerId }: LeaderboardProps) {
  const rows = variant === "display" ? standings.slice(0, 10) : standings;
  return (
    <ol className="leaderboard" aria-label={variant === "host" ? "Full standings" : "Top players"}>
      {rows.map((player) => (
        <li
          key={player.id}
          className={`leaderboard-row ${currentPlayerId === player.id ? "is-you" : ""}`}
        >
          <span className="rank">{player.rank ?? "—"}</span>
          <span className="name">{player.displayName}{currentPlayerId === player.id ? " (you)" : ""}</span>
          <span className="movement" aria-label={movementLabel(player.rankMovement)}>{movementText(player.rankMovement)}</span>
          <span className="score">{player.score}</span>
        </li>
      ))}
    </ol>
  );
}

function movementText(movement: number) {
  if (movement > 0) return `▲ ${movement}`;
  if (movement < 0) return `▼ ${Math.abs(movement)}`;
  return "•";
}

function movementLabel(movement: number) {
  if (movement > 0) return `Up ${movement} ${movement === 1 ? "place" : "places"}`;
  if (movement < 0) return `Down ${Math.abs(movement)} ${movement === -1 ? "place" : "places"}`;
  return "No rank change";
}
