import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  RoleContextReadyResponse,
  StaffShiftAttendanceResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
let wallTime = fixedTime;
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => wallTime },
});
const publicOrigin = "https://arena.example";
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  sessionSecret: "ticket-18-staff-handover-session-secret-32-bytes",
  secureCookies: true,
  wallClock: { now: () => wallTime },
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

beforeEach(() => {
  wallTime = fixedTime;
});

afterAll(async () => {
  await database.close();
});

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`))
    throw new Error(`Expected ${name} cookie.`);
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
      Origin: publicOrigin,
    },
    method: "POST",
  });
  const cookie = cookiePair(created, "jingshu_session");
  const context = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  return {
    context: (await context.json()) as RoleContextReadyResponse,
    cookie,
  };
}

async function switchRole(
  session: Awaited<ReturnType<typeof createRoleSession>>,
  targetRole: "hq" | "manager" | "staff",
) {
  const response = await app.request("/api/v1/demo/context/switch", {
    body: JSON.stringify({ targetRole }),
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookie,
      Origin: publicOrigin,
      "X-CSRF-Token": session.context.csrfToken,
    },
    method: "POST",
  });
  return {
    context: (await response.json()) as RoleContextReadyResponse,
    cookie: cookiePair(response, "jingshu_session"),
  };
}

async function checkIn(session: Awaited<ReturnType<typeof createRoleSession>>) {
  const schedule = await app.request("/api/v1/staff/shifts", {
    headers: { Cookie: session.cookie },
  });
  const shifts = (await schedule.json()) as StaffShiftAttendanceResponse;
  const shiftId = shifts.shifts.current!.shiftId;
  const response = await app.request(
    `/api/v1/staff/shifts/${shiftId}/attendance`,
    {
      body: JSON.stringify({ action: "simulated-check-in" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        Origin: publicOrigin,
        "X-CSRF-Token": session.context.csrfToken,
      },
      method: "POST",
    },
  );
  expect(response.status).toBe(200);
  return shiftId;
}

describe("staff handover API", () => {
  it("submits a frozen snapshot, signs out immediately, and lets a qualified same-store employee confirm", async () => {
    const staff = await createRoleSession("staff");
    const shiftId = await checkIn(staff);
    const preview = await app.request("/api/v1/staff/handovers", {
      headers: { Cookie: staff.cookie },
    });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      outgoing: {
        canSubmit: true,
        handover: null,
        shiftId,
        snapshotPreview: {
          lowStockAlerts: expect.any(Array),
          orders: expect.any(Array),
          repairs: expect.any(Array),
          reservations: expect.any(Array),
        },
      },
      status: "ready",
    });

    const submitted = await app.request("/api/v1/staff/handovers", {
      body: JSON.stringify({
        note: "A-18 耳机报修待分派。",
        shiftId,
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: staff.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        Origin: publicOrigin,
        "X-CSRF-Token": staff.context.csrfToken,
      },
      method: "POST",
    });
    expect(submitted.status).toBe(200);
    const handover = await submitted.json();
    expect(handover).toMatchObject({
      confirmed: null,
      note: "A-18 耳机报修待分派。",
      replayed: false,
      shiftId,
      submittedAt: {
        businessOccurredAt: expect.any(String),
        recordedAt: expect.any(String),
      },
    });

    const checkout = await app.request(
      `/api/v1/staff/shifts/${shiftId}/attendance`,
      {
        body: JSON.stringify({ action: "manual-check-out" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: staff.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": staff.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(checkout.status).toBe(200);

    const manager = await switchRole(staff, "manager");
    await checkIn(manager);
    const incoming = await app.request("/api/v1/staff/handovers", {
      headers: { Cookie: manager.cookie },
    });
    await expect(incoming.json()).resolves.toMatchObject({
      incoming: [
        {
          canConfirm: true,
          handover: { handoverId: handover.handoverId },
        },
      ],
    });
    const confirmed = await app.request(
      `/api/v1/staff/handovers/${handover.handoverId}/confirmation`,
      {
        body: JSON.stringify({}),
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
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({
      confirmed: {
        businessOccurredAt: expect.any(String),
        by: { displayName: "许知远" },
        recordedAt: expect.any(String),
      },
    });
  });

  it("rejects free-form sensitive fields and HQ frontline access", async () => {
    const staff = await createRoleSession("staff");
    const shiftId = await checkIn(staff);
    const unsafe = await app.request("/api/v1/staff/handovers", {
      body: JSON.stringify({
        cashCount: "1000",
        note: "真实支付对账待处理",
        shiftId,
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: staff.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        Origin: publicOrigin,
        "X-CSRF-Token": staff.context.csrfToken,
      },
      method: "POST",
    });
    expect(unsafe.status).toBe(422);

    const hq = await switchRole(staff, "hq");
    const denied = await app.request("/api/v1/staff/handovers", {
      headers: { Cookie: hq.cookie },
    });
    expect(denied.status).toBe(403);
  });
});
