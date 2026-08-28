import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HostRoom } from "../src/components/host-room";
import type { RoomSnapshot } from "../src/domain/protocol";

function snapshot(state: RoomSnapshot["state"], extra: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    roomCode: "123456",
    revision: 3,
    state,
    quizTitle: "Programming Language or Pokemon",
    joinLocked: false,
    currentQuestionIndex: state === "lobby" ? null : 0,
    currentQuestion: state === "lobby" || state === "finished" ? null : {
      id: "clojure",
      prompt: "Clojure",
      answers: ["Programming language", "Pokemon"],
      timerSeconds: 20,
    },
    openedAt: 1,
    baseDeadline: 2,
    answerDeadline: 2,
    players: [{ id: "p1", displayName: "Alex", score: 1000, streak: 1, connected: true, rank: 1, rankMovement: 0 }],
    ...extra,
  };
}

describe("HostRoom", () => {
  it("shows lobby code, counts, lock, and removal", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<HostRoom roomCode="123456" snapshot={snapshot("lobby")} qrDataUrl="data:image/png;base64,abc" onCommand={onCommand} />);
    expect(screen.getByRole("heading", { name: "123456" })).toBeVisible();
    expect(screen.getByRole("img", { name: /qr code/i })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(/1 connected, 0 away/i);
    await user.click(screen.getByRole("button", { name: /lock joins/i }));
    expect(onCommand).toHaveBeenCalledWith("host.lock_joining", { locked: true });
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(onCommand).toHaveBeenCalledWith("host.remove_player", { playerId: "p1" });
  });

  it("exposes only legal actions and sends +15 seconds once", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const { rerender } = render(<HostRoom roomCode="123456" snapshot={snapshot("question_open")} onCommand={onCommand} />);
    expect(screen.getByRole("button", { name: /\+15 seconds/i })).toBeVisible();
    expect(screen.getByRole("button", { name: /close answers/i })).toBeVisible();
    expect(screen.queryByRole("button", { name: /reveal/i })).toBeNull();
    await user.click(screen.getByRole("button", { name: /\+15 seconds/i }));
    expect(onCommand).toHaveBeenCalledWith("host.extend_time", { additionalSeconds: 15 });
    rerender(<HostRoom roomCode="123456" snapshot={snapshot("question_closed")} onCommand={onCommand} warning="Scores are live, but saving this round failed. Retrying." />);
    expect(screen.getByText(/saving this round failed/i)).toBeVisible();
    expect(screen.getByRole("button", { name: /reveal/i })).toBeVisible();
  });
});
