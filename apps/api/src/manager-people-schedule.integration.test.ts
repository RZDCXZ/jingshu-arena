import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type {
  HeadquartersPeopleScheduleResponse,
  ManagerPeopleCommandResponse,
  ManagerPeopleScheduleResponse,
  ManagerShiftCoveragePreviewResponse,
  RoleContextReadyResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const publicOrigin = "https://arena.example";
const fixedTime = new Date("2026-08-10T11:47:23.000Z");
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => fixedTime },
});
const sql = new Pool({ connectionString: databaseUrl });
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  secureCookies: true,
  sessionSecret: "ticket-21-manager-people-secret-32-bytes",
  wallClock: { now: () => fixedTime },
});

beforeAll(async () => migrateEmptyDatabase(databaseUrl));
afterAll(async () => {
  await database.close();
  await sql.end();
});

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`)) throw new Error(`Expected ${name}.`);
  return pair;
}

async function createRoleSession(role: "hq" | "manager" | "staff") {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie = cookiePair(visitor, "jingshu_visitor");
  const created = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: publicOrigin,
    },
    method: "POST",
  });
  const cookie = cookiePair(created, "jingshu_session");
  const contextResponse = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  return {
    context: (await contextResponse.json()) as RoleContextReadyResponse,
    cookie,
  };
}

describe("manager people schedule API", () => {
  it("returns the manager's fixed roster and accepts dedicated people commands", async () => {
    const manager = await createRoleSession("manager");
    const readResponse = await app.request("/api/v1/manager/people-schedule", {
      headers: { Cookie: manager.cookie },
    });
    const page = (await readResponse.json()) as ManagerPeopleScheduleResponse;
    expect(readResponse.status).toBe(200);
    expect(page.status).toBe("ready");
    expect(page.store).toMatchObject({ code: "prism-flagship", fixed: true });
    expect(page.employees).toHaveLength(16);

    const commandResponse = await app.request(
      "/api/v1/manager/people-schedule/commands",
      {
        body: JSON.stringify({
          action: "create-employee",
          displayName: "夜班增援",
          employeeCode: "PRISM-S017",
          employeeRole: "staff",
          storeId: page.store.storeId,
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      },
    );
    const command =
      (await commandResponse.json()) as ManagerPeopleCommandResponse;
    expect(commandResponse.status).toBe(200);
    expect(command).toMatchObject({
      action: "create-employee",
      replayed: false,
      status: "ready",
    });

    const previewResponse = await app.request(
      "/api/v1/manager/people-schedule/shift-preview",
      {
        body: JSON.stringify({
          employeeId: command.objectId,
          endsAt: "2026-08-14T08:00:00.000Z",
          startsAt: "2026-08-14T00:00:00.000Z",
          storeId: page.store.storeId,
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      },
    );
    const preview =
      (await previewResponse.json()) as ManagerShiftCoveragePreviewResponse;
    expect(previewResponse.status).toBe(200);
    expect(preview.validation).toEqual({ status: "valid" });
    expect(preview.warnings).toHaveLength(1);
  });

  it("keeps headquarters read-only and records a denied manager capability", async () => {
    const hq = await createRoleSession("hq");
    const auditCountBefore = await sql.query<{ count: number }>(
      "select count(*)::integer as count from audit_events",
    );
    const readResponse = await app.request("/api/v1/hq/people-schedule", {
      headers: { Cookie: hq.cookie },
    });
    const payload =
      (await readResponse.json()) as HeadquartersPeopleScheduleResponse;
    expect(readResponse.status).toBe(200);
    expect(payload.stores.map((store) => store.employeeCount)).toEqual([
      16, 10, 7,
    ]);
    expect(
      payload.stores.every((store) =>
        Number.isInteger(store.attendanceAnomalyCount),
      ),
    ).toBe(true);
    expect(
      payload.stores.every(
        (store) =>
          store.employees.length === store.employeeCount &&
          store.employees.every(
            (employee) =>
              employee.displayName.length > 0 &&
              employee.employeeCode.length > 0 &&
              ["manager", "staff"].includes(employee.role),
          ) &&
          store.futureShifts.every(
            (shift) =>
              shift.employee.displayName.length > 0 &&
              new Date(shift.startsAt).getTime() <
                new Date(shift.endsAt).getTime(),
          ) &&
          store.coverage.endsAt > store.coverage.startsAt,
      ),
    ).toBe(true);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(
      /employeeId|personaId|phone|mobile|email|address|identity/iu,
    );
    const auditCountAfter = await sql.query<{ count: number }>(
      "select count(*)::integer as count from audit_events",
    );
    expect(auditCountAfter.rows[0]!.count).toBe(
      auditCountBefore.rows[0]!.count,
    );

    const denied = await app.request(
      "/api/v1/manager/people-schedule/commands",
      {
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
          Cookie: hq.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": hq.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(denied.status).toBe(403);
    const audit = await sql.query<{ count: number }>(
      `select count(*)::integer as count from audit_events
        where result = 'denied' and reason = 'capability_denied'`,
    );
    expect(audit.rows[0]!.count).toBeGreaterThan(0);
  });
});
