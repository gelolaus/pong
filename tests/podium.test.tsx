import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Podium } from "../src/components/podium";

const standings = [
  { id: "a", displayName: "Alex", score: 3000, rank: 1 },
  { id: "b", displayName: "Bea", score: 2000, rank: 2 },
  { id: "c", displayName: "Cam", score: 1000, rank: 3 },
  { id: "d", displayName: "Dee", score: 10, rank: 4 },
];

describe("Podium", () => {
  it("renders second, first, then third visually", () => {
    render(<Podium standings={standings} />);
    const places = document.querySelectorAll(".podium-place .podium-name");
    expect([...places].map((node) => node.textContent)).toEqual(["Bea", "Alex", "Cam"]);
    expect(screen.getByText(/dee/i)).toBeVisible();
  });

  it("skips entrance animation when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener() {},
      removeEventListener() {},
    }));
    render(<Podium standings={standings} />);
    expect(screen.getByTestId("podium")).not.toHaveClass("podium-animated");
    vi.unstubAllGlobals();
  });
});
