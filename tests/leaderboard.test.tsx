import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Leaderboard } from "../src/components/leaderboard";

const standings = [
  { id: "a", displayName: "Alex", score: 2000, streak: 2, rank: 1, rankMovement: 1 },
  { id: "b", displayName: "Bea", score: 1000, streak: 0, rank: 2, rankMovement: -1 },
  ...Array.from({ length: 10 }, (_, index) => ({
    id: `p${index}`,
    displayName: `Player ${index}`,
    score: 10 - index,
    streak: 0,
    rank: index + 3,
    rankMovement: 0,
  })),
];

describe("Leaderboard", () => {
  it("shows rank movement and limits the display list to the top ten", () => {
    render(<Leaderboard standings={standings} variant="display" currentPlayerId="a" />);
    expect(screen.getByLabelText(/up 1 place/i)).toBeVisible();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByText(/alex \(you\)/i)).toBeVisible();
  });

  it("shows full standings for the host", () => {
    render(<Leaderboard standings={standings} variant="host" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(12);
  });
});
