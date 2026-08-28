CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS quizzes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  image_url TEXT,
  answers_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation TEXT NOT NULL,
  timer_seconds INTEGER NOT NULL,
  PRIMARY KEY (quiz_id, id),
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id)
);

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  quiz_id TEXT NOT NULL,
  room_code TEXT NOT NULL,
  state TEXT NOT NULL,
  current_question INTEGER,
  host_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER,
  FOREIGN KEY (quiz_id) REFERENCES quizzes(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_active_room_code
  ON game_sessions(room_code)
  WHERE finished_at IS NULL;

CREATE TABLE IF NOT EXISTS session_players (
  session_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_seed TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  streak INTEGER NOT NULL DEFAULT 0,
  connected INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, player_id),
  FOREIGN KEY (session_id) REFERENCES game_sessions(id)
);

CREATE TABLE IF NOT EXISTS answers (
  session_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  player_id TEXT NOT NULL,
  answer_index INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  response_ms INTEGER NOT NULL,
  correct INTEGER NOT NULL,
  points INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  PRIMARY KEY (session_id, question_id, player_id),
  FOREIGN KEY (session_id) REFERENCES game_sessions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS answers_one_per_player_question
  ON answers(session_id, question_id, player_id);
