import { useEffect, useMemo, useState } from "react";

import type { RoomSnapshot } from "../domain/protocol";
import { readPlayerSession } from "../lib/player-session";
import { useRoom } from "../lib/use-room";
import { AnswerBoard } from "./answer-board";
import { Leaderboard } from "./leaderboard";
import { Podium } from "./podium";
import { PongAvatar } from "./pong-avatar";

type PlayerRoomProps = {
  roomCode: string;
};

export function PlayerRoom({ roomCode }: PlayerRoomProps) {
  const joinName = useMemo(() => {
    try {
      const pending = JSON.parse(sessionStorage.getItem("pong:pending-join") ?? "null") as { roomCode?: string; displayName?: string } | null;
      if (pending?.roomCode === roomCode) return pending.displayName;
    } catch {
      return undefined;
    }
    return undefined;
  }, [roomCode]);
  const room = useRoom(roomCode, { role: "player", joinName });
  const session = readPlayerSession(roomCode);
  const me = room.snapshot?.players.find((player) => player.id === session?.playerId);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  if (room.removed) {
    return (
      <main className="court-shell">
        <section className="page-card" role="alert">
          <h1>You were removed</h1>
          <p>The host took you off the court. You can join again with a new name if joins are open.</p>
        </section>
      </main>
    );
  }

  if (!room.snapshot) {
    return (
      <main className="court-shell">
        <section className="page-card" aria-live="polite">
          <h1>Connecting</h1>
          <p>Finding your paddle…</p>
        </section>
      </main>
    );
  }

  return (
    <main className="court-shell player-shell">
      <section className="game-card">
        <header className="player-header">
          <PongAvatar seed={me?.id ?? roomCode} name={me?.displayName ?? "Player"} />
          <div>
            <p className="eyebrow">Player Court</p>
            <h1>{me?.displayName ?? "Pong"}</h1>
          </div>
        </header>
        {room.paused ? <p className="status-banner" role="status">{room.paused}</p> : null}
        {room.error ? <p className="form-error" role="alert">{room.error}</p> : null}
        <PlayerStage
          snapshot={room.snapshot}
          now={now}
          receipt={room.receipt}
          reveal={room.reveal}
          meId={me?.id}
          onAnswer={(index) => {
            if (!room.snapshot?.currentQuestion) return;
            room.send({
              type: "player.answer",
              payload: {
                questionId: room.snapshot.currentQuestion.id,
                answerIndex: index,
                idempotencyKey: crypto.randomUUID(),
              },
            });
          }}
        />
      </section>
    </main>
  );
}

function PlayerStage({
  snapshot,
  now,
  receipt,
  reveal,
  meId,
  onAnswer,
}: {
  snapshot: RoomSnapshot;
  now: number;
  receipt: { questionId: string; answerIndex: number } | null;
  reveal: { questionId: string; correctIndex: number; explanation: string } | null;
  meId?: string;
  onAnswer: (index: number) => void;
}) {
  const remaining = remainingSeconds(snapshot, now);
  const announcement = timerAnnouncement(remaining);

  if (snapshot.state === "finished") {
    return <Podium standings={snapshot.players} />;
  }
  if (snapshot.state === "leaderboard") {
    return <Leaderboard standings={snapshot.players} currentPlayerId={meId} />;
  }
  if (snapshot.state === "lobby") {
    return (
      <div>
        <p role="status">You’re in the lobby. Get ready to smash.</p>
        <p>{snapshot.players.length} player{snapshot.players.length === 1 ? "" : "s"} on court.</p>
      </div>
    );
  }
  if (snapshot.currentQuestion && (snapshot.state === "question_open" || snapshot.state === "question_closed" || snapshot.state === "round_reveal")) {
    const selected = receipt?.questionId === snapshot.currentQuestion.id ? receipt.answerIndex : null;
    return (
      <div>
        <Timer remaining={remaining} announcement={announcement} total={snapshot.currentQuestion.timerSeconds} />
        <AnswerBoard
          question={snapshot.currentQuestion}
          selectedIndex={selected}
          locked={snapshot.state !== "question_open" || selected !== null}
          correctIndex={snapshot.state === "round_reveal" ? reveal?.correctIndex ?? null : null}
          onAnswer={onAnswer}
        />
        {snapshot.state === "question_closed" ? <p role="status">Answers are in. Waiting for the host.</p> : null}
        {snapshot.state === "round_reveal" && reveal ? (
          <div className="reveal-card" role="status">
            <p>{reveal.explanation}</p>
            <p>{selected === reveal.correctIndex ? "Correct!" : "Not this time."}</p>
          </div>
        ) : null}
      </div>
    );
  }
  return <p role="status">Waiting for the next rally.</p>;
}

function remainingSeconds(snapshot: RoomSnapshot, now: number) {
  if (!snapshot.answerDeadline) return 0;
  return Math.max(0, Math.ceil((snapshot.answerDeadline - now) / 1000));
}

function timerAnnouncement(remaining: number) {
  return remaining === 10 || remaining === 5 || (remaining <= 4 && remaining >= 1) ? `${remaining} seconds remaining` : "";
}

function Timer({ remaining, announcement, total }: { remaining: number; announcement: string; total: number }) {
  return (
    <div className="timer">
      <progress max={total} value={Math.min(total, remaining)} aria-label="Time remaining" />
      <p aria-hidden="true">{remaining}s</p>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </div>
  );
}
