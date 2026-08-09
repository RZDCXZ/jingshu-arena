import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";
import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const database = createPublicSandboxDatabase(databaseUrl);
const app = createApp({
  sandboxDatabase: database,
  sessionSecret: "ticket-03-integration-session-secret-32-bytes",
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

describe("POST /api/v1/public/sandboxes", () => {
  it("does not create a sandbox until a public role is selected", async () => {
    const creationKey = "00000000-0000-4000-8000-000000000009";
    const missingRole = await app.request("/api/v1/public/sandboxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": creationKey,
      },
      body: JSON.stringify({}),
    });

    expect(missingRole.status).toBe(400);
    await expect(missingRole.json()).resolves.toMatchObject({
      error: {
        code: "PUBLIC_ROLE_REQUIRED",
        message: "请选择一个演示角色后再创建沙箱。",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      },
    });

    const visitor = await app.request("/api/v1/public/visitor");
    expect(visitor.status).toBe(204);
    const visitorCookie = visitor.headers.get("set-cookie");
    expect(visitorCookie).toMatch(
      /^jingshu_visitor=[^.]+\.[^;]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/u,
    );
    const cookieHeader = visitorCookie?.split(";", 1)[0] ?? "";
    const existingVisitor = await app.request("/api/v1/public/visitor", {
      headers: { Cookie: cookieHeader },
    });
    expect(existingVisitor.status).toBe(204);
    expect(existingVisitor.headers.get("set-cookie")).toBeNull();

    const selected = await app.request("/api/v1/public/sandboxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        "Idempotency-Key": creationKey,
      },
      body: JSON.stringify({ role: "customer" }),
    });

    expect(selected.status).toBe(201);
    const body = await selected.json();
    expect(body).toMatchObject({
      status: "ready",
      replayed: false,
      role: "customer",
      persona: {
        displayName: "林澈",
        scope: "浏览三店 · 只管理自己的记录",
      },
      world: {
        schemaVersion: "2",
        seedVersion: "2026-08-09.1",
        operator: { displayName: "竞枢演示经营方", city: "栖光市" },
        stores: [
          { displayName: "棱镜旗舰店" },
          { displayName: "星桥标准店" },
          { displayName: "极点新店" },
        ],
      },
    });
    expect(JSON.stringify(body)).not.toContain("sandboxId");
    expect(selected.headers.get("set-cookie")).toMatch(
      /^jingshu_session=[^.]+\.[^;]+; Max-Age=86400; Path=\/; HttpOnly; SameSite=Lax$/u,
    );

    const missingVisitor = await app.request("/api/v1/public/sandboxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "00000000-0000-4000-8000-000000000014",
      },
      body: JSON.stringify({ role: "customer" }),
    });
    expect(missingVisitor.status).toBe(428);
    await expect(missingVisitor.json()).resolves.toMatchObject({
      error: { code: "PUBLIC_VISITOR_CONTEXT_REQUIRED" },
    });

    const tamperedVisitor = await app.request("/api/v1/public/sandboxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `${cookieHeader}-tampered`,
        "Idempotency-Key": "00000000-0000-4000-8000-000000000016",
      },
      body: JSON.stringify({ role: "customer" }),
    });
    expect(tamperedVisitor.status).toBe(428);
    await expect(tamperedVisitor.json()).resolves.toMatchObject({
      error: { code: "PUBLIC_VISITOR_CONTEXT_REQUIRED" },
    });

    const replay = await app.request("/api/v1/public/sandboxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        "Idempotency-Key": creationKey,
      },
      body: JSON.stringify({ role: "customer" }),
    });

    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      ...body,
      replayed: true,
    });

    const conflict = await app.request("/api/v1/public/sandboxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookieHeader,
        "Idempotency-Key": creationKey,
      },
      body: JSON.stringify({ role: "staff" }),
    });

    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: {
        code: "PUBLIC_SANDBOX_IDEMPOTENCY_CONFLICT",
        message: "这次重试与原创建请求不一致，请重新选择角色。",
      },
    });

    const otherVisitor = await app.request("/api/v1/public/visitor");
    const otherCookie = otherVisitor.headers
      .get("set-cookie")
      ?.split(";", 1)[0];
    const crossVisitorReplay = await app.request("/api/v1/public/sandboxes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: otherCookie ?? "",
        "Idempotency-Key": creationKey,
      },
      body: JSON.stringify({ role: "customer" }),
    });

    expect(crossVisitorReplay.status).toBe(409);
    await expect(crossVisitorReplay.json()).resolves.toMatchObject({
      error: { code: "PUBLIC_SANDBOX_OWNERSHIP_CONFLICT" },
    });
  });
});
