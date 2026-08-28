import { useEffect, useState } from "react";

type Question = {
  id: string;
  prompt: string;
  imageUrl?: string;
  answers: string[];
  timerSeconds: number;
};

type AnswerBoardProps = {
  question: Question;
  selectedIndex?: number | null;
  locked?: boolean;
  correctIndex?: number | null;
  onAnswer?: (index: number) => void;
};

const COLORS = ["sky", "gold", "leaf", "coral"] as const;

export function AnswerBoard({ question, selectedIndex = null, locked = false, correctIndex = null, onAnswer }: AnswerBoardProps) {
  const [imageFailed, setImageFailed] = useState(false);

  const choose = (index: number) => {
    if (locked || selectedIndex !== null) return;
    onAnswer?.(index);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      const index = Number(event.key) - 1;
      if (index >= 0 && index < question.answers.length) {
        event.preventDefault();
        choose(index);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <div className="answer-board">
      <p className="question-prompt" id="question-prompt">{question.prompt}</p>
      {question.imageUrl && !imageFailed ? (
        <img
          className="question-image"
          src={question.imageUrl}
          alt=""
          onError={() => setImageFailed(true)}
        />
      ) : null}
      <div className="answer-grid" role="group" aria-labelledby="question-prompt">
        {question.answers.map((answer, index) => {
          const selected = selectedIndex === index;
          const revealed = correctIndex !== null;
          const correct = revealed && index === correctIndex;
          const missed = revealed && selected && index !== correctIndex;
          return (
            <button
              key={answer}
              type="button"
              className={`answer-button answer-${COLORS[index]} ${selected ? "is-selected" : ""} ${correct ? "is-correct" : ""} ${missed ? "is-incorrect" : ""}`}
              disabled={locked || selectedIndex !== null}
              aria-pressed={selected}
              aria-label={`Answer ${index + 1}: ${answer}${selected ? ", selected" : ""}${correct ? ", correct" : ""}${missed ? ", incorrect" : ""}`}
              onClick={() => choose(index)}
            >
              <span className="answer-number" aria-hidden="true">{index + 1}</span>
              <span className="answer-text">{answer}</span>
              {selected ? <span className="answer-icon" aria-hidden="true">●</span> : null}
              {correct ? <span className="answer-icon" aria-hidden="true">✓</span> : null}
              {missed ? <span className="answer-icon" aria-hidden="true">✕</span> : null}
            </button>
          );
        })}
      </div>
      {selectedIndex !== null || locked ? <p className="lock-status" role="status">Answer locked</p> : null}
    </div>
  );
}
