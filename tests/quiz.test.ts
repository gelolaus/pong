import { describe, expect, it } from "vitest";

import { eventQuiz, quizSchema } from "../src/domain/quiz";

describe("eventQuiz", () => {
  it("is a valid 20-question Programming Language or Pokemon quiz", () => {
    const quiz = quizSchema.parse(eventQuiz);

    expect(quiz.questions).toHaveLength(20);
    expect(quiz.questions.every((question) => question.timerSeconds === 20)).toBe(true);
    expect(
      quiz.questions.every(
        (question) => question.correctIndex >= 0 && question.correctIndex < question.answers.length,
      ),
    ).toBe(true);
  });

  it.each([4, 121])("rejects a question timer outside the 5–120 second range: %i", (timerSeconds) => {
    const candidate = structuredClone(eventQuiz);
    candidate.questions[0].timerSeconds = timerSeconds;

    expect(() => quizSchema.parse(candidate)).toThrow();
  });

  it("rejects a question whose correct index does not identify an answer", () => {
    const candidate = structuredClone(eventQuiz);
    candidate.questions[0].correctIndex = candidate.questions[0].answers.length;

    expect(() => quizSchema.parse(candidate)).toThrow();
  });
});
