import { describe, expect, it } from "vitest";

import type {
  DatabaseRoleContext,
  PublicSandboxDatabase,
} from "@jingshu/database";

import { createApp } from "./app.js";
import {
  SandboxInvalidationHub,
  type SandboxRealtimeHub,
} from "./sandbox-realtime.js";
import { issueRoleSession } from "./role-session.js";

const sessionSecret = "ticket-27-realtime-unit-session-secret-32-bytes";

const roleContext = {
  businessClock: {
    advanceLimitMilliseconds: 86_400_000,
    advancedMilliseconds: 0,
    currentTime: new Date("2026-08-11T11:30:00.000Z"),
    remainingAdvanceMilliseconds: 86_400_000,
    timeZone: "Asia/Shanghai",
  },
  contextVersion: 1,
  expiresAt: new Date("2026-08-12T11:30:00.000Z"),
  persona: {
    displayName: "周宁",
    id: "00000000-0000-4000-8000-000000000202",
    protected: true,
    scope: "棱镜旗舰店",
    storeId: "00000000-0000-4000-8000-000000000101",
  },
  role: "staff",
  sandboxId: "00000000-0000-4000-8000-000000000301",
  schemaVersion: "8",
  seedVersion: "2026-08-11.1",
  storeScope: {
    kind: "store",
    stores: [
      {
        code: "prism-flagship",
        displayName: "棱镜旗舰店",
        id: "00000000-0000-4000-8000-000000000101",
      },
    ],
  },
} as const satisfies DatabaseRoleContext;

function realtimeDatabase(): PublicSandboxDatabase {
  return {
    close: async () => undefined,
    readRoleContext: async () => roleContext,
    switchRoleContext: async () => roleContext,
  } as PublicSandboxDatabase;
}

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const chunk = await reader.read();
  if (chunk.done || !chunk.value) {
    throw new Error("Expected an SSE frame.");
  }
  return new TextDecoder().decode(chunk.value);
}

describe("sandbox realtime invalidation", () => {
  it("advertises a failed realtime probe as unavailable instead of opening a misleading stream", async () => {
    const unavailableHub = {
      isAvailable: () => false,
      publish: () => undefined,
      subscribe: () => () => undefined,
    } satisfies SandboxRealtimeHub;
    const app = createApp({
      realtimeHub: unavailableHub,
      sandboxDatabase: realtimeDatabase(),
      sessionSecret,
    });
    const session = issueRoleSession(roleContext, sessionSecret);

    const health = await app.request("/api/v1/health/realtime");
    expect(health.status).toBe(503);
    await expect(health.json()).resolves.toEqual({
      service: "jingshu-realtime",
      status: "degraded",
    });

    const response = await app.request("/api/v1/demo/realtime", {
      headers: { Cookie: `jingshu_session=${session.token}` },
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ROLE_CONTEXT_SERVICE_UNAVAILABLE" },
    });
  });

  it("scopes SSE notifications to the signed sandbox and sends no session or business payload", async () => {
    const hub = new SandboxInvalidationHub();
    const app = createApp({
      realtimeConnectionLifetimeMilliseconds: 60_000,
      realtimeHub: hub,
      sandboxDatabase: realtimeDatabase(),
      sessionSecret,
    });
    const session = issueRoleSession(roleContext, sessionSecret);

    const response = await app.request("/api/v1/demo/realtime", {
      headers: { Cookie: `jingshu_session=${session.token}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected an SSE response body.");

    await expect(readFrame(reader)).resolves.toContain("event: connected");

    hub.publish(roleContext.sandboxId);
    const invalidation = await readFrame(reader);
    await reader.cancel();

    expect(invalidation).toBe(
      'event: invalidated\ndata: {"resource":"sandbox"}\n\n',
    );
    expect(invalidation).not.toContain("csrf");
    expect(invalidation).not.toContain(roleContext.sandboxId);
  });

  it("notifies every open sandbox stream after a successful role switch", async () => {
    const hub = new SandboxInvalidationHub();
    const app = createApp({
      realtimeConnectionLifetimeMilliseconds: 60_000,
      realtimeHub: hub,
      sandboxDatabase: realtimeDatabase(),
      sessionSecret,
    });
    const session = issueRoleSession(roleContext, sessionSecret);
    const cookie = `jingshu_session=${session.token}`;
    const streamResponse = await app.request("/api/v1/demo/realtime", {
      headers: { Cookie: cookie },
    });
    const reader = streamResponse.body?.getReader();
    if (!reader) throw new Error("Expected an SSE response body.");
    await readFrame(reader);

    const switched = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        Origin: "http://127.0.0.1:3000",
        "X-CSRF-Token": session.payload.csrfToken,
      },
      method: "POST",
    });

    expect(switched.status).toBe(200);
    await expect(readFrame(reader)).resolves.toContain("event: invalidated");
    await reader.cancel();
  }, 1_000);

  it("ends the approximately short-lived connection with a reconnect signal", async () => {
    const app = createApp({
      realtimeConnectionLifetimeMilliseconds: 1,
      sandboxDatabase: realtimeDatabase(),
      sessionSecret,
    });
    const session = issueRoleSession(roleContext, sessionSecret);
    const response = await app.request("/api/v1/demo/realtime", {
      headers: { Cookie: `jingshu_session=${session.token}` },
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Expected an SSE response body.");

    await expect(readFrame(reader)).resolves.toContain("event: connected");
    await expect(readFrame(reader)).resolves.toBe("event: reconnect\n\n");
    await expect(reader.read()).resolves.toMatchObject({ done: true });
  }, 1_000);
});
