import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { JoinPage } from "../src/components/join-page";

describe("JoinPage", () => {
  it("requires a six-digit code and a 2-24 character name", async () => {
    const user = userEvent.setup();
    render(<JoinPage onJoin={() => undefined} />);
    await user.type(screen.getByLabelText(/game code/i), "12");
    await user.type(screen.getByLabelText(/display name/i), "A");
    await user.click(screen.getByRole("button", { name: /join the game/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/six-digit game code/i);
  });
});
