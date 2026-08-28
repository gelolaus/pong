import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";

writeFileSync(".dev.vars", `AUTH_GOOGLE_ID=test-google-id
AUTH_GOOGLE_SECRET=test-google-secret
AUTH_SECRET=e2e-auth-secret-e2e-auth-secret
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
PONG_TEST_MODE=1
`);

const child = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", "5173"], {
  stdio: "inherit",
  env: { ...process.env, PONG_TEST_MODE: "1" },
});

child.on("exit", (code) => process.exit(code ?? 0));
