import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type {
  DemoStoryResponse,
  RoleContextReadyResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";
import { readRoleSession } from "./role-session.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const publicOrigin = "https://arena.example";
const sessionSecret = "ticket-29-demo-story-integration-secret-32-bytes";
const fixedTime = new Date("2026-08-12T11:30:00.000Z");
let apiWallTime = fixedTime;
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => apiWallTime },
});
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  secureCookies: true,
  sessionSecret,
  wallClock: { now: () => apiWallTime },
});

beforeAll(async () => migrateEmptyDatabase(databaseUrl));
beforeEach(() => {
  apiWallTime = fixedTime;
});
afterAll(async () => database.close());

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`))
    throw new Error(`Expected ${name} cookie.`);
  return pair;
}

interface RoleSession {
  readonly context: RoleContextReadyResponse;
  readonly cookie: string;
  readonly sandboxId: string;
  readonly visitorCookie: string;
}

function writeHeaders(session: RoleSession) {
  return {
    "Content-Type": "application/json",
    Cookie: `${session.cookie}; ${session.visitorCookie}`,
    "Idempotency-Key": crypto.randomUUID(),
    Origin: publicOrigin,
    "X-CSRF-Token": session.context.csrfToken,
  };
}

async function createCustomerSession(): Promise<RoleSession> {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie = cookiePair(visitor, "jingshu_visitor");
  const created = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role: "customer" }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: publicOrigin,
    },
    method: "POST",
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const cookie = cookiePair(created, "jingshu_session");
  const contextResponse = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  expect(contextResponse.status).toBe(200);
  const context = (await contextResponse.json()) as RoleContextReadyResponse;
  const token = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  const signed = readRoleSession(token, sessionSecret, apiWallTime.getTime());
  if (!signed) throw new Error("Expected signed role session.");
  return { context, cookie, sandboxId: signed.sandboxId, visitorCookie };
}

async function switchRole(
  session: RoleSession,
  targetRole: "customer" | "hq" | "manager" | "staff",
): Promise<RoleSession> {
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
  expect(switched.status, await switched.clone().text()).toBe(200);
  const cookie = cookiePair(switched, "jingshu_session");
  const context = (await switched.json()) as RoleContextReadyResponse;
  return { ...session, context, cookie };
}

async function readStory(session: RoleSession) {
  const response = await app.request("/api/v1/demo/story", {
    headers: { Cookie: session.cookie },
  });
  expect(response.status, await response.clone().text()).toBe(200);
  return (await response.json()) as DemoStoryResponse;
}

describe("主演示业务证据 API", () => {
  it("recognizes an immediate reservation that starts in the next still-arrivable half-hour", async () => {
    apiWallTime = new Date("2026-08-12T11:47:23.000Z");
    const session = await createCustomerSession();
    const availability = await app.request(
      "/api/v1/customer/seat-availability?store=prism-flagship&area=competitive-a&machine=competitive&durationHours=2&mode=immediate",
      { headers: { Cookie: session.cookie } },
    );
    expect(availability.status, await availability.clone().text()).toBe(200);
    const booking = (await availability.json()) as {
      coupons: Array<{
        eligibility: { status: "eligible" | "ineligible" };
        id: string;
      }>;
      seats: Array<{ availability: string; code: string }>;
      window: { startsAt: string };
    };
    expect(booking.window.startsAt).toBe("2026-08-12T12:00:00.000Z");
    const coupon = booking.coupons.find(
      (candidate) => candidate.eligibility.status === "eligible",
    );
    const seat = booking.seats.find(
      (candidate) => candidate.availability === "available",
    );
    expect(coupon).toBeDefined();
    expect(seat).toBeDefined();

    const created = await app.request("/api/v1/customer/reservations", {
      body: JSON.stringify({
        areaCode: "competitive-a",
        couponId: coupon!.id,
        durationHours: 2,
        machineProfileCode: "competitive",
        mode: "immediate",
        seatCode: seat!.code,
        storeCode: "prism-flagship",
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(created.status, await created.clone().text()).toBe(201);

    const story = await readStory(session);
    expect(story.completedCount).toBe(1);
    expect(story.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "reservation-created",
          state: "completed",
        }),
        expect.objectContaining({
          id: "reservation-paid",
          state: "current",
        }),
      ]),
    );
  });

  it("derives the complete fresh-session story from live business records, then invalidates the old sandbox on reset", async () => {
    let session = await createCustomerSession();
    const before = await readStory(session);
    expect(before.completedCount).toBe(0);
    expect(before.resetAt).toBeNull();
    expect(before.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "reservation-created",
          state: "current",
        }),
        expect.objectContaining({
          id: "reservation-paid",
          state: "blocked",
        }),
      ]),
    );

    const availability = await app.request(
      "/api/v1/customer/seat-availability?store=prism-flagship&area=competitive-a&machine=competitive&durationHours=2&mode=immediate",
      { headers: { Cookie: session.cookie } },
    );
    expect(availability.status, await availability.clone().text()).toBe(200);
    const booking = (await availability.json()) as {
      coupons: Array<{
        eligibility: { status: "eligible" | "ineligible" };
        id: string;
      }>;
      seats: Array<{ availability: string; code: string }>;
    };
    const coupon = booking.coupons.find(
      (candidate) => candidate.eligibility.status === "eligible",
    );
    const seat = booking.seats.find(
      (candidate) => candidate.availability === "available",
    );
    expect(coupon).toBeDefined();
    expect(seat).toBeDefined();

    const reservationResponse = await app.request(
      "/api/v1/customer/reservations",
      {
        body: JSON.stringify({
          areaCode: "competitive-a",
          couponId: coupon!.id,
          durationHours: 2,
          machineProfileCode: "competitive",
          mode: "immediate",
          seatCode: seat!.code,
          storeCode: "prism-flagship",
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    expect(
      reservationResponse.status,
      await reservationResponse.clone().text(),
    ).toBe(201);
    const reservation = (await reservationResponse.json()) as {
      reservationId: string;
    };

    const paidReservation = await app.request(
      `/api/v1/customer/reservations/${reservation.reservationId}/simulated-payment`,
      { body: "{}", headers: writeHeaders(session), method: "POST" },
    );
    expect(paidReservation.status, await paidReservation.clone().text()).toBe(
      200,
    );

    session = await switchRole(session, "staff");
    for (const action of ["arrive", "start-use"] as const) {
      const command = await app.request(
        `/api/v1/staff/reservations/${reservation.reservationId}/commands`,
        {
          body: JSON.stringify({ action }),
          headers: writeHeaders(session),
          method: "POST",
        },
      );
      expect(command.status, await command.clone().text()).toBe(200);
    }

    session = await switchRole(session, "customer");
    const catalogResponse = await app.request(
      `/api/v1/customer/reservations/${reservation.reservationId}/products`,
      { headers: { Cookie: session.cookie } },
    );
    expect(catalogResponse.status, await catalogResponse.clone().text()).toBe(
      200,
    );
    const catalog = (await catalogResponse.json()) as {
      coupons: Array<{
        eligibility: { status: "eligible" | "ineligible" };
        id: string;
      }>;
      products: Array<{ id: string }>;
    };
    const orderCoupon = catalog.coupons.find(
      (candidate) => candidate.eligibility.status === "eligible",
    );
    expect(orderCoupon).toBeDefined();
    const orderResponse = await app.request("/api/v1/customer/orders", {
      body: JSON.stringify({
        couponId: orderCoupon!.id,
        lines: [{ productId: catalog.products[0]!.id, quantity: 2 }],
        reservationId: reservation.reservationId,
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(orderResponse.status, await orderResponse.clone().text()).toBe(201);
    const order = (await orderResponse.json()) as { orderId: string };
    const paidOrder = await app.request(
      `/api/v1/customer/orders/${order.orderId}/simulated-payment`,
      { body: "{}", headers: writeHeaders(session), method: "POST" },
    );
    expect(paidOrder.status, await paidOrder.clone().text()).toBe(200);

    session = await switchRole(session, "staff");
    const earlyAdvance = await app.request("/api/v1/demo/time/advance", {
      body: JSON.stringify({ mode: "half-hour" }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(earlyAdvance.status, await earlyAdvance.clone().text()).toBe(200);
    const fulfillOrder = await app.request(
      `/api/v1/staff/orders/${order.orderId}/commands`,
      {
        body: JSON.stringify({ action: "start-preparing" }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    expect(fulfillOrder.status, await fulfillOrder.clone().text()).toBe(200);

    const storyBeforeStoryAdvance = await readStory(session);
    expect(storyBeforeStoryAdvance.completedCount).toBe(6);
    expect(storyBeforeStoryAdvance.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "business-time-advanced",
          state: "current",
        }),
      ]),
    );

    const advance = await app.request("/api/v1/demo/time/advance", {
      body: JSON.stringify({ mode: "half-hour" }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(advance.status, await advance.clone().text()).toBe(200);

    session = await switchRole(session, "customer");
    const repairResponse = await app.request("/api/v1/customer/repairs", {
      body: JSON.stringify({
        description: "耳机右声道无声",
        reservationId: reservation.reservationId,
      }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(repairResponse.status, await repairResponse.clone().text()).toBe(
      201,
    );
    const repair = (await repairResponse.json()) as { repairId: string };

    session = await switchRole(session, "staff");
    const intakeResponse = await app.request("/api/v1/staff/repair-intake", {
      headers: { Cookie: session.cookie },
    });
    expect(intakeResponse.status, await intakeResponse.clone().text()).toBe(
      200,
    );
    const intake = (await intakeResponse.json()) as {
      handlers: Array<{ displayName: string; personaId: string }>;
    };
    const staffHandler = intake.handlers.find(
      (handler) => handler.displayName === session.context.persona.displayName,
    );
    expect(staffHandler).toBeDefined();
    const assign = await app.request(
      `/api/v1/staff/repairs/${repair.repairId}/assign`,
      {
        body: JSON.stringify({
          assigneePersonaId: staffHandler!.personaId,
          internalNote: "复现右声道无声，检查耳机与接口。",
          priority: "high",
          publicNote: "门店已安排处理人。",
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    expect(assign.status, await assign.clone().text()).toBe(200);
    const start = await app.request(
      `/api/v1/staff/repairs/${repair.repairId}/start`,
      {
        body: JSON.stringify({
          internalNote: "已进入维护并开始检修。",
          publicNote: "设备已进入检修。",
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    expect(start.status, await start.clone().text()).toBe(200);

    const repairDetailResponse = await app.request(
      `/api/v1/repairs/${repair.repairId}`,
      { headers: { Cookie: session.cookie } },
    );
    expect(
      repairDetailResponse.status,
      await repairDetailResponse.clone().text(),
    ).toBe(200);
    const repairDetail = (await repairDetailResponse.json()) as {
      spares: {
        available: Array<{ displayName: string; inventoryItemId: string }>;
      };
    };
    const replacement = repairDetail.spares.available.find(
      (spare) => spare.displayName === "无品牌替换耳机",
    );
    expect(replacement).toBeDefined();
    const claim = await app.request(
      `/api/v1/staff/repairs/${repair.repairId}/spares/claim`,
      {
        body: JSON.stringify({
          inventoryItemId: replacement!.inventoryItemId,
          quantity: 1,
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    expect(claim.status, await claim.clone().text()).toBe(200);
    const resolution = await app.request(
      `/api/v1/staff/repairs/${repair.repairId}/resolution`,
      {
        body: JSON.stringify({
          resolutionNote: "已更换无品牌替换耳机并完成左右声道试听。",
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    expect(resolution.status, await resolution.clone().text()).toBe(200);

    session = await switchRole(session, "manager");
    const verify = await app.request(
      `/api/v1/staff/repairs/${repair.repairId}/verification`,
      {
        body: JSON.stringify({
          outcome: "success",
          reason: "店长独立复核通过，座位恢复可用。",
        }),
        headers: writeHeaders(session),
        method: "POST",
      },
    );
    expect(verify.status, await verify.clone().text()).toBe(200);

    const managerDashboard = await app.request("/api/v1/manager/dashboard", {
      headers: { Cookie: session.cookie },
    });
    expect(managerDashboard.status, await managerDashboard.clone().text()).toBe(
      200,
    );
    const managerAudits = await app.request(
      "/api/v1/manager/audits?action=repair.verify-success",
      { headers: { Cookie: session.cookie } },
    );
    expect(managerAudits.status, await managerAudits.clone().text()).toBe(200);
    await expect(managerAudits.json()).resolves.toMatchObject({
      events: [expect.objectContaining({ objectId: repair.repairId })],
    });

    session = await switchRole(session, "hq");
    const dashboard = await app.request("/api/v1/hq/dashboard", {
      headers: { Cookie: session.cookie },
    });
    expect(dashboard.status, await dashboard.clone().text()).toBe(200);
    const chain = (await dashboard.json()) as {
      stores: Array<{ store: { storeId: string } }>;
    };
    const exportResponse = await app.request("/api/v1/hq/exports", {
      body: JSON.stringify({
        dataType: "reservations",
        filters: {},
        fromBusinessDay: "2026-07-30",
        sort: { direction: "asc", field: "businessOccurredAt" },
        storeIds: chain.stores.map((store) => store.store.storeId),
        toBusinessDay: "2026-08-12",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
        Origin: publicOrigin,
        "X-CSRF-Token": session.context.csrfToken,
      },
      method: "POST",
    });
    expect(exportResponse.status, await exportResponse.clone().text()).toBe(
      200,
    );
    const csv = new TextDecoder().decode(await exportResponse.arrayBuffer());
    expect(csv.split("\r\n", 1)[0]).toMatch(/^门店代码,门店,/u);
    expect(csv).toContain("prism-flagship");
    expect(csv).toContain(reservation.reservationId);
    expect(exportResponse.headers.get("X-Export-Row-Count")).toEqual(
      expect.any(String),
    );

    const exportAudits = await app.request(
      "/api/v1/hq/audits?action=export.csv",
      { headers: { Cookie: session.cookie } },
    );
    expect(exportAudits.status, await exportAudits.clone().text()).toBe(200);
    const exportEvidence = (await exportAudits.json()) as {
      events: Array<{ store: { code: string } | null }>;
    };
    expect(exportEvidence.events.map((event) => event.store?.code)).toEqual(
      expect.arrayContaining([
        "prism-flagship",
        "starbridge-standard",
        "apex-new",
      ]),
    );

    const complete = await readStory(session);
    expect(complete.completedCount).toBe(11);
    expect(complete.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "repair-resolved", state: "completed" }),
        expect.objectContaining({ id: "repair-verified", state: "completed" }),
        expect.objectContaining({
          id: "headquarters-exported",
          state: "completed",
        }),
        expect.objectContaining({ id: "sandbox-reset", state: "current" }),
      ]),
    );
    expect(
      complete.steps.find((step) => step.id === "repair-verified"),
    ).toEqual(
      expect.objectContaining({
        evidence: [expect.objectContaining({ kind: "business-event" })],
      }),
    );

    const oldCookie = session.cookie;
    const reset = await app.request("/api/v1/demo/reset", {
      body: JSON.stringify({ confirm: true }),
      headers: writeHeaders(session),
      method: "POST",
    });
    expect(reset.status, await reset.clone().text()).toBe(201);
    const resetBody = (await reset.json()) as {
      context: RoleContextReadyResponse;
    };
    const resetCookie = cookiePair(reset, "jingshu_session");
    const resetSession: RoleSession = {
      ...session,
      context: resetBody.context,
      cookie: resetCookie,
    };

    const oldSandboxRead = await app.request("/api/v1/hq/dashboard", {
      headers: { Cookie: oldCookie },
    });
    expect(oldSandboxRead.status).toBe(410);

    const resetStory = await readStory(resetSession);
    expect(resetStory.completedCount).toBe(0);
    expect(resetStory.resetAt).toEqual(expect.any(String));
    expect(resetStory.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "reservation-created",
          state: "current",
        }),
      ]),
    );
    const oldObject = await app.request(
      `/api/v1/customer/reservations/${reservation.reservationId}`,
      { headers: { Cookie: resetSession.cookie } },
    );
    expect(oldObject.status).toBe(404);

    const restartedAvailability = await app.request(
      "/api/v1/customer/seat-availability?store=prism-flagship&area=competitive-a&machine=competitive&durationHours=2&mode=immediate",
      { headers: { Cookie: resetSession.cookie } },
    );
    expect(
      restartedAvailability.status,
      await restartedAvailability.clone().text(),
    ).toBe(200);
    const restartedBooking = (await restartedAvailability.json()) as {
      coupons: Array<{
        eligibility: { status: "eligible" | "ineligible" };
        id: string;
      }>;
      seats: Array<{ availability: string; code: string }>;
    };
    const restartedCoupon = restartedBooking.coupons.find(
      (candidate) => candidate.eligibility.status === "eligible",
    );
    const restartedSeat = restartedBooking.seats.find(
      (candidate) => candidate.availability === "available",
    );
    expect(restartedCoupon).toBeDefined();
    expect(restartedSeat).toBeDefined();
    const restartedReservation = await app.request(
      "/api/v1/customer/reservations",
      {
        body: JSON.stringify({
          areaCode: "competitive-a",
          couponId: restartedCoupon!.id,
          durationHours: 2,
          machineProfileCode: "competitive",
          mode: "immediate",
          seatCode: restartedSeat!.code,
          storeCode: "prism-flagship",
        }),
        headers: writeHeaders(resetSession),
        method: "POST",
      },
    );
    expect(
      restartedReservation.status,
      await restartedReservation.clone().text(),
    ).toBe(201);
    const restartedStory = await readStory(resetSession);
    expect(restartedStory.resetAt).toEqual(expect.any(String));
    expect(restartedStory.completedCount).toBe(1);
    expect(restartedStory.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "reservation-created",
          state: "completed",
        }),
      ]),
    );
  });
});
