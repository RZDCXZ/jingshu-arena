import { serve } from "@hono/node-server";

import { app } from "./app.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Jingshu API listening on http://localhost:${port}`);
