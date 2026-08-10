import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

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

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
let wallTime = fixedTime;
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => wallTime },
});
const publicOrigin = "https://arena.example";
const sessionSecret = "ticket-11-integration-session-secret-32-bytes";
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  sessionSecret,
  secureCookies: true,
});
const { Client } = pg;

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

beforeEach(() => {
  wallTime = fixedTime;
});

afterAll(async () => {
  await database.close();
});

async function createCustomerContext() {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie =
    visitor.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
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
  expect(created.status).toBe(201);
  const cookie = created.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  const context = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  const body = (await context.json()) as { csrfToken: string };
  const token = decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
  const session = readRoleSession(token, sessionSecret);
  expect(session).not.toBeNull();
  return {
    cookie,
    csrfToken: body.csrfToken,
    sandboxId: session!.sandboxId,
  };
}

async function createArrivedReservation() {
  const context = await createCustomerContext();
  const created = await app.request("/api/v1/customer/reservations", {
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
  expect(created.status).toBe(201);
  const reservation = (await created.json()) as { reservationId: string };
  const paid = await app.request(
    `/api/v1/customer/reservations/${reservation.reservationId}/simulated-payment`,
    {
      body: "{}",
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
  expect(paid.status).toBe(200);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      context.sandboxId,
    ]);
    await client.query(
      `update reservations set status = 'arrived', arrived_business_at = $3
        where sandbox_id = $1 and id = $2`,
      [context.sandboxId, reservation.reservationId, fixedTime],
    );
    await client.query("commit");
  } finally {
    await client.end();
  }
  return { ...context, reservationId: reservation.reservationId };
}

function writeHeaders(context: { cookie: string; csrfToken: string }) {
  return {
    "Content-Type": "application/json",
    Cookie: context.cookie,
    "Idempotency-Key": crypto.randomUUID(),
    Origin: publicOrigin,
    "X-CSRF-Token": context.csrfToken,
  };
}

describe("customer order API", () => {
  it("exposes the arrived-reservation catalog and a CSRF-protected snapshot/payment flow", async () => {
    const context = await createArrivedReservation();
    const catalogResponse = await app.request(
      `/api/v1/customer/reservations/${context.reservationId}/products`,
      { headers: { Cookie: context.cookie } },
    );
    expect(catalogResponse.status).toBe(200);
    const catalog = (await catalogResponse.json()) as {
      coupons: Array<{ id: string }>;
      products: Array<{
        availableQuantity: number;
        id: string;
        name: string;
        unitPriceCents: number;
      }>;
    };
    expect(catalog).toMatchObject({ status: "ready" });
    expect(catalog.products[0]).toMatchObject({
      availableQuantity: 18,
      name: "脉冲气泡水",
      unitPriceCents: 800,
    });

    const createKey = crypto.randomUUID();
    const createBody = JSON.stringify({
      couponId: catalog.coupons[0]!.id,
      lines: [{ productId: catalog.products[0]!.id, quantity: 2 }],
      reservationId: context.reservationId,
    });
    const created = await app.request("/api/v1/customer/orders", {
      body: createBody,
      headers: { ...writeHeaders(context), "Idempotency-Key": createKey },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const order = (await created.json()) as {
      orderId: string;
      snapshot: { payableCents: number };
    };
    expect(order).toMatchObject({
      status: "pending-simulated-payment",
      snapshot: { discountCents: 500, payableCents: 1_100 },
    });
    const replay = await app.request("/api/v1/customer/orders", {
      body: createBody,
      headers: { ...writeHeaders(context), "Idempotency-Key": createKey },
      method: "POST",
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      orderId: order.orderId,
      replayed: true,
    });

    const detail = await app.request(
      `/api/v1/customer/orders/${order.orderId}`,
      {
        headers: { Cookie: context.cookie },
      },
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      actions: { canCancel: true, canSimulatePayment: true },
      status: "pending-simulated-payment",
    });

    const paid = await app.request(
      `/api/v1/customer/orders/${order.orderId}/simulated-payment`,
      {
        body: "{}",
        headers: writeHeaders(context),
        method: "POST",
      },
    );
    expect(paid.status).toBe(200);
    await expect(paid.json()).resolves.toMatchObject({
      payment: {
        amountCents: order.snapshot.payableCents,
        doesNotCharge: true,
        simulated: true,
      },
      status: "simulated-paid",
    });

    const otherCustomer = await createCustomerContext();
    const foreignDetail = await app.request(
      `/api/v1/customer/orders/${order.orderId}`,
      { headers: { Cookie: otherCustomer.cookie } },
    );
    expect(foreignDetail.status).toBe(404);
    await expect(foreignDetail.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_ORDER_NOT_FOUND" },
    });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role jingshu_runtime");
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        context.sandboxId,
      ]);
      await client.query(
        `update reservations set status = 'confirmed'
          where sandbox_id = $1 and id = $2`,
        [context.sandboxId, context.reservationId],
      );
      await client.query("commit");
    } finally {
      await client.end();
    }
    const ineligibleCatalog = await app.request(
      `/api/v1/customer/reservations/${context.reservationId}/products`,
      { headers: { Cookie: context.cookie } },
    );
    expect(ineligibleCatalog.status).toBe(409);
    await expect(ineligibleCatalog.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_ORDER_RESERVATION_INELIGIBLE" },
    });
  });

  it("maps whole-cart shortage and malformed write fences without leaking partial success", async () => {
    const context = await createArrivedReservation();
    const catalogResponse = await app.request(
      `/api/v1/customer/reservations/${context.reservationId}/products`,
      { headers: { Cookie: context.cookie } },
    );
    const catalog = (await catalogResponse.json()) as {
      products: Array<{ availableQuantity: number; id: string }>;
    };
    const low = catalog.products.find(
      (product) => product.availableQuantity === 3,
    )!;
    const shortage = await app.request("/api/v1/customer/orders", {
      body: JSON.stringify({
        couponId: null,
        lines: [{ productId: low.id, quantity: 4 }],
        reservationId: context.reservationId,
      }),
      headers: writeHeaders(context),
      method: "POST",
    });
    expect(shortage.status).toBe(409);
    await expect(shortage.json()).resolves.toMatchObject({
      error: { code: "CUSTOMER_ORDER_INSUFFICIENT_INVENTORY" },
    });

    const forged = await app.request("/api/v1/customer/orders", {
      body: JSON.stringify({
        couponId: null,
        lines: [{ productId: low.id, quantity: 1 }],
        reservationId: context.reservationId,
      }),
      headers: {
        ...writeHeaders(context),
        "X-CSRF-Token": "forged",
      },
      method: "POST",
    });
    expect(forged.status).toBe(409);
    await expect(forged.json()).resolves.toMatchObject({
      error: { code: "ROLE_CONTEXT_STALE" },
    });
  });
});
