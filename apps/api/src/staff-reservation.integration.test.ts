import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  CustomerPendingReservationResponse,
  RoleContextReadyResponse,
  StaffReservationDetailResponse,
  StaffReservationListResponse,
  StaffReservationWorkbenchResponse,
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

const fixedBusinessTime = new Date("2026-08-10T11:47:23.000Z");
let apiWallTime = fixedBusinessTime;
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => apiWallTime },
});
const publicOrigin = "https://arena.example";
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  sessionSecret: "ticket-09-staff-reservation-session-secret-32-bytes",
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
  if (!pair?.startsWith(`${name}=`))
    throw new Error(`Expected ${name} cookie.`);
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
  expect(contextResponse.status).toBe(200);
  return {
    context: (await contextResponse.json()) as RoleContextReadyResponse,
    cookie,
  };
}

async function switchRole(
  session: Awaited<ReturnType<typeof createRoleSession>>,
  targetRole: "customer" | "manager" | "staff",
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

async function command(
  session: Awaited<ReturnType<typeof createRoleSession>>,
  reservationId: string,
  body: { action: string; reason?: string },
  idempotencyKey = crypto.randomUUID(),
) {
  return app.request(`/api/v1/staff/reservations/${reservationId}/commands`, {
    body: JSON.stringify(body),
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

describe("staff reservation operations API", () => {
  it("serves scoped workbench queues, filters and immutable detail", async () => {
    const session = await createRoleSession("staff");
    const workbenchResponse = await app.request("/api/v1/staff/workbench", {
      headers: { Cookie: session.cookie },
    });
    expect(workbenchResponse.status).toBe(200);
    const workbench =
      (await workbenchResponse.json()) as StaffReservationWorkbenchResponse;
    expect(workbench).toMatchObject({
      businessDay: {
        endsAt: "2026-08-10T22:00:00.000Z",
        key: "2026-08-10",
        startsAt: "2026-08-09T22:00:00.000Z",
      },
      status: "ready",
      store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
    });
    expect(workbench.queues.arrivalWindow.length).toBeGreaterThan(0);
    expect(workbench.queues.arrived).toHaveLength(1);
    expect(workbench.queues.inUse.length).toBeGreaterThanOrEqual(2);
    expect(workbench.queues.anomalies).toHaveLength(1);

    const listResponse = await app.request(
      "/api/v1/staff/reservations?status=in-use&anomaly=only&time=in-progress",
      { headers: { Cookie: session.cookie } },
    );
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as StaffReservationListResponse;
    expect(list.rows).toEqual([
      expect.objectContaining({
        anomaly: { code: "seat-maintenance", label: "座位维护中" },
        status: "in-use",
      }),
    ]);

    const reservation = workbench.queues.arrivalWindow[0];
    expect(reservation).toBeDefined();
    const detailResponse = await app.request(
      `/api/v1/staff/reservations/${reservation!.reservationId}`,
      { headers: { Cookie: session.cookie } },
    );
    expect(detailResponse.status).toBe(200);
    const detail =
      (await detailResponse.json()) as StaffReservationDetailResponse;
    expect(detail).toMatchObject({
      actions: {
        canCancel: true,
        primary: { kind: "arrive", label: "办理到店", requiresReason: false },
      },
      auditAvailable: false,
      reservation: { reservationId: reservation!.reservationId },
      snapshot: { price: { segments: expect.any(Array) } },
      timeline: [
        expect.objectContaining({ type: "reservation.pending-created" }),
        expect.objectContaining({
          type: "reservation.simulated-payment-succeeded",
        }),
      ],
    });
  });

  it("validates reason text and safely replays an atomic arrival", async () => {
    const session = await createRoleSession("staff");
    const workbenchResponse = await app.request("/api/v1/staff/workbench", {
      headers: { Cookie: session.cookie },
    });
    const workbench =
      (await workbenchResponse.json()) as StaffReservationWorkbenchResponse;
    const reservation = workbench.queues.arrivalWindow[0]!;

    const unsafe = await command(session, reservation.reservationId, {
      action: "cancel",
      reason: "顾客<script>",
    });
    expect(unsafe.status).toBe(422);
    const missingOrigin = await app.request(
      `/api/v1/staff/reservations/${reservation.reservationId}/commands`,
      {
        body: JSON.stringify({ action: "arrive" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          "X-CSRF-Token": session.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(missingOrigin.status).toBe(403);

    const key = crypto.randomUUID();
    const first = await command(
      session,
      reservation.reservationId,
      { action: "arrive" },
      key,
    );
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      replayed: false,
      status: "arrived",
    });
    const replay = await command(
      session,
      reservation.reservationId,
      { action: "arrive" },
      key,
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      replayed: true,
      status: "arrived",
    });
  });

  it("lets a manager cancel before use and returns the simulated refund", async () => {
    const session = await createRoleSession("manager");
    const listResponse = await app.request(
      "/api/v1/staff/reservations?status=arrived",
      { headers: { Cookie: session.cookie } },
    );
    const list = (await listResponse.json()) as StaffReservationListResponse;
    const reservation = list.rows[0]!;
    const cancelled = await command(session, reservation.reservationId, {
      action: "cancel",
      reason: "门店应顾客请求取消",
    });
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({
      status: "cancelled",
    });
    const detail = await app.request(
      `/api/v1/staff/reservations/${reservation.reservationId}`,
      { headers: { Cookie: session.cookie } },
    );
    await expect(detail.json()).resolves.toMatchObject({
      actions: { canCancel: false, primary: null },
      refund: { simulated: true },
      terminalReason: "门店应顾客请求取消",
    });
  });

  it("keeps customer and staff reads on one authoritative lifecycle", async () => {
    let session = await createRoleSession("customer");
    const pendingResponse = await app.request("/api/v1/customer/reservations", {
      body: JSON.stringify({
        areaCode: "competitive-a",
        couponId: null,
        durationHours: 2,
        machineProfileCode: "competitive",
        mode: "future",
        requestedStartsAt: "2026-08-10T12:00:00.000Z",
        seatCode: "A-08",
        storeCode: "prism-flagship",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        Origin: publicOrigin,
        "X-CSRF-Token": session.context.csrfToken,
      },
      method: "POST",
    });
    expect(pendingResponse.status).toBe(201);
    const pending =
      (await pendingResponse.json()) as CustomerPendingReservationResponse;
    const paid = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}/simulated-payment`,
      {
        headers: {
          Cookie: session.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": session.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(paid.status).toBe(200);

    session = await switchRole(session, "staff");
    expect(
      await command(session, pending.reservationId, { action: "arrive" }),
    ).toMatchObject({ status: 200 });
    session = await switchRole(session, "customer");
    let customerDetail = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}`,
      { headers: { Cookie: session.cookie } },
    );
    await expect(customerDetail.json()).resolves.toMatchObject({
      status: "arrived",
    });

    apiWallTime = new Date("2026-08-10T12:00:00.000Z");
    session = await switchRole(session, "staff");
    expect(
      await command(session, pending.reservationId, { action: "start-use" }),
    ).toMatchObject({ status: 200 });
    session = await switchRole(session, "customer");
    customerDetail = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}`,
      { headers: { Cookie: session.cookie } },
    );
    await expect(customerDetail.json()).resolves.toMatchObject({
      status: "in-use",
    });

    apiWallTime = new Date("2026-08-10T12:01:00.000Z");
    session = await switchRole(session, "staff");
    expect(
      await command(session, pending.reservationId, {
        action: "complete-early",
        reason: "顾客主动提前结束",
      }),
    ).toMatchObject({ status: 200 });
    session = await switchRole(session, "customer");
    customerDetail = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}`,
      { headers: { Cookie: session.cookie } },
    );
    await expect(customerDetail.json()).resolves.toMatchObject({
      status: "completed",
      terminalReason: "顾客主动提前结束",
      timeline: expect.arrayContaining([
        expect.objectContaining({ type: "reservation.arrived" }),
        expect.objectContaining({ type: "reservation.started" }),
        expect.objectContaining({ type: "reservation.completed-early" }),
      ]),
    });
  });
});
