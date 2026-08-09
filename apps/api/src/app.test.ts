import { describe, expect, it, vi } from "vitest";

import type { PublicSandboxDatabase } from "@jingshu/database";
import {
  RoleContextUnavailableError,
  type DatabaseRoleContext,
} from "@jingshu/database";

import { app, createApp } from "./app.js";
import { issueRoleSession } from "./role-session.js";

const sessionSecret = "unit-role-context-session-secret-32-bytes";
const roleContext = {
  contextVersion: 1,
  expiresAt: new Date(Date.now() + 60_000),
  persona: {
    displayName: "周宁",
    id: "00000000-0000-4000-8000-000000000202",
    protected: true,
    scope: "棱镜旗舰店",
    storeId: "00000000-0000-4000-8000-000000000101",
  },
  role: "staff",
  sandboxId: "00000000-0000-4000-8000-000000000301",
  schemaVersion: "3",
  seedVersion: "2026-08-09.1",
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

function databaseThrowing(error: Error): PublicSandboxDatabase {
  return {
    close: vi.fn(),
    create: vi.fn(),
    readCurrentRoleContext: vi.fn(async () => {
      throw error;
    }),
    readRoleContext: vi.fn(async () => {
      throw error;
    }),
    recordRoleContextDenial: vi.fn(),
    switchRoleContext: vi.fn(),
  };
}

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

describe("GET /api/v1/demo/context errors", () => {
  it("distinguishes an unavailable role context from an infrastructure failure", async () => {
    const token = issueRoleSession(roleContext, sessionSecret).token;
    const unavailableApp = createApp({
      sandboxDatabase: databaseThrowing(new RoleContextUnavailableError()),
      sessionSecret,
    });
    const unavailable = await unavailableApp.request("/api/v1/demo/context", {
      headers: { Cookie: `jingshu_session=${token}` },
    });
    expect(unavailable.status).toBe(401);
    await expect(unavailable.json()).resolves.toMatchObject({
      error: { code: "ROLE_CONTEXT_UNAVAILABLE" },
    });

    const failingApp = createApp({
      sandboxDatabase: databaseThrowing(new Error("database offline")),
      sessionSecret,
    });
    const failed = await failingApp.request("/api/v1/demo/context", {
      headers: { Cookie: `jingshu_session=${token}` },
    });
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: "ROLE_CONTEXT_SERVICE_UNAVAILABLE" },
    });
  });
});
