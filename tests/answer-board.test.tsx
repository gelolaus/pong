import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AnswerBoard } from "../src/components/answer-board";

const question = {
  id: "q1",
  prompt: "Clojure",
  answers: ["Programming language", "Pokemon", "Both", "Neither"],
  timerSeconds: 20,
};

describe("AnswerBoard", () => {
  it("locks after a number-key answer and keeps the selected label", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    const { rerender } = render(<AnswerBoard question={question} onAnswer={onAnswer} />);

    await user.keyboard("2");
    expect(onAnswer).toHaveBeenCalledOnce();
    expect(onAnswer).toHaveBeenCalledWith(1);

    rerender(<AnswerBoard question={question} selectedIndex={1} locked onAnswer={onAnswer} />);
    expect(screen.getByRole("status")).toHaveTextContent(/answer locked/i);
    expect(screen.getByRole("button", { name: /answer 2: pokemon, selected/i })).toBeDisabled();
  });

  it("ignores number keys while an input has focus", async () => {
    const user = userEvent.setup();
    const onAnswer = vi.fn();
    render(
      <div>
        <input aria-label="Notes" />
        <AnswerBoard question={question} onAnswer={onAnswer} />
      </div>,
    );
    await user.click(screen.getByLabelText("Notes"));
    await user.keyboard("2");
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("hides a broken image without hiding the prompt", () => {
    render(<AnswerBoard question={{ ...question, imageUrl: "https://example.com/missing.png" }} />);
    const image = screen.getByAltText("");
    fireEvent.error(image);
    expect(screen.getByText("Clojure")).toBeVisible();
    expect(screen.queryByAltText("")).toBeNull();
  });
});
