import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RoleContextReadyResponse } from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";
import { PostgresSandboxInvalidationHub } from "./sandbox-realtime.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const publicOrigin = "https://arena.example";
const sessionSecret = "ticket-27-realtime-integration-session-secret-32-bytes";
const writerDatabase = createPublicSandboxDatabase(databaseUrl);
const readerDatabase = createPublicSandboxDatabase(databaseUrl);
const writerHub = new PostgresSandboxInvalidationHub(databaseUrl);
const readerHub = new PostgresSandboxInvalidationHub(databaseUrl);
const writerApp = createApp({
  allowedOrigins: [publicOrigin],
  realtimeConnectionLifetimeMilliseconds: 60_000,
  realtimeHub: writerHub,
  sandboxDatabase: writerDatabase,
  sessionSecret,
});
const readerApp = createApp({
  allowedOrigins: [publicOrigin],
  realtimeConnectionLifetimeMilliseconds: 60_000,
  realtimeHub: readerHub,
  sandboxDatabase: readerDatabase,
  sessionSecret,
});

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`)) {
    throw new Error(`Expected ${name} cookie.`);
  }
  return pair;
}

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for an SSE frame.")),
      2_000,
    );
    void reader
      .read()
      .then((chunk) => {
        if (chunk.done || !chunk.value) {
          throw new Error("Expected an SSE frame.");
        }
        return new TextDecoder().decode(chunk.value);
      })
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
  await Promise.all([writerHub.start(), readerHub.start()]);
});

afterAll(async () => {
  await Promise.all([
    writerHub.close(),
    readerHub.close(),
    writerDatabase.close(),
    readerDatabase.close(),
  ]);
});

describe("distributed sandbox realtime invalidation", () => {
  it("delivers real role-switch, time-advance, and reset mutations from one API instance to another instance's SSE stream", async () => {
    const visitor = await writerApp.request("/api/v1/public/visitor");
    const visitorCookie = cookiePair(visitor, "jingshu_visitor");
    const created = await writerApp.request("/api/v1/public/sandboxes", {
      body: JSON.stringify({ role: "staff" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: visitorCookie,
        "Idempotency-Key": "00000000-0000-4000-8000-000000002701",
        Origin: publicOrigin,
      },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const sessionCookie = cookiePair(created, "jingshu_session");
    const contextResponse = await writerApp.request("/api/v1/demo/context", {
      headers: { Cookie: sessionCookie },
    });
    const context = (await contextResponse.json()) as RoleContextReadyResponse;

    const stream = await readerApp.request("/api/v1/demo/realtime", {
      headers: { Cookie: sessionCookie },
    });
    expect(stream.status).toBe(200);
    const reader = stream.body?.getReader();
    if (!reader) throw new Error("Expected an SSE response body.");
    await expect(readFrame(reader)).resolves.toBe("event: connected\n\n");

    const switched = await writerApp.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": context.csrfToken,
      },
      method: "POST",
    });
    expect(switched.status).toBe(200);
    const switchedContext = (await switched.json()) as RoleContextReadyResponse;
    const switchedSessionCookie = cookiePair(switched, "jingshu_session");
    await expect(readFrame(reader)).resolves.toBe(
      'event: invalidated\ndata: {"resource":"sandbox"}\n\n',
    );

    const advance = await writerApp.request("/api/v1/demo/time/advance", {
      body: JSON.stringify({ mode: "half-hour" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: switchedSessionCookie,
        "Idempotency-Key": "00000000-0000-4000-8000-000000002702",
        Origin: publicOrigin,
        "X-CSRF-Token": switchedContext.csrfToken,
      },
      method: "POST",
    });
    expect(advance.status).toBe(200);
    await expect(readFrame(reader)).resolves.toBe(
      'event: invalidated\ndata: {"resource":"sandbox"}\n\n',
    );

    const reset = await writerApp.request("/api/v1/demo/reset", {
      body: JSON.stringify({ confirm: true }),
      headers: {
        "Content-Type": "application/json",
        Cookie: switchedSessionCookie,
        "Idempotency-Key": "00000000-0000-4000-8000-000000002703",
        Origin: publicOrigin,
        "X-CSRF-Token": switchedContext.csrfToken,
      },
      method: "POST",
    });
    expect(reset.status).toBe(201);
    await expect(readFrame(reader)).resolves.toBe(
      'event: invalidated\ndata: {"resource":"sandbox"}\n\n',
    );
    await reader.cancel();
  }, 10_000);
});
