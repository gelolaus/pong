import { JoinPage } from "./components/join-page";
import { PlayerRoom } from "./components/player-room";
import { HostPage } from "./components/host-page";
import { HostRoom } from "./components/host-room";
import { DisplayRoom } from "./components/display-room";

function NotFound() {
  return (
    <main className="court-shell">
      <section className="page-card" aria-labelledby="page-title">
        <p className="eyebrow">Pong</p>
        <h1 id="page-title">Court not found</h1>
        <p>This game room does not exist.</p>
      </section>
    </main>
  );
}

export function App() {
  const path = window.location.pathname;
  const play = path.match(/^\/play\/(\d{6})$/);
  const hostRoom = path.match(/^\/host\/(\d{6})$/);
  const display = path.match(/^\/display\/(\d{6})$/);

  if (path === "/") return <JoinPage />;
  if (play) return <PlayerRoom roomCode={play[1]} />;
  if (path === "/host") return <HostPage />;
  if (hostRoom) return <HostRoom roomCode={hostRoom[1]} />;
  if (display) return <DisplayRoom roomCode={display[1]} />;
  return <NotFound />;
}
