export type QuizSummary = { id: string; title: string; questionCount: number };
export type RoomCreateResult = { roomCode: string; hostTicket: string };
export type HostSession = { email: string; sub: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function googleAuthUrl() {
  return "/api/auth/google";
}

export function fetchSession() {
  return request<HostSession>("/api/auth/session");
}

export function fetchQuizzes() {
  return request<{ quizzes: QuizSummary[] }>("/api/quizzes");
}

export function createRoom(quizId: string) {
  return request<RoomCreateResult>("/api/rooms", { method: "POST", body: JSON.stringify({ quizId }) });
}

export function fetchHostTicket(roomCode: string) {
  return request<{ hostTicket: string; roomCode: string }>(`/api/rooms/${roomCode}/ticket`);
}

export function logout() {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function testHostSession() {
  return request<{ email: string }>("/api/test/host-session", { method: "POST" });
}
