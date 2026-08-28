#!/usr/bin/env node

const args = parseArgs(process.argv.slice(2));
const baseUrl = args["base-url"] ?? "http://localhost:8787";
const players = Number(args.players ?? 200);
const batchSize = 20;

if (!Number.isFinite(players) || players < 1) {
  console.error("players must be a positive number");
  process.exit(1);
}

const started = Date.now();
const created = await postJson("/api/test/rooms");
const roomCode = created.roomCode;
const hostTicket = created.hostTicket;
if (!roomCode || !hostTicket) {
  console.error("Could not create a disposable load-test room. Enable PONG_TEST_MODE=1.");
  process.exit(1);
}

const host = await openSocket(roomCode, { role: "host", ticket: hostTicket });
const clients = [];
for (let index = 0; index < players; index += batchSize) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(batchSize, players - index) }, (_, offset) =>
      joinPlayer(roomCode, `Load ${index + offset + 1}`),
    ),
  );
  clients.push(...batch);
}

await waitFor(() => clients.every((client) => client.revision >= 0), 10_000, "join snapshots");
host.socket.send(command("host.open_question", { hostTicket, idempotencyKey: "load-open", questionIndex: 0 }));
await waitFor(() => clients.every((client) => client.phase === "question_open"), 10_000, "question open");

const latencies = [];
for (const client of clients) {
  const before = Date.now();
  client.socket.send(JSON.stringify({
    version: 1,
    roomRevision: client.revision,
    type: "player.answer",
    payload: { questionId: client.questionId, answerIndex: 0, idempotencyKey: `ans-${client.name}` },
  }));
  client.answerSentAt = before;
}

host.socket.send(command("host.close_question", { hostTicket, idempotencyKey: "load-close" }));

const closed = await waitFor(() => {
  const revisions = new Set(clients.map((client) => client.closedRevision).filter((value) => value !== null));
  return clients.every((client) => client.closedRevision !== null) && revisions.size === 1;
}, 10_000, "closed round").catch((error) => error);

for (const client of clients) {
  if (client.receiptAt && client.answerSentAt) latencies.push(client.receiptAt - client.answerSentAt);
}
latencies.sort((left, right) => left - right);

const closedRevisions = new Set(clients.map((client) => client.closedRevision).filter((value) => value !== null));
const accepted = clients.filter((client) => client.receiptAt).length;
const failures = clients.filter((client) => client.closedRevision === null || client.error).length;
const report = {
  connected: clients.length,
  accepted,
  p50: percentile(latencies, 0.5),
  p95: percentile(latencies, 0.95),
  divergentRevisions: Math.max(0, closedRevisions.size - 1),
  failures,
  elapsedMs: Date.now() - started,
};

console.log(JSON.stringify(report, null, 2));
host.socket.close();
for (const client of clients) client.socket.close();

if (closed instanceof Error || report.divergentRevisions !== 0 || report.failures !== 0 || report.accepted !== players) {
  process.exit(1);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true";
    result[key] = value;
  }
  return result;
}

async function postJson(path) {
  const response = await fetch(new URL(path, baseUrl), { method: "POST" });
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json();
}

function socketUrl(roomCode, params = {}) {
  const url = new URL(`/api/rooms/${roomCode}/socket`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}

async function openSocket(roomCode, params = {}) {
  const socket = new WebSocket(socketUrl(roomCode, params));
  const client = { socket, revision: -1, phase: "", questionId: "", closedRevision: null, receiptAt: 0, answerSentAt: 0, error: "", name: params.name ?? "host" };
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (typeof message.roomRevision === "number") client.revision = Math.max(client.revision, message.roomRevision);
    if (message.type === "question.opened") {
      client.phase = "question_open";
      client.questionId = message.payload.question.id;
    }
    if (message.type === "question.closed") {
      client.phase = "question_closed";
      client.closedRevision = message.roomRevision;
    }
    if (message.payload?.snapshot?.state) client.phase = message.payload.snapshot.state;
    if (message.payload?.snapshot?.currentQuestion?.id) client.questionId = message.payload.snapshot.currentQuestion.id;
    if (message.type === "answer.received") client.receiptAt = Date.now();
    if (message.type === "error") client.error = message.payload.message;
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("socket failed")));
  });
  return client;
}

async function joinPlayer(roomCode, name) {
  const client = await openSocket(roomCode);
  client.name = name;
  client.socket.send(JSON.stringify({
    version: 1,
    roomRevision: 0,
    type: "player.join",
    payload: { displayName: name.slice(0, 24) },
  }));
  return client;
}

function command(type, payload) {
  return JSON.stringify({ version: 1, roomRevision: 0, type, payload });
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.floor(values.length * fraction));
  return values[index];
}
