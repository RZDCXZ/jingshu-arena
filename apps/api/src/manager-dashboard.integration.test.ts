import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  ApiErrorResponse,
  ManagerDashboardResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => fixedTime },
});
const app = createApp({
  allowedOrigins: ["https://arena.example"],
  sandboxDatabase: database,
  secureCookies: true,
  sessionSecret: "ticket-22-manager-dashboard-secret",
  wallClock: { now: () => fixedTime },
});

beforeAll(async () => migrateEmptyDatabase(databaseUrl));
afterAll(async () => database.close());

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`)) throw new Error(`Expected ${name}.`);
  return pair;
}

async function createRoleSession(role: "manager" | "staff") {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie = cookiePair(visitor, "jingshu_visitor");
  const created = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: "https://arena.example",
    },
    method: "POST",
  });
  return cookiePair(created, "jingshu_session");
}

describe("manager dashboard API", () => {
  it("serializes the manager's current dashboard and same-range revenue drilldown", async () => {
    const cookie = await createRoleSession("manager");
    const response = await app.request(
      "/api/v1/manager/dashboard?from=2026-08-04&to=2026-08-10&drilldown=revenue",
      { headers: { Cookie: cookie } },
    );
    const payload = (await response.json()) as ManagerDashboardResponse;

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(payload.status).toBe("ready");
    expect(payload.days).toHaveLength(7);
    expect(payload.currentTime).toBe("2026-08-10T11:47:23.000Z");
    expect(payload.availableBusinessDays[0]?.startsAt).toMatch(/Z$/u);
    expect(payload.drilldown).toMatchObject({
      fromBusinessDay: "2026-08-04",
      kind: "revenue",
      storeCode: "prism-flagship",
      toBusinessDay: "2026-08-10",
    });
    expect(payload.drilldown?.rows[0]?.occurredAt).toMatch(/Z$/u);
  });

  it("rejects partial ranges and non-manager sessions", async () => {
    const managerCookie = await createRoleSession("manager");
    const invalid = await app.request(
      "/api/v1/manager/dashboard?from=2026-08-04",
      { headers: { Cookie: managerCookie } },
    );
    expect(invalid.status).toBe(422);
    expect((await invalid.json()) as ApiErrorResponse).toMatchObject({
      error: { code: "MANAGER_DASHBOARD_RANGE_INVALID" },
    });

    const staffCookie = await createRoleSession("staff");
    const denied = await app.request("/api/v1/manager/dashboard", {
      headers: { Cookie: staffCookie },
    });
    expect(denied.status).toBe(403);
    expect((await denied.json()) as ApiErrorResponse).toMatchObject({
      error: { code: "MANAGER_DASHBOARD_MANAGER_REQUIRED" },
    });
  });
});
