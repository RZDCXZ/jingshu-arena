import { describe, expect, it } from "vitest";

import { app } from "./app.js";

describe("GET /api/v1/health", () => {
  it("reports that the Jingshu API skeleton is ready", async () => {
    const response = await app.request("/api/v1/health");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "jingshu-api",
      status: "ready",
    });
  });
});
