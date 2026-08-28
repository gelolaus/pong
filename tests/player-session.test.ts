import { describe, expect, it, beforeEach } from "vitest";

import { clearPlayerSession, readPlayerSession, savePlayerSession } from "../src/lib/player-session";

describe("player session storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores a session by room code and can clear it", () => {
    savePlayerSession({ roomCode: "123456", playerId: "p1", reconnectToken: "secret", displayName: "Alex" });
    expect(readPlayerSession("123456")).toEqual({
      roomCode: "123456",
      playerId: "p1",
      reconnectToken: "secret",
      displayName: "Alex",
    });
    expect(readPlayerSession("999999")).toBeNull();
    clearPlayerSession("123456");
    expect(readPlayerSession("123456")).toBeNull();
  });

  it("removes malformed storage instead of returning it", () => {
    localStorage.setItem("pong:player:123456", "{not-json");
    expect(readPlayerSession("123456")).toBeNull();
    expect(localStorage.getItem("pong:player:123456")).toBeNull();
  });
});
