import { describe, expect, it } from "vitest";

import { scoreAnswer } from "../src/domain/scoring";

describe("scoreAnswer", () => {
  it.each([
    {
      name: "awards the full speed bonus for an immediate correct answer",
      input: { correct: true, responseMs: 0, baseDurationMs: 20_000 },
      expected: 1250,
    },
    {
      name: "rounds the speed bonus halfway through the base duration",
      input: { correct: true, responseMs: 10_000, baseDurationMs: 20_000 },
      expected: 1125,
    },
    {
      name: "awards base points once the base duration has elapsed",
      input: { correct: true, responseMs: 20_001, baseDurationMs: 20_000 },
      expected: 1000,
    },
    {
      name: "awards no points for a wrong answer",
      input: { correct: false, responseMs: 0, baseDurationMs: 20_000 },
      expected: 0,
    },
  ])("$name", ({ input, expected }) => {
    expect(scoreAnswer(input)).toBe(expected);
  });
});
