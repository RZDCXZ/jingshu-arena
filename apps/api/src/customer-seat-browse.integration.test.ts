import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
  sessionSecret: "ticket-06-integration-session-secret-32-bytes",
  secureCookies: true,
  wallClock: { now: () => apiWallTime },
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

async function createRoleSession(role: "customer" | "staff") {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie =
    visitor.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  const response = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: publicOrigin,
    },
    method: "POST",
  });
  expect(response.status).toBe(201);
  return response.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function createCustomerWriteContext() {
  const cookie = await createRoleSession("customer");
  const response = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  const context = (await response.json()) as { csrfToken: string };
  return { cookie, csrfToken: context.csrfToken };
}

async function createPendingReservation(
  context: Awaited<ReturnType<typeof createCustomerWriteContext>>,
) {
  const response = await app.request("/api/v1/customer/reservations", {
    body: JSON.stringify({
      areaCode: "competitive-a",
      couponId: null,
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: "2026-08-10T12:30:00.000Z",
      seatCode: "A-08",
      storeCode: "prism-flagship",
    }),
    headers: {
      "Content-Type": "application/json",
      Cookie: context.cookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: publicOrigin,
      "X-CSRF-Token": context.csrfToken,
    },
    method: "POST",
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    holdExpiresAt: string;
    reservationId: string;
    snapshot: { price: { payableCents: number } };
  };
}

describe("customer store and seat browsing API", () => {
  it("returns the exact three-store catalog and a derived immediate seat/price preview", async () => {
    const cookie = await createRoleSession("customer");
    const catalog = await app.request("/api/v1/customer/stores", {
      headers: { Cookie: cookie },
    });
    expect(catalog.status).toBe(200);
    await expect(catalog.json()).resolves.toMatchObject({
      status: "ready",
      city: "栖光市",
      currentTime: fixedBusinessTime.toISOString(),
      bookingRules: {
        durationHours: { maximum: 8, minimum: 1 },
        futureDays: 7,
        halfHourAligned: true,
        immediateUsesCurrentSegment: true,
      },
      stores: [
        {
          code: "prism-flagship",
          displayName: "棱镜旗舰店",
          seatCount: 96,
          businessHours: "24 小时",
          areas: expect.arrayContaining([
            { code: "competitive-a", displayName: "竞技区 A", seatCount: 24 },
          ]),
          machineProfiles: [
            expect.objectContaining({ code: "standard", seatCount: 40 }),
            expect.objectContaining({ code: "competitive", seatCount: 40 }),
            expect.objectContaining({ code: "flagship", seatCount: 16 }),
          ],
        },
        expect.objectContaining({ displayName: "星桥标准店", seatCount: 64 }),
        expect.objectContaining({ displayName: "极点新店", seatCount: 40 }),
      ],
    });

    const query = new URLSearchParams({
      area: "competitive-a",
      durationHours: "2",
      machine: "competitive",
      mode: "immediate",
      store: "prism-flagship",
    });
    const availability = await app.request(
      `/api/v1/customer/seat-availability?${query.toString()}`,
      { headers: { Cookie: cookie } },
    );
    expect(availability.status).toBe(200);
    await expect(availability.json()).resolves.toMatchObject({
      status: "ready",
      window: {
        startsAt: "2026-08-10T11:30:00.000Z",
        endsAt: "2026-08-10T13:30:00.000Z",
        mode: "immediate",
      },
      seats: expect.arrayContaining([
        expect.objectContaining({ availability: "available" }),
        expect.objectContaining({ availability: "reserved" }),
        expect.objectContaining({ availability: "in-use" }),
        expect.objectContaining({ availability: "maintenance" }),
      ]),
      price: {
        baseHourlyCents: 1_500,
        totalCents: 3_600,
        segments: [
          expect.objectContaining({
            amountCents: 900,
            rule: "weekday-evening",
          }),
          expect.objectContaining({
            amountCents: 900,
            rule: "weekday-evening",
          }),
          expect.objectContaining({
            amountCents: 900,
            rule: "weekday-evening",
          }),
          expect.objectContaining({
            amountCents: 900,
            rule: "weekday-evening",
          }),
        ],
      },
    });
  });

  it("rejects invalid booking boundaries and non-customer role contexts", async () => {
    const customerCookie = await createRoleSession("customer");
    const invalidQuery = new URLSearchParams({
      area: "competitive-a",
      durationHours: "2",
      machine: "competitive",
      mode: "future",
      start: "2026-08-10T12:15:00.000Z",
      store: "prism-flagship",
    });
    const invalid = await app.request(
      `/api/v1/customer/seat-availability?${invalidQuery.toString()}`,
      { headers: { Cookie: customerCookie } },
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_BOOKING_HALF_HOUR_ALIGNMENT" },
    });

    const staffCookie = await createRoleSession("staff");
    const forbidden = await app.request("/api/v1/customer/stores", {
      headers: { Cookie: staffCookie },
    });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_ROLE_REQUIRED" },
    });
  });

  it("prices a future weekend window across midnight inside store hours", async () => {
    const cookie = await createRoleSession("customer");
    const query = new URLSearchParams({
      area: "competitive-lane",
      durationHours: "2",
      machine: "competitive",
      mode: "future",
      start: "2026-08-15T15:30:00.000Z",
      store: "starbridge-standard",
    });
    const response = await app.request(
      `/api/v1/customer/seat-availability?${query.toString()}`,
      { headers: { Cookie: cookie } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      price: {
        baseHourlyCents: 1_200,
        segments: [
          { amountCents: 690, rule: "weekend" },
          { amountCents: 690, rule: "weekend" },
          { amountCents: 690, rule: "weekend" },
          { amountCents: 690, rule: "weekend" },
        ],
        totalCents: 2_760,
      },
      window: {
        endsAt: "2026-08-15T17:30:00.000Z",
        mode: "future",
        startsAt: "2026-08-15T15:30:00.000Z",
      },
    });
  });

  it("creates and safely replays a CSRF-protected pending reservation snapshot", async () => {
    const cookie = await createRoleSession("customer");
    const context = await app.request("/api/v1/demo/context", {
      headers: { Cookie: cookie },
    });
    const role = (await context.json()) as { csrfToken: string };
    const query = new URLSearchParams({
      area: "competitive-a",
      durationHours: "2",
      machine: "competitive",
      mode: "immediate",
      store: "prism-flagship",
    });
    const previewResponse = await app.request(
      `/api/v1/customer/seat-availability?${query.toString()}`,
      { headers: { Cookie: cookie } },
    );
    const preview = (await previewResponse.json()) as {
      coupons: Array<{ eligibility: { status: string }; id: string }>;
    };
    const coupon = preview.coupons.find(
      (item) => item.eligibility.status === "eligible",
    );
    expect(coupon).toBeDefined();
    const key = crypto.randomUUID();
    const body = {
      areaCode: "competitive-a",
      couponId: coupon?.id ?? null,
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "immediate",
      seatCode: "A-08",
      storeCode: "prism-flagship",
    };
    const headers = {
      "Content-Type": "application/json",
      Cookie: cookie,
      "Idempotency-Key": key,
      Origin: publicOrigin,
      "X-CSRF-Token": role.csrfToken,
    };
    const first = await app.request("/api/v1/customer/reservations", {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    });
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({
      replayed: false,
      status: "pending-confirmation",
      snapshot: {
        coupon: { code: "reservation-six", discountCents: 600 },
        price: { discountCents: 600 },
        seat: { code: "A-08" },
        store: { code: "prism-flagship" },
      },
    });
    const retry = await app.request("/api/v1/customer/reservations", {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toEqual({
      ...(firstBody as object),
      replayed: true,
    });
    const mismatched = await app.request("/api/v1/customer/reservations", {
      body: JSON.stringify({ ...body, couponId: null }),
      headers,
      method: "POST",
    });
    expect(mismatched.status).toBe(409);
    await expect(mismatched.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_RESERVATION_IDEMPOTENCY_CONFLICT" },
    });
  });

  it("reads, pays and cancels a reservation through one immutable lifecycle timeline", async () => {
    const context = await createCustomerWriteContext();
    const pending = await createPendingReservation(context);
    const pendingDetail = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}`,
      { headers: { Cookie: context.cookie } },
    );
    expect(pendingDetail.status).toBe(200);
    await expect(pendingDetail.json()).resolves.toMatchObject({
      actions: { canCancel: true, canSimulatePayment: true },
      currentTime: fixedBusinessTime.toISOString(),
      reservationId: pending.reservationId,
      status: "pending-confirmation",
      timeline: [
        expect.objectContaining({ type: "reservation.pending-created" }),
      ],
    });

    const paymentKey = crypto.randomUUID();
    const paymentHeaders = {
      Cookie: context.cookie,
      "Idempotency-Key": paymentKey,
      Origin: publicOrigin,
      "X-CSRF-Token": context.csrfToken,
    };
    const paid = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}/simulated-payment`,
      { headers: paymentHeaders, method: "POST" },
    );
    expect(paid.status).toBe(200);
    const paidBody = await paid.json();
    expect(paidBody).toMatchObject({
      payment: {
        amountCents: pending.snapshot.price.payableCents,
        simulated: true,
      },
      replayed: false,
      status: "confirmed",
    });
    const replay = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}/simulated-payment`,
      { headers: paymentHeaders, method: "POST" },
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      ...(paidBody as object),
      replayed: true,
    });

    const cancelled = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}/cancel`,
      {
        body: JSON.stringify({ reason: "行程变更" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: context.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({
      refund: {
        amountCents: pending.snapshot.price.payableCents,
        simulated: true,
      },
      status: "cancelled",
    });
    const terminalDetail = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}`,
      { headers: { Cookie: context.cookie } },
    );
    await expect(terminalDetail.json()).resolves.toMatchObject({
      actions: { canCancel: false, canSimulatePayment: false },
      status: "cancelled",
      terminalReason: "行程变更",
      timeline: [
        expect.objectContaining({ type: "reservation.pending-created" }),
        expect.objectContaining({
          type: "reservation.simulated-payment-succeeded",
        }),
        expect.objectContaining({ type: "reservation.cancelled" }),
      ],
    });
  });

  it("returns the current state for an illegal payment after the exact hold boundary", async () => {
    const context = await createCustomerWriteContext();
    const pending = await createPendingReservation(context);
    apiWallTime = new Date(pending.holdExpiresAt);

    const response = await app.request(
      `/api/v1/customer/reservations/${pending.reservationId}/simulated-payment`,
      {
        headers: {
          Cookie: context.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": context.csrfToken,
        },
        method: "POST",
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "CUSTOMER_RESERVATION_ILLEGAL_TRANSITION",
        currentStatus: "expired",
      },
    });
  });

  it("rejects lifecycle writes without trusted origin, CSRF and valid payloads", async () => {
    const context = await createCustomerWriteContext();
    const pending = await createPendingReservation(context);
    const endpoint = `/api/v1/customer/reservations/${pending.reservationId}/cancel`;
    const withoutOrigin = await app.request(endpoint, {
      body: JSON.stringify({ reason: "行程变更" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: context.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        "X-CSRF-Token": context.csrfToken,
      },
      method: "POST",
    });
    expect(withoutOrigin.status).toBe(403);

    const invalidReason = await app.request(endpoint, {
      body: JSON.stringify({ reason: "" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: context.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        Origin: publicOrigin,
        "X-CSRF-Token": context.csrfToken,
      },
      method: "POST",
    });
    expect(invalidReason.status).toBe(400);
    await expect(invalidReason.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_RESERVATION_CANCEL_REQUEST_INVALID" },
    });
  });
});
