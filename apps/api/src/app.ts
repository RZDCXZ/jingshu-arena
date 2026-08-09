import { Hono } from "hono";
import type { ApiHealth } from "@jingshu/contracts";

export const app = new Hono();

app.get("/api/v1/health", (context) =>
  context.json({
    service: "jingshu-api",
    status: "ready",
  } satisfies ApiHealth),
);
