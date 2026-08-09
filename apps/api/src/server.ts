import { serve } from "@hono/node-server";
import { createPublicSandboxDatabase } from "@jingshu/database";

import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to start the Jingshu API.");
}
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}

const database = createPublicSandboxDatabase(databaseUrl);
const app = createApp({
  sandboxDatabase: database,
  sessionSecret,
});
const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`Jingshu API listening on http://localhost:${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void database.close().finally(() => process.exit(0));
    });
  });
}
