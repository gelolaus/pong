import { useEffect, useState } from "react";

import { createRoom, fetchQuizzes, fetchSession, googleAuthUrl, type QuizSummary } from "../lib/api";

export function HostPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchSession()
      .then((session) => {
        setEmail(session.email);
        return fetchQuizzes();
      })
      .then((result) => setQuizzes(result.quizzes))
      .catch(() => setEmail(null));
  }, []);

  if (!email) {
    return (
      <main className="court-shell">
        <section className="page-card">
          <p className="eyebrow">Host Court</p>
          <h1>Sign in to host</h1>
          <p>Only the event host can open a room.</p>
          <a className="button-link" href={googleAuthUrl()}>Continue with Google</a>
        </section>
      </main>
    );
  }

  return (
    <main className="court-shell">
      <section className="page-card host-card">
        <p className="eyebrow">Host Court</p>
        <h1>Pick a quiz</h1>
        <p>Signed in as {email}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <ul className="quiz-list">
          {quizzes.map((quiz) => (
            <li key={quiz.id}>
              <div>
                <strong>{quiz.title}</strong>
                <p>{quiz.questionCount} questions</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const created = await createRoom(quiz.id);
                    sessionStorage.setItem(`pong:host-ticket:${created.roomCode}`, created.hostTicket);
                    window.location.assign(`/host/${created.roomCode}`);
                  } catch {
                    setError("Could not start that game.");
                  }
                }}
              >
                Start game
              </button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
