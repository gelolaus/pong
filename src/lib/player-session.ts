const PREFIX = "pong:player:";

export type PlayerSession = {
  roomCode: string;
  playerId: string;
  reconnectToken: string;
  displayName: string;
};

function storage(): Storage | null {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function savePlayerSession(session: PlayerSession): void {
  storage()?.setItem(`${PREFIX}${session.roomCode}`, JSON.stringify(session));
}

export function readPlayerSession(roomCode: string): PlayerSession | null {
  const raw = storage()?.getItem(`${PREFIX}${roomCode}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PlayerSession;
    if (!parsed.playerId || !parsed.reconnectToken || parsed.roomCode !== roomCode) {
      clearPlayerSession(roomCode);
      return null;
    }
    return parsed;
  } catch {
    clearPlayerSession(roomCode);
    return null;
  }
}

export function clearPlayerSession(roomCode: string): void {
  storage()?.removeItem(`${PREFIX}${roomCode}`);
}
