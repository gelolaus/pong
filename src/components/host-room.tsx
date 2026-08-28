import { useEffect, useState } from "react";
import QRCode from "qrcode";

import type { RoomSnapshot } from "../domain/protocol";
import { fetchHostTicket } from "../lib/api";
import { useRoom } from "../lib/use-room";
import { Leaderboard } from "./leaderboard";
import { Podium } from "./podium";

type HostRoomProps = {
  roomCode: string;
  snapshot?: RoomSnapshot;
  warning?: string | null;
  qrDataUrl?: string;
  onCommand?: (type: string, extra?: Record<string, unknown>) => void;
};

export function HostRoom(props: HostRoomProps) {
  if (props.snapshot) {
    return (
      <HostRoomView
        snapshot={props.snapshot}
        warning={props.warning ?? null}
        qrDataUrl={props.qrDataUrl ?? ""}
        onCommand={props.onCommand ?? (() => undefined)}
      />
    );
  }
  return <HostRoomConnected roomCode={props.roomCode} />;
}

function HostRoomConnected({ roomCode }: { roomCode: string }) {
  const [ticket, setTicket] = useState(sessionStorage.getItem(`pong:host-ticket:${roomCode}`) ?? "");
  const room = useRoom(roomCode, { role: "host", ticket });
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    QRCode.toDataURL(`${window.location.origin}/play/${roomCode}`, { margin: 1, width: 240 }).then(setQrDataUrl).catch(() => undefined);
  }, [roomCode]);

  useEffect(() => {
    const refresh = async () => {
      try {
        const result = await fetchHostTicket(roomCode);
        sessionStorage.setItem(`pong:host-ticket:${roomCode}`, result.hostTicket);
        setTicket(result.hostTicket);
      } catch {
        // Keep the previous ticket until it expires.
      }
    };
    const timer = window.setInterval(refresh, 30_000);
    refresh();
    return () => window.clearInterval(timer);
  }, [roomCode]);

  const sendCommand = (type: string, extra: Record<string, unknown> = {}) => {
    room.send({
      type: type as never,
      payload: { hostTicket: ticket, idempotencyKey: crypto.randomUUID(), ...extra },
    });
  };

  if (!room.snapshot) {
    return (
      <main className="court-shell">
        <section className="page-card"><h1>Opening host room</h1></section>
      </main>
    );
  }

  return (
    <HostRoomView
      snapshot={room.snapshot}
      warning={room.warning}
      qrDataUrl={qrDataUrl}
      onCommand={sendCommand}
    />
  );
}

export function HostRoomView({
  snapshot,
  warning,
  qrDataUrl,
  onCommand,
}: {
  snapshot: RoomSnapshot;
  warning: string | null;
  qrDataUrl: string;
  onCommand: (type: string, extra?: Record<string, unknown>) => void;
}) {
  const [nextIndex, setNextIndex] = useState(0);
  useEffect(() => {
    if (snapshot.currentQuestionIndex !== null) setNextIndex(snapshot.currentQuestionIndex + 1);
  }, [snapshot.currentQuestionIndex]);
  const connected = snapshot.players.filter((player) => player.connected).length;
  const away = snapshot.players.length - connected;
  const actions = legalActions(snapshot.state);

  return (
    <main className="court-shell host-shell">
      <section className="host-layout">
        <div className="host-sidebar page-card">
          <p className="eyebrow">Room code</p>
          <h1 className="room-code">{snapshot.roomCode}</h1>
          {qrDataUrl ? <img src={qrDataUrl} alt={`QR code to join room ${snapshot.roomCode}`} width={180} height={180} /> : null}
          <a className="button-link" href={`/display/${snapshot.roomCode}`} target="_blank" rel="noreferrer">Open projector</a>
          <p role="status">{connected} connected, {away} away</p>
          {snapshot.state === "lobby" ? (
            <button type="button" aria-pressed={snapshot.joinLocked} onClick={() => onCommand("host.lock_joining", { locked: !snapshot.joinLocked })}>
              {snapshot.joinLocked ? "Unlock joins" : "Lock joins"}
            </button>
          ) : null}
        </div>
        <div className="host-main page-card">
          {warning ? <p className="status-banner" role="status">{warning}</p> : null}
          <p className="eyebrow">Host controls</p>
          <h2>{snapshot.quizTitle}</h2>
          <p>Phase: {snapshot.state.replaceAll("_", " ")}</p>
          {snapshot.currentQuestion ? <p>Now showing: {snapshot.currentQuestion.prompt}</p> : null}
          <div className="host-actions">
            {actions.includes("open") ? (
              <button type="button" onClick={() => onCommand("host.open_question", { questionIndex: nextIndex })}>Start question</button>
            ) : null}
            {actions.includes("extend") ? (
              <button type="button" onClick={() => onCommand("host.extend_time", { additionalSeconds: 15 })}>+15 seconds</button>
            ) : null}
            {actions.includes("close") ? <button type="button" onClick={() => onCommand("host.close_question")}>Close answers</button> : null}
            {actions.includes("reveal") ? <button type="button" onClick={() => onCommand("host.reveal_round")}>Reveal</button> : null}
            {actions.includes("leaderboard") ? <button type="button" onClick={() => onCommand("host.show_leaderboard")}>Leaderboard</button> : null}
            {actions.includes("next") ? <button type="button" onClick={() => onCommand("host.open_question", { questionIndex: nextIndex })}>Next question</button> : null}
            {actions.includes("end") ? (
              <button
                type="button"
                onClick={() => {
                  if (snapshot.state === "finished" || window.confirm("End the game now?")) onCommand("host.end_game");
                }}
              >
                End game
              </button>
            ) : null}
          </div>
          {snapshot.state === "lobby" ? (
            <ul className="player-moderation">
              {snapshot.players.map((player) => (
                <li key={player.id}>
                  <span>{player.displayName}</span>
                  <button type="button" onClick={() => onCommand("host.remove_player", { playerId: player.id })}>Remove</button>
                </li>
              ))}
            </ul>
          ) : null}
          {snapshot.state === "leaderboard" || snapshot.state === "round_reveal" ? <Leaderboard standings={snapshot.players} variant="host" /> : null}
          {snapshot.state === "finished" ? <Podium standings={snapshot.players} /> : null}
        </div>
      </section>
    </main>
  );
}

function legalActions(state: RoomSnapshot["state"]) {
  switch (state) {
    case "lobby":
      return ["open", "end"];
    case "question_open":
      return ["extend", "close"];
    case "question_closed":
      return ["reveal"];
    case "round_reveal":
      return ["leaderboard"];
    case "leaderboard":
      return ["next", "end"];
    default:
      return [];
  }
}
