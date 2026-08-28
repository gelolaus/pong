import { useEffect, useState } from "react";

type Standing = {
  id: string;
  displayName: string;
  score: number;
  rank: number | null;
};

type PodiumProps = {
  standings: Standing[];
};

export function Podium({ standings }: PodiumProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(media.matches);
    const listener = () => setReducedMotion(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  const first = standings.find((player) => player.rank === 1);
  const second = standings.find((player) => player.rank === 2);
  const third = standings.find((player) => player.rank === 3);
  const rest = standings.filter((player) => (player.rank ?? 99) > 3);

  return (
    <section className={`podium ${reducedMotion ? "" : "podium-animated"}`} data-testid="podium" aria-label="Final podium">
      <div className="podium-places">
        <PodiumPlace place={2} player={second} />
        <PodiumPlace place={1} player={first} featured />
        <PodiumPlace place={3} player={third} />
      </div>
      {rest.length > 0 ? (
        <ol className="podium-rest" aria-label="Remaining standings">
          {rest.map((player) => (
            <li key={player.id}>
              <span>{player.rank}. {player.displayName}</span>
              <span>{player.score}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

function PodiumPlace({ place, player, featured = false }: { place: number; player?: Standing; featured?: boolean }) {
  return (
    <div className={`podium-place place-${place} ${featured ? "is-first" : ""}`}>
      <p className="podium-medal">{place === 1 ? "1st" : place === 2 ? "2nd" : "3rd"}</p>
      <p className="podium-name">{player?.displayName ?? "—"}</p>
      <p className="podium-score">{player?.score ?? 0}</p>
    </div>
  );
}
