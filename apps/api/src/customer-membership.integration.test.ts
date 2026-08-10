import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  CustomerJourneyResponse,
  CustomerMembershipResponse,
  CustomerPendingReservationResponse,
  RoleContextReadyResponse,
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
  sessionSecret: "ticket-10-membership-session-secret-32-bytes",
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

async function membership(
  session: Awaited<ReturnType<typeof createRoleSession>>,
) {
  const response = await app.request("/api/v1/customer/membership", {
    headers: { Cookie: session.cookie },
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(
    200,
  );
  return (await response.json()) as CustomerMembershipResponse;
}

async function journey(session: Awaited<ReturnType<typeof createRoleSession>>) {
  const response = await app.request("/api/v1/customer/journey", {
    headers: { Cookie: session.cookie },
  });
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(
    200,
  );
  return (await response.json()) as CustomerJourneyResponse;
}

async function createReservation(
  session: Awaited<ReturnType<typeof createRoleSession>>,
  couponId: string | null,
  mode: "future" | "immediate" = "future",
) {
  const response = await app.request("/api/v1/customer/reservations", {
    body: JSON.stringify({
      areaCode: "competitive-a",
      couponId,
      durationHours: 2,
      machineProfileCode: "competitive",
      mode,
      ...(mode === "future"
        ? { requestedStartsAt: "2026-08-10T13:00:00.000Z" }
        : {}),
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
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(
    201,
  );
  return (await response.json()) as CustomerPendingReservationResponse;
}

async function simulatePayment(
  session: Awaited<ReturnType<typeof createRoleSession>>,
  reservationId: string,
) {
  const response = await app.request(
    `/api/v1/customer/reservations/${reservationId}/simulated-payment`,
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
  expect(response.status, JSON.stringify(await response.clone().json())).toBe(
    200,
  );
}

async function staffCommand(
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

describe("customer membership and journey API", () => {
  it("serves the authoritative silver profile, coupon history and personal journey", async () => {
    const session = await createRoleSession("customer");
    const profile = await membership(session);

    expect(profile).toMatchObject({
      status: "ready",
      profile: {
        growthPoints: 860,
        lifetimeNondecreasing: true,
        nextTier: { remainingGrowthPoints: 640, threshold: 1_500 },
        operatorScope: "三店共享",
        tier: { code: "silver", label: "白银" },
      },
    });
    expect(
      profile.coupons.filter((coupon) => coupon.status === "available"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          businessKind: "reservation",
          code: "reservation-six",
        }),
        expect.objectContaining({
          businessKind: "order",
          code: "order-five",
        }),
      ]),
    );
    expect(new Set(profile.coupons.map((coupon) => coupon.status))).toEqual(
      new Set(["available", "expired", "redeemed"]),
    );
    expect(
      profile.coupons.find((coupon) => coupon.status === "redeemed"),
    ).toMatchObject({
      transaction: { kind: "reservation", status: "completed" },
    });
    expect(
      profile.growthEvents.reduce(
        (total, event) => total + event.growthPoints,
        0,
      ),
    ).toBe(860);

    const personalJourney = await journey(session);
    expect(personalJourney.groups.current).toEqual([]);
    expect(personalJourney.groups.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          growthAward: { growthPoints: expect.any(Number) },
          status: "completed",
        }),
      ]),
    );
  });

  it("moves a coupon through reserved and redeemed and awards completion growth once", async () => {
    let session = await createRoleSession("customer");
    const before = await membership(session);
    const coupon = before.coupons.find(
      (item) =>
        item.businessKind === "reservation" && item.status === "available",
    );
    expect(coupon).toBeDefined();

    const pending = await createReservation(session, coupon!.id);
    const duringHold = await membership(session);
    expect(new Set(duringHold.coupons.map((item) => item.status))).toEqual(
      new Set(["available", "expired", "redeemed", "reserved"]),
    );
    expect(
      duringHold.coupons.find((item) => item.id === coupon!.id),
    ).toMatchObject({
      status: "reserved",
      transaction: {
        id: pending.reservationId,
        kind: "reservation",
        status: "pending-confirmation",
      },
    });
    expect((await journey(session)).groups.future).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reservationId: pending.reservationId }),
      ]),
    );

    await simulatePayment(session, pending.reservationId);
    expect(
      (await membership(session)).coupons.find(
        (item) => item.id === coupon!.id,
      ),
    ).toMatchObject({ status: "redeemed" });

    session = await switchRole(session, "staff");
    apiWallTime = new Date("2026-08-10T12:30:00.000Z");
    expect(
      await staffCommand(session, pending.reservationId, { action: "arrive" }),
    ).toMatchObject({ status: 200 });
    apiWallTime = new Date("2026-08-10T13:00:00.000Z");
    expect(
      await staffCommand(session, pending.reservationId, {
        action: "start-use",
      }),
    ).toMatchObject({ status: 200 });
    apiWallTime = new Date("2026-08-10T13:01:00.000Z");
    const key = crypto.randomUUID();
    const completed = await staffCommand(
      session,
      pending.reservationId,
      { action: "complete-early", reason: "顾客主动提前结束" },
      key,
    );
    expect(completed.status).toBe(200);
    const replay = await staffCommand(
      session,
      pending.reservationId,
      { action: "complete-early", reason: "顾客主动提前结束" },
      key,
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });

    session = await switchRole(session, "customer");
    const after = await membership(session);
    expect(after.profile.growthPoints).toBe(890);
    expect(
      after.growthEvents.filter(
        (event) => event.source.id === pending.reservationId,
      ),
    ).toEqual([
      expect.objectContaining({
        finalSimulatedAmountCents: 3_000,
        growthPoints: 30,
      }),
    ]);
    expect((await journey(session)).groups.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          growthAward: { growthPoints: 30 },
          reservationId: pending.reservationId,
          status: "completed",
        }),
      ]),
    );
  });

  it("restores an expired hold coupon without awarding growth", async () => {
    const session = await createRoleSession("customer");
    const before = await membership(session);
    const coupon = before.coupons.find(
      (item) =>
        item.businessKind === "reservation" && item.status === "available",
    )!;
    const pending = await createReservation(session, coupon.id, "immediate");

    expect((await journey(session)).groups.current).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reservationId: pending.reservationId,
          status: "pending-confirmation",
        }),
      ]),
    );

    apiWallTime = new Date(pending.holdExpiresAt);
    const after = await membership(session);
    expect(after.profile.growthPoints).toBe(860);
    expect(after.coupons.find((item) => item.id === coupon.id)).toMatchObject({
      status: "available",
      transaction: null,
    });
    expect((await journey(session)).groups.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          growthAward: null,
          reservationId: pending.reservationId,
          status: "expired",
        }),
      ]),
    );
  });

  it("rejects role, query and cross-sandbox object enumeration", async () => {
    const first = await createRoleSession("customer");
    const firstHistory = (await journey(first)).groups.history[0]!;
    const second = await createRoleSession("customer");

    const crossSandbox = await app.request(
      `/api/v1/customer/reservations/${firstHistory.reservationId}`,
      { headers: { Cookie: second.cookie } },
    );
    expect(crossSandbox.status).toBe(404);
    const customerQuery = await app.request(
      "/api/v1/customer/membership?customerId=another-customer",
      { headers: { Cookie: first.cookie } },
    );
    expect(customerQuery.status).toBe(400);
    const sandboxQuery = await app.request(
      "/api/v1/customer/journey?sandboxId=another-sandbox",
      { headers: { Cookie: first.cookie } },
    );
    expect(sandboxQuery.status).toBe(400);

    const staff = await createRoleSession("staff");
    const forbidden = await app.request("/api/v1/customer/membership", {
      headers: { Cookie: staff.cookie },
    });
    expect(forbidden.status).toBe(403);
  });
});
