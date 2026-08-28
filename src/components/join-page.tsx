import { FormEvent, useState } from "react";

type JoinPageProps = {
  onJoin?: (input: { roomCode: string; displayName: string }) => void;
};

export function JoinPage({ onJoin }: JoinPageProps) {
  const [error, setError] = useState("");

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roomCode = String(form.get("code") ?? "").replace(/\D/g, "").slice(0, 6);
    const displayName = String(form.get("displayName") ?? "").trim();
    if (!/^\d{6}$/.test(roomCode)) {
      setError("Enter the six-digit game code.");
      return;
    }
    if (displayName.length < 2 || displayName.length > 24) {
      setError("Display names must be 2 to 24 characters.");
      return;
    }
    setError("");
    sessionStorage.setItem("pong:pending-join", JSON.stringify({ roomCode, displayName }));
    if (onJoin) onJoin({ roomCode, displayName });
    else window.location.assign(`/play/${roomCode}`);
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
              maxLength={6}
              placeholder="123456"
              required
            />
          </div>
          <label htmlFor="display-name">Display name</label>
          <div className="answer-depth">
            <input id="display-name" name="displayName" maxLength={24} autoComplete="nickname" placeholder="Alex" required />
          </div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button type="submit">Join the game</button>
        </form>
      </section>
    </main>
  );
}
