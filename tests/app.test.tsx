import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/app";

describe("App routes", () => {
  afterEach(() => window.history.replaceState({}, "", "/"));

  it("shows the join form at the root route", () => {
    window.history.replaceState({}, "", "/");
    render(<App />);

    expect(screen.getByRole("heading", { name: /join pong/i })).toBeVisible();
    expect(screen.getByLabelText(/game code/i)).toHaveAttribute("inputmode", "numeric");
  });
});
