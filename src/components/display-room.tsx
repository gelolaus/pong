import { useRoom } from "../lib/use-room";
import { Leaderboard } from "./leaderboard";
import { Podium } from "./podium";

export function DisplayRoom({ roomCode }: { roomCode: string }) {
  const room = useRoom(roomCode, { role: "display" });
  const snapshot = room.snapshot;

  if (!snapshot) {
    return (
      <main className="court-shell">
        <section className="page-card"><h1>Display Court</h1><p>Waiting for the host.</p></section>
      </main>
    );
  }

  const answered = snapshot.state === "question_open" || snapshot.state === "question_closed"
    ? snapshot.players.filter((player) => player.connected).length
    : snapshot.players.length;

  return (
    <main className="court-shell display-shell">
      <section className="display-card">
        <p className="eyebrow">Pong</p>
        <h1>{snapshot.quizTitle}</h1>
        <p className="room-code">{snapshot.roomCode}</p>
        {snapshot.state === "lobby" ? <p role="status">{snapshot.players.length} players in the lobby</p> : null}
        {snapshot.currentQuestion && snapshot.state !== "leaderboard" && snapshot.state !== "finished" ? (
          <div>
            <p className="question-prompt">{snapshot.currentQuestion.prompt}</p>
            {snapshot.currentQuestion.imageUrl ? <img src={snapshot.currentQuestion.imageUrl} alt="" className="question-image" /> : null}
            <p role="status">Answers in: {answered}</p>
          </div>
        ) : null}
        {snapshot.state === "round_reveal" ? <p role="status">Answers revealed</p> : null}
        {snapshot.state === "leaderboard" ? <Leaderboard standings={snapshot.players} variant="display" /> : null}
        {snapshot.state === "finished" ? <Podium standings={snapshot.players} /> : null}
      </section>
    </main>
  );
}
