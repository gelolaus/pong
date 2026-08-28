import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { applySchema, createTursoTransport, seedEventQuiz } from "../worker/db";

const env = {
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL?.trim() ?? "",
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN?.trim() ?? "",
};

if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
  console.error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before seeding.");
  process.exit(1);
}

const schemaSql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../worker/schema.sql"), "utf8");
const transport = createTursoTransport(env);

await applySchema(transport, schemaSql);
const result = await seedEventQuiz(transport);

console.log(`Applied Pong schema and seeded ${result.questionCount} questions for quiz ${result.quizId}.`);
