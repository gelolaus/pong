import { FormEvent } from "react";

type ShellProps = {
  eyebrow: string;
  title: string;
  detail: string;
};

function PageShell({ eyebrow, title, detail }: ShellProps) {
  return (
    <main className="court-shell">
      <section className="page-card" aria-labelledby="page-title">
        <p className="eyebrow">{eyebrow}</p>
        <h1 id="page-title">{title}</h1>
        <p>{detail}</p>
      </section>
    </main>
  );
}

function JoinCourt() {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("code")?.toString().trim();

    if (code) window.location.assign(`/play/${encodeURIComponent(code)}`);
  };

  return (
    <main className="court-shell">
      <section className="join-card" aria-labelledby="join-title">
        <p className="eyebrow">Center Court</p>
        <h1 id="join-title">Join Pong</h1>
        <p className="join-copy">Enter the game code on the big screen to join the rally.</p>
        <form className="join-form" onSubmit={handleSubmit}>
          <label htmlFor="game-code">Game code</label>
          <div className="answer-depth">
            <input
              id="game-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              placeholder="123456"
              required
            />
          </div>
          <button type="submit">Join the game</button>
        </form>
      </section>
    </main>
  );
}

export function App() {
  const path = window.location.pathname;

  if (path === "/") return <JoinCourt />;
  if (/^\/play\/[^/]+$/.test(path)) {
    return <PageShell eyebrow="Player" title="Player Court" detail="Your paddle is warming up." />;
  }
  if (path === "/host") {
    return <PageShell eyebrow="Host" title="Host Court" detail="Create a room and bring the match to life." />;
  }
  if (/^\/host\/[^/]+$/.test(path)) {
    return <PageShell eyebrow="Host" title="Host Room" detail="Room controls will appear here." />;
  }
  if (/^\/display\/[^/]+$/.test(path)) {
    return <PageShell eyebrow="Display" title="Display Court" detail="The scoreboard will take this court." />;
  }

  return <PageShell eyebrow="Pong" title="Court not found" detail="This game room does not exist." />;
}
