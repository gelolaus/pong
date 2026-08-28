import { useEffect, useMemo, useRef, useState } from "react";

import type { ClientMessage, RoomSnapshot, ServerMessage } from "../domain/protocol";
import { readPlayerSession, savePlayerSession } from "./player-session";
import { RoomSocket, roomSocketUrl } from "./room-socket";

export type RoomRole = "player" | "host" | "display";

export type RoomViewState = {
  snapshot: RoomSnapshot | null;
  connecting: boolean;
  paused: string | null;
  warning: string | null;
  error: string | null;
  removed: boolean;
  receipt: { questionId: string; answerIndex: number } | null;
  reveal: { questionId: string; correctIndex: number; explanation: string } | null;
  welcomeName: string | null;
};

const empty: RoomViewState = {
  snapshot: null,
  connecting: true,
  paused: null,
  warning: null,
  error: null,
  removed: false,
  receipt: null,
  reveal: null,
  welcomeName: null,
};

export function useRoom(roomCode: string, options: {
  role: RoomRole;
  ticket?: string;
  joinName?: string;
}) {
  const [state, setState] = useState<RoomViewState>(empty);
  const socketRef = useRef<RoomSocket | null>(null);

  const url = useMemo(() => {
    const params: Record<string, string> = {};
    if (options.role !== "player") params.role = options.role;
    if (options.ticket) params.ticket = options.ticket;
    return roomSocketUrl(roomCode, params);
  }, [roomCode, options.role, options.ticket]);

  useEffect(() => {
    const session = options.role === "player" ? readPlayerSession(roomCode) : null;
    const socket = new RoomSocket({
      url,
      resume: session ? { playerId: session.playerId, reconnectToken: session.reconnectToken } : null,
      join: !session && options.joinName ? { displayName: options.joinName } : null,
    });
    socketRef.current = socket;
    const unsubscribe = socket.subscribe((message) => {
      if (message.type === "player.welcome") {
        socket.setIdentity({ playerId: message.payload.playerId, reconnectToken: message.payload.reconnectToken });
      }
      setState((current) => applyMessage(roomCode, current, message));
    });
    socket.connect();
    setState((current) => ({ ...current, connecting: true }));
    return () => {
      unsubscribe();
      socket.close();
      socketRef.current = null;
    };
  }, [roomCode, url, options.joinName, options.role]);

  return {
    ...state,
    send(message: Omit<ClientMessage, "version" | "roomRevision"> & { version?: 1; roomRevision?: number }) {
      socketRef.current?.send({
        version: 1,
        roomRevision: state.snapshot?.revision ?? 0,
        ...message,
      } as ClientMessage);
    },
  };
}

function applyMessage(roomCode: string, current: RoomViewState, message: ServerMessage): RoomViewState {
  const next = { ...current, connecting: false };
  if (message.type === "player.welcome") {
    savePlayerSession({
      roomCode,
      playerId: message.payload.playerId,
      reconnectToken: message.payload.reconnectToken,
      displayName: message.payload.displayName,
    });
    return { ...next, welcomeName: message.payload.displayName, error: null };
  }
  if (message.type === "answer.received") {
    return { ...next, receipt: message.payload, error: null };
  }
  if (message.type === "round.revealed") {
    return {
      ...next,
      reveal: message.payload,
      snapshot: current.snapshot
        ? { ...current.snapshot, revision: message.roomRevision, state: "round_reveal", players: message.payload.standings }
        : current.snapshot,
    };
  }
  if (message.type === "room.paused") {
    return { ...next, paused: message.payload.reason };
  }
  if (message.type === "error") {
    if (message.payload.code === "PLAYER_REMOVED") return { ...next, removed: true, error: message.payload.message };
    if (message.payload.code === "PERSISTENCE_WARNING") return { ...next, warning: message.payload.message };
    return { ...next, error: message.payload.message };
  }
  if (message.type === "room.snapshot" || message.type === "lobby.updated") {
    return { ...next, snapshot: message.payload.snapshot, paused: null };
  }
  if (message.type === "question.opened" && current.snapshot) {
    return {
      ...next,
      receipt: null,
      reveal: null,
      snapshot: {
        ...current.snapshot,
        revision: message.roomRevision,
        state: "question_open",
        currentQuestion: message.payload.question,
        openedAt: message.payload.openedAt,
        baseDeadline: message.payload.baseDeadline,
        answerDeadline: message.payload.answerDeadline,
      },
    };
  }
  if (message.type === "question.closed" && current.snapshot) {
    return { ...next, snapshot: { ...current.snapshot, revision: message.roomRevision, state: "question_closed" } };
  }
  if (message.type === "leaderboard.updated" && current.snapshot) {
    return { ...next, snapshot: { ...current.snapshot, revision: message.roomRevision, state: "leaderboard", players: message.payload.standings } };
  }
  if (message.type === "game.finished" && current.snapshot) {
    return { ...next, snapshot: { ...current.snapshot, revision: message.roomRevision, state: "finished", players: message.payload.standings } };
  }
  return next;
}
