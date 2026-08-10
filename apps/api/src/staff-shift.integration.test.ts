import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import type { RoleContextReadyResponse } from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const { Client } = pg;

const fixedBusinessTime = new Date("2026-08-10T11:47:23.000Z");
let apiWallTime = fixedBusinessTime;
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => apiWallTime },
});
const publicOrigin = "https://arena.example";
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  sessionSecret: "ticket-17-staff-attendance-session-secret-32-bytes",
  secureCookies: true,
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

beforeEach(() => {
  apiWallTime = fixedBusinessTime;
});

afterAll(async () => {
  await database.close();
});

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`)) {
    throw new Error(`Expected ${name} cookie.`);
  }
  return pair;
}

async function createRoleSession(role: "customer" | "manager" | "staff") {
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
  expect(created.status, JSON.stringify(await created.clone().json())).toBe(
    201,
  );
  const cookie = cookiePair(created, "jingshu_session");
  const contextResponse = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  return {
    context: (await contextResponse.json()) as RoleContextReadyResponse,
    cookie,
  };
}

async function switchRole(
  session: Awaited<ReturnType<typeof createRoleSession>>,
  targetRole: "hq" | "manager" | "staff",
) {
  const switched = await app.request("/api/v1/demo/context/switch", {
    body: JSON.stringify({ targetRole }),
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookie,
      Origin: publicOrigin,
      "X-CSRF-Token": session.context.csrfToken,
    },
    method: "POST",
  });
  expect(switched.status, JSON.stringify(await switched.clone().json())).toBe(
    200,
  );
  return {
    context: (await switched.json()) as RoleContextReadyResponse,
    cookie: cookiePair(switched, "jingshu_session"),
  };
}

async function attendanceCommand(
  session: Awaited<ReturnType<typeof createRoleSession>>,
  shiftId: string,
  action: "manual-check-out" | "simulated-check-in",
  idempotencyKey = crypto.randomUUID(),
) {
  return app.request(`/api/v1/staff/shifts/${shiftId}/attendance`, {
    body: JSON.stringify({ action }),
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookie,
      "Idempotency-Key": idempotencyKey,
      Origin: publicOrigin,
      "X-CSRF-Token": session.context.csrfToken,
    },
    method: "POST",
  });
}

describe("staff shift attendance API", () => {
  it("returns only the signed-in employee shifts and safely replays check-in", async () => {
    const session = await createRoleSession("staff");
    const initial = await app.request("/api/v1/staff/shifts", {
      headers: { Cookie: session.cookie },
    });
    expect(initial.status).toBe(200);
    const body = await initial.json();
    expect(body).toMatchObject({
      employee: {
        displayName: "周宁",
        employeeCode: "PRISM-S001",
        role: "staff",
      },
      status: "ready",
      store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      shifts: {
        current: {
          attendance: null,
          nextAction: { kind: "simulated-check-in", label: "模拟签到" },
        },
      },
    });
    expect(body.shifts.future).toHaveLength(2);

    const shiftId = body.shifts.current.shiftId as string;
    const key = crypto.randomUUID();
    const first = await attendanceCommand(
      session,
      shiftId,
      "simulated-check-in",
      key,
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      outcome: "on-time",
      replayed: false,
      status: "checked-in",
    });
    const replay = await attendanceCommand(
      session,
      shiftId,
      "simulated-check-in",
      key,
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      replayed: true,
      status: "checked-in",
    });
  });

  it("uses the sandbox business clock for late, absence and manual sign-out", async () => {
    const lateSession = await createRoleSession("staff");
    const lateSchedule = await app.request("/api/v1/staff/shifts", {
      headers: { Cookie: lateSession.cookie },
    });
    const lateBody = await lateSchedule.json();
    const lateShift = lateBody.shifts.current;
    apiWallTime = new Date(Date.parse(lateShift.window.startsAt) + 60_000);
    const late = await attendanceCommand(
      lateSession,
      lateShift.shiftId,
      "simulated-check-in",
    );
    expect(late.status).toBe(200);
    await expect(late.json()).resolves.toMatchObject({ outcome: "late" });
    apiWallTime = new Date(Date.parse(lateShift.window.endsAt) + 30 * 60_000);
    const awaitingManualSignOut = await app.request("/api/v1/staff/shifts", {
      headers: { Cookie: lateSession.cookie },
    });
    await expect(awaitingManualSignOut.json()).resolves.toMatchObject({
      shifts: {
        current: {
          attendance: { status: "checked-in" },
          nextAction: { kind: "manual-check-out" },
        },
      },
    });
    const checkedOut = await attendanceCommand(
      lateSession,
      lateShift.shiftId,
      "manual-check-out",
    );
    expect(checkedOut.status).toBe(200);
    await expect(checkedOut.json()).resolves.toMatchObject({
      outcome: "late",
      status: "checked-out",
    });

    apiWallTime = fixedBusinessTime;
    const absentSession = await createRoleSession("manager");
    const absentSchedule = await app.request("/api/v1/staff/shifts", {
      headers: { Cookie: absentSession.cookie },
    });
    const absentBody = await absentSchedule.json();
    apiWallTime = new Date(Date.parse(absentBody.shifts.current.window.endsAt));
    const advanced = await app.request("/api/v1/staff/shifts", {
      headers: { Cookie: absentSession.cookie },
    });
    expect(advanced.status).toBe(200);
    await expect(advanced.json()).resolves.toMatchObject({
      shifts: {
        recent: [
          {
            attendance: { status: "absent" },
            nextAction: null,
          },
        ],
      },
    });
  });

  it("rejects customer access and unsafe command envelopes", async () => {
    const customer = await createRoleSession("customer");
    const denied = await app.request("/api/v1/staff/shifts", {
      headers: { Cookie: customer.cookie },
    });
    expect(denied.status).toBe(403);

    const staff = await createRoleSession("staff");
    const schedule = await app.request("/api/v1/staff/shifts", {
      headers: { Cookie: staff.cookie },
    });
    const body = await schedule.json();
    const missingOrigin = await app.request(
      `/api/v1/staff/shifts/${body.shifts.current.shiftId}/attendance`,
      {
        body: JSON.stringify({ action: "simulated-check-in" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: staff.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          "X-CSRF-Token": staff.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(missingOrigin.status).toBe(403);
    const invalid = await attendanceCommand(
      staff,
      "not-a-shift-id",
      "simulated-check-in",
    );
    expect(invalid.status).toBe(422);
  });

  it("denies and audits other-employee and HQ frontline attendance access", async () => {
    const staff = await createRoleSession("staff");
    const manager = await switchRole(staff, "manager");
    const managerSchedule = await app.request("/api/v1/staff/shifts", {
      headers: { Cookie: manager.cookie },
    });
    const managerBody = await managerSchedule.json();
    const managerShiftId = managerBody.shifts.current.shiftId as string;

    const returnedStaff = await switchRole(manager, "staff");
    const crossEmployee = await attendanceCommand(
      returnedStaff,
      managerShiftId,
      "simulated-check-in",
    );
    expect(crossEmployee.status).toBe(404);

    const hq = await switchRole(returnedStaff, "hq");
    const hqDenied = await app.request("/api/v1/staff/shifts", {
      headers: { Cookie: hq.cookie },
    });
    expect(hqDenied.status).toBe(403);

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const audits = await client.query<{
        action: string;
        reason: string | null;
        result: string;
      }>(
        `select action, reason, result
           from audit_events
          where object_id = $1
          order by recorded_at desc`,
        [managerShiftId],
      );
      expect(audits.rows[0]).toMatchObject({
        action: "attendance.simulated-check-in",
        reason: "not-own-shift",
        result: "denied",
      });
      const hqAudits = await client.query<{
        reason: string | null;
        result: string;
        role: string;
      }>(
        `select reason, result, role
           from audit_events
          where request_id = $1
          order by recorded_at desc`,
        [hqDenied.headers.get("x-request-id")],
      );
      expect(hqAudits.rows[0]).toEqual({
        reason: "capability_denied",
        result: "denied",
        role: "hq",
      });
    } finally {
      await client.end();
    }
  });
});
