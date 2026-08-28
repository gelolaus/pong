import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { useRoom } from "../lib/use-room";
import { AnswerBoard } from "./answer-board";
import { Leaderboard } from "./leaderboard";
import { Podium } from "./podium";

export function DisplayRoom({ roomCode }: { roomCode: string }) {
  const room = useRoom(roomCode, { role: "display" });
  const snapshot = room.snapshot;
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/`, { margin: 1, width: 360 }).then(setQrDataUrl).catch(() => undefined);
  }, []);

  if (!snapshot) {
    return (
      <main className="court-shell">
        <section className="page-card"><h1>Display Court</h1><p>Waiting for the host.</p></section>
      </main>
    );
  }

  return (
    <main className="court-shell display-shell">
      <section className="display-card">
        <p className="eyebrow">Pong</p>
        <p className="room-code">{snapshot.roomCode}</p>
        {snapshot.state === "lobby" ? (
          <div>
            <h1>Join with this code</h1>
            {qrDataUrl ? <img src={qrDataUrl} alt={`QR code to join Pong at ${window.location.origin}`} width={280} height={280} /> : null}
            <p role="status">{snapshot.players.length} players in the lobby</p>
          </div>
        ) : (
          <h1>{snapshot.quizTitle}</h1>
        )}
        {snapshot.currentQuestion && (snapshot.state === "question_open" || snapshot.state === "question_closed" || snapshot.state === "round_reveal") ? (
          <div>
            <AnswerBoard
              question={snapshot.currentQuestion}
              locked={snapshot.state !== "question_open"}
              correctIndex={snapshot.state === "round_reveal" ? room.reveal?.correctIndex ?? null : null}
            />
            {snapshot.state === "question_closed" ? <p role="status">Answers are in. Waiting for the host.</p> : null}
            {snapshot.state === "round_reveal" && room.reveal ? <p className="reveal-card" role="status">{room.reveal.explanation}</p> : null}
          </div>
        ) : null}
        {snapshot.state === "leaderboard" ? <Leaderboard standings={snapshot.players} variant="display" /> : null}
        {snapshot.state === "finished" ? <Podium standings={snapshot.players} /> : null}
      </section>
    </main>
  );
}
