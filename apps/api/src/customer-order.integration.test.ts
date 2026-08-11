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
  wallClock: { now: () => wallTime },
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
  const session = readRoleSession(token, sessionSecret, wallTime.getTime());
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

async function switchRole(
  context: {
    cookie: string;
    csrfToken: string;
    sandboxId: string;
  },
  targetRole: "customer" | "staff",
) {
  const response = await app.request("/api/v1/demo/context/switch", {
    body: JSON.stringify({ targetRole }),
    headers: {
      "Content-Type": "application/json",
      Cookie: context.cookie,
      Origin: publicOrigin,
      "X-CSRF-Token": context.csrfToken,
    },
    method: "POST",
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { csrfToken: string };
  return {
    cookie: response.headers.get("set-cookie")?.split(";", 1)[0] ?? "",
    csrfToken: body.csrfToken,
    sandboxId: context.sandboxId,
  };
}

describe("customer order API", () => {
  it("allows customer cancellation only before preparation and returns the full simulated amount", async () => {
    const context = await createArrivedReservation();
    const catalogResponse = await app.request(
      `/api/v1/customer/reservations/${context.reservationId}/products`,
      { headers: { Cookie: context.cookie } },
    );
    const catalog = (await catalogResponse.json()) as {
      coupons: Array<{ id: string }>;
      products: Array<{ id: string }>;
    };
    const createPaid = async (couponId: string | null) => {
      const created = await app.request("/api/v1/customer/orders", {
        body: JSON.stringify({
          couponId,
          lines: [
            {
              productId: catalog.products[0]!.id,
              quantity: couponId ? 2 : 1,
            },
          ],
          reservationId: context.reservationId,
        }),
        headers: writeHeaders(context),
        method: "POST",
      });
      expect(created.status).toBe(201);
      const order = (await created.json()) as {
        orderId: string;
        snapshot: { payableCents: number };
      };
      const paid = await app.request(
        `/api/v1/customer/orders/${order.orderId}/simulated-payment`,
        { body: "{}", headers: writeHeaders(context), method: "POST" },
      );
      expect(paid.status).toBe(200);
      return order;
    };
    const cancellable = await createPaid(catalog.coupons[0]!.id);
    const futurePreparing = await createPaid(null);

    const cancelled = await app.request(
      `/api/v1/customer/orders/${cancellable.orderId}/cancel`,
      {
        body: JSON.stringify({ reason: "顾客在制作前改变计划" }),
        headers: writeHeaders(context),
        method: "POST",
      },
    );
    expect(cancelled.status).toBe(200);
    await expect(cancelled.json()).resolves.toMatchObject({
      couponRestored: true,
      refund: {
        amountCents: cancellable.snapshot.payableCents,
        simulated: true,
      },
      status: "cancelled",
    });

    const staff = await switchRole(context, "staff");
    const preparing = await app.request(
      `/api/v1/staff/orders/${futurePreparing.orderId}/commands`,
      {
        body: JSON.stringify({ action: "start-preparing" }),
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(preparing.status).toBe(200);
    const customer = await switchRole(staff, "customer");
    const tooLate = await app.request(
      `/api/v1/customer/orders/${futurePreparing.orderId}/cancel`,
      {
        body: JSON.stringify({ reason: "制作后不应允许顾客取消" }),
        headers: writeHeaders(customer),
        method: "POST",
      },
    );
    expect(tooLate.status).toBe(409);
    await expect(tooLate.json()).resolves.toMatchObject({
      error: {
        code: "CUSTOMER_ORDER_ILLEGAL_TRANSITION",
        currentStatus: "preparing",
      },
    });
  });

  it("makes staff cancellation release before preparation and consume waste after preparation", async () => {
    const context = await createArrivedReservation();
    const catalogResponse = await app.request(
      `/api/v1/customer/reservations/${context.reservationId}/products`,
      { headers: { Cookie: context.cookie } },
    );
    const catalog = (await catalogResponse.json()) as {
      coupons: Array<{ id: string }>;
      products: Array<{ id: string; onHandQuantity: number }>;
    };
    const createPaid = async (couponId: string | null, quantity: number) => {
      const created = await app.request("/api/v1/customer/orders", {
        body: JSON.stringify({
          couponId,
          lines: [{ productId: catalog.products[0]!.id, quantity }],
          reservationId: context.reservationId,
        }),
        headers: writeHeaders(context),
        method: "POST",
      });
      expect(created.status).toBe(201);
      const order = (await created.json()) as {
        orderId: string;
        snapshot: { payableCents: number };
      };
      const paid = await app.request(
        `/api/v1/customer/orders/${order.orderId}/simulated-payment`,
        { body: "{}", headers: writeHeaders(context), method: "POST" },
      );
      expect(paid.status).toBe(200);
      return order;
    };
    const beforeProduction = await createPaid(catalog.coupons[0]!.id, 2);
    const afterProduction = await createPaid(null, 1);
    const staff = await switchRole(context, "staff");

    const cancellationKey = crypto.randomUUID();
    const cancellationBody = JSON.stringify({
      action: "cancel",
      reason: "顾客临时离店，尚未开始制作",
    });
    const cancelledBefore = await app.request(
      `/api/v1/staff/orders/${beforeProduction.orderId}/commands`,
      {
        body: cancellationBody,
        headers: {
          ...writeHeaders(staff),
          "Idempotency-Key": cancellationKey,
        },
        method: "POST",
      },
    );
    expect(cancelledBefore.status).toBe(200);
    await expect(cancelledBefore.json()).resolves.toMatchObject({
      couponRestored: true,
      inventoryEffect: "release",
      simulatedRefundCents: beforeProduction.snapshot.payableCents,
      status: "cancelled",
    });
    const replay = await app.request(
      `/api/v1/staff/orders/${beforeProduction.orderId}/commands`,
      {
        body: cancellationBody,
        headers: {
          ...writeHeaders(staff),
          "Idempotency-Key": cancellationKey,
        },
        method: "POST",
      },
    );
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });
    const repeated = await app.request(
      `/api/v1/staff/orders/${beforeProduction.orderId}/commands`,
      {
        body: cancellationBody,
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(repeated.status).toBe(409);

    const preparing = await app.request(
      `/api/v1/staff/orders/${afterProduction.orderId}/commands`,
      {
        body: JSON.stringify({ action: "start-preparing" }),
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(preparing.status).toBe(200);
    const cancelledAfter = await app.request(
      `/api/v1/staff/orders/${afterProduction.orderId}/commands`,
      {
        body: JSON.stringify({
          action: "cancel",
          reason: "制作后顾客离店，按订单损耗处理",
        }),
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(cancelledAfter.status).toBe(200);
    await expect(cancelledAfter.json()).resolves.toMatchObject({
      couponRestored: false,
      inventoryEffect: "waste",
      simulatedRefundCents: afterProduction.snapshot.payableCents,
      status: "cancelled",
    });
    const detailResponse = await app.request(
      `/api/v1/staff/orders/${afterProduction.orderId}`,
      { headers: { Cookie: staff.cookie } },
    );
    expect(detailResponse.status).toBe(200);
    await expect(detailResponse.json()).resolves.toMatchObject({
      actions: { canCancel: false, primary: null },
      inventory: [{ reservationStatus: "wasted" }],
      refund: {
        amountCents: afterProduction.snapshot.payableCents,
        simulated: true,
      },
      timeline: expect.arrayContaining([
        expect.objectContaining({ type: "order.pending-created" }),
        expect.objectContaining({ type: "order.preparing" }),
        expect.objectContaining({ type: "order.cancelled" }),
      ]),
    });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role jingshu_runtime");
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        context.sandboxId,
      ]);
      const holds = await client.query(
        `select hold.order_id, hold.status, refund.amount_cents,
                movement.reason as movement_reason, movement.on_hand_delta,
                item.on_hand_quantity, item.reserved_quantity
           from order_inventory_reservations hold
           join inventory_items item on item.id = hold.inventory_item_id
           left join order_simulated_refunds refund on refund.order_id = hold.order_id
           left join inventory_movements movement on movement.order_id = hold.order_id
          where hold.sandbox_id = $1 and hold.order_id = any($2::uuid[])
          order by hold.order_id`,
        [
          context.sandboxId,
          [beforeProduction.orderId, afterProduction.orderId],
        ],
      );
      expect(holds.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            amount_cents: beforeProduction.snapshot.payableCents,
            movement_reason: null,
            order_id: beforeProduction.orderId,
            status: "released",
          }),
          expect.objectContaining({
            amount_cents: afterProduction.snapshot.payableCents,
            movement_reason: "order-waste",
            on_hand_delta: -1,
            on_hand_quantity: catalog.products[0]!.onHandQuantity - 1,
            order_id: afterProduction.orderId,
            reserved_quantity: 0,
            status: "wasted",
          }),
        ]),
      );
      await client.query("commit");
    } finally {
      await client.end();
    }
  });

  it("keeps a paid order in the normal counter queue after an equipment-fault reservation ending", async () => {
    const context = await createArrivedReservation();
    const catalogResponse = await app.request(
      `/api/v1/customer/reservations/${context.reservationId}/products`,
      { headers: { Cookie: context.cookie } },
    );
    const catalog = (await catalogResponse.json()) as {
      products: Array<{ id: string }>;
    };
    const created = await app.request("/api/v1/customer/orders", {
      body: JSON.stringify({
        couponId: null,
        lines: [{ productId: catalog.products[0]!.id, quantity: 1 }],
        reservationId: context.reservationId,
      }),
      headers: writeHeaders(context),
      method: "POST",
    });
    const order = (await created.json()) as { orderId: string };
    const paid = await app.request(
      `/api/v1/customer/orders/${order.orderId}/simulated-payment`,
      { body: "{}", headers: writeHeaders(context), method: "POST" },
    );
    expect(paid.status).toBe(200);
    const staff = await switchRole(context, "staff");
    wallTime = new Date("2026-08-10T12:30:00.000Z");
    const started = await app.request(
      `/api/v1/staff/reservations/${context.reservationId}/commands`,
      {
        body: JSON.stringify({ action: "start-use" }),
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(started.status).toBe(200);
    const ended = await app.request(
      `/api/v1/staff/reservations/${context.reservationId}/commands`,
      {
        body: JSON.stringify({
          action: "complete-early",
          reason: "设备故障，提前结束预约",
        }),
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(ended.status).toBe(200);

    const queue = await app.request(
      "/api/v1/staff/orders?stage=simulated-paid",
      { headers: { Cookie: staff.cookie } },
    );
    expect(queue.status).toBe(200);
    await expect(queue.json()).resolves.toMatchObject({
      rows: [
        {
          orderId: order.orderId,
          reservation: { status: "completed" },
          status: "simulated-paid",
        },
      ],
    });
  });

  it("lets staff read the paid queue and advance exactly one fulfillment stage", async () => {
    const context = await createArrivedReservation();
    const catalogResponse = await app.request(
      `/api/v1/customer/reservations/${context.reservationId}/products`,
      { headers: { Cookie: context.cookie } },
    );
    const catalog = (await catalogResponse.json()) as {
      coupons: Array<{ id: string }>;
      products: Array<{ id: string; onHandQuantity: number }>;
    };
    const created = await app.request("/api/v1/customer/orders", {
      body: JSON.stringify({
        couponId: catalog.coupons[0]!.id,
        lines: [{ productId: catalog.products[0]!.id, quantity: 2 }],
        reservationId: context.reservationId,
      }),
      headers: writeHeaders(context),
      method: "POST",
    });
    const order = (await created.json()) as { orderId: string };
    const paid = await app.request(
      `/api/v1/customer/orders/${order.orderId}/simulated-payment`,
      { body: "{}", headers: writeHeaders(context), method: "POST" },
    );
    expect(paid.status).toBe(200);

    const staff = await switchRole(context, "staff");
    const queueResponse = await app.request(
      "/api/v1/staff/orders?stage=simulated-paid",
      { headers: { Cookie: staff.cookie } },
    );
    expect(queueResponse.status).toBe(200);
    await expect(queueResponse.json()).resolves.toMatchObject({
      rows: [
        {
          orderId: order.orderId,
          reservation: { reservationId: context.reservationId },
          status: "simulated-paid",
        },
      ],
      status: "ready",
      store: { code: "prism-flagship" },
    });

    const advanced = await app.request(
      `/api/v1/staff/orders/${order.orderId}/commands`,
      {
        body: JSON.stringify({ action: "start-preparing" }),
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(advanced.status).toBe(200);
    await expect(advanced.json()).resolves.toMatchObject({
      action: "start-preparing",
      orderId: order.orderId,
      status: "preparing",
    });

    const skipped = await app.request(
      `/api/v1/staff/orders/${order.orderId}/commands`,
      {
        body: JSON.stringify({ action: "complete" }),
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(skipped.status).toBe(409);
    await expect(skipped.json()).resolves.toMatchObject({
      error: {
        code: "STAFF_ORDER_ILLEGAL_TRANSITION",
        currentStatus: "preparing",
      },
    });
    const ready = await app.request(
      `/api/v1/staff/orders/${order.orderId}/commands`,
      {
        body: JSON.stringify({ action: "mark-ready" }),
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({
      inventoryEffect: "retain",
      status: "ready-for-pickup",
    });
    const completed = await app.request(
      `/api/v1/staff/orders/${order.orderId}/commands`,
      {
        body: JSON.stringify({ action: "complete" }),
        headers: writeHeaders(staff),
        method: "POST",
      },
    );
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toMatchObject({
      growthPoints: 11,
      inventoryEffect: "sale",
      simulatedRefundCents: 0,
      status: "completed",
    });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role jingshu_runtime");
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        context.sandboxId,
      ]);
      const evidence = await client.query(
        `select orders.status, item.on_hand_quantity, item.reserved_quantity,
                hold.status as hold_status, movement.reason as movement_reason,
                movement.on_hand_delta, growth.growth_points,
                growth.final_simulated_amount_cents
           from customer_orders orders
           join order_inventory_reservations hold on hold.order_id = orders.id
           join inventory_items item on item.id = hold.inventory_item_id
           left join inventory_movements movement on movement.order_id = orders.id
           left join member_growth_events growth
             on growth.source_kind = 'order' and growth.source_id = orders.id
          where orders.sandbox_id = $1 and orders.id = $2`,
        [context.sandboxId, order.orderId],
      );
      expect(evidence.rows).toEqual([
        expect.objectContaining({
          final_simulated_amount_cents: 1_100,
          growth_points: 11,
          hold_status: "sold",
          movement_reason: "order-sale",
          on_hand_delta: -2,
          on_hand_quantity: catalog.products[0]!.onHandQuantity - 2,
          reserved_quantity: 0,
          status: "completed",
        }),
      ]);
      const audit = await client.query<{ action: string; result: string }>(
        `select action, result from audit_events
          where sandbox_id = $1 and object_id = $2 and action like 'order.%'
          order by recorded_at, id`,
        [context.sandboxId, order.orderId],
      );
      expect(audit.rows).toEqual(
        expect.arrayContaining([
          { action: "order.complete", result: "denied" },
          { action: "order.complete", result: "allowed" },
        ]),
      );
      const revenueEvent = await client.query<{ event_data: unknown }>(
        `select event_data from order_business_events
          where sandbox_id = $1 and order_id = $2
            and event_type = 'order.completed'`,
        [context.sandboxId, order.orderId],
      );
      expect(revenueEvent.rows).toEqual([
        {
          event_data: expect.objectContaining({
            finalSimulatedAmountCents: 1_100,
            growthPoints: 11,
            inventoryEffect: "sale",
          }),
        },
      ]);
      await client.query("commit");
    } finally {
      await client.end();
    }
  });

  it("rolls back every completion side effect when growth persistence fails", async () => {
    const context = await createArrivedReservation();
    const catalogResponse = await app.request(
      `/api/v1/customer/reservations/${context.reservationId}/products`,
      { headers: { Cookie: context.cookie } },
    );
    const catalog = (await catalogResponse.json()) as {
      products: Array<{ id: string; onHandQuantity: number }>;
    };
    const product = catalog.products[0]!;
    const created = await app.request("/api/v1/customer/orders", {
      body: JSON.stringify({
        couponId: null,
        lines: [{ productId: product.id, quantity: 2 }],
        reservationId: context.reservationId,
      }),
      headers: writeHeaders(context),
      method: "POST",
    });
    expect(created.status).toBe(201);
    const order = (await created.json()) as { orderId: string };
    const paid = await app.request(
      `/api/v1/customer/orders/${order.orderId}/simulated-payment`,
      { body: "{}", headers: writeHeaders(context), method: "POST" },
    );
    expect(paid.status).toBe(200);

    const staff = await switchRole(context, "staff");
    for (const action of ["start-preparing", "mark-ready"] as const) {
      const advanced = await app.request(
        `/api/v1/staff/orders/${order.orderId}/commands`,
        {
          body: JSON.stringify({ action }),
          headers: writeHeaders(staff),
          method: "POST",
        },
      );
      expect(advanced.status).toBe(200);
    }

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(`
        create or replace function ticket12_fail_order_growth()
        returns trigger language plpgsql as $$
        begin
          if new.source_kind = 'order' and new.source_id::text = TG_ARGV[0] then
            raise exception 'ticket12 injected order completion failure';
          end if;
          return new;
        end;
        $$;
        create trigger ticket12_fail_order_growth_trigger
        before insert on member_growth_events
        for each row execute function ticket12_fail_order_growth('${order.orderId}')
      `);

      const failed = await app.request(
        `/api/v1/staff/orders/${order.orderId}/commands`,
        {
          body: JSON.stringify({ action: "complete" }),
          headers: writeHeaders(staff),
          method: "POST",
        },
      );
      expect(failed.status).toBe(503);
      await expect(failed.json()).resolves.toMatchObject({
        error: {
          code: "STAFF_ORDER_SERVICE_UNAVAILABLE",
          message:
            "商品订单暂时无法处理，订单与库存没有被部分修改；请稍后安全重试。",
        },
      });

      const evidence = await client.query<{
        audit_count: string;
        command_count: string;
        completed_event_count: string;
        growth_count: string;
        hold_status: string;
        movement_count: string;
        on_hand_quantity: number;
        refund_count: string;
        reserved_quantity: number;
        status: string;
      }>(
        `select orders.status, item.on_hand_quantity, item.reserved_quantity,
                hold.status as hold_status,
                (select count(*) from inventory_movements
                  where sandbox_id = $1 and order_id = $2) as movement_count,
                (select count(*) from member_growth_events
                  where sandbox_id = $1 and source_kind = 'order'
                    and source_id = $2) as growth_count,
                (select count(*) from order_business_events
                  where sandbox_id = $1 and order_id = $2
                    and event_type = 'order.completed') as completed_event_count,
                (select count(*) from audit_events
                  where sandbox_id = $1 and object_id = $2
                    and action = 'order.complete') as audit_count,
                (select count(*) from order_frontline_command_requests
                  where sandbox_id = $1 and order_id = $2
                    and command_type = 'complete') as command_count,
                (select count(*) from order_simulated_refunds
                  where sandbox_id = $1 and order_id = $2) as refund_count
           from customer_orders orders
           join order_inventory_reservations hold on hold.order_id = orders.id
           join inventory_items item on item.id = hold.inventory_item_id
          where orders.sandbox_id = $1 and orders.id = $2`,
        [context.sandboxId, order.orderId],
      );
      expect(evidence.rows).toEqual([
        {
          audit_count: "0",
          command_count: "0",
          completed_event_count: "0",
          growth_count: "0",
          hold_status: "active",
          movement_count: "0",
          on_hand_quantity: product.onHandQuantity,
          refund_count: "0",
          reserved_quantity: 2,
          status: "ready-for-pickup",
        },
      ]);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client
        .query(
          "drop trigger if exists ticket12_fail_order_growth_trigger on member_growth_events",
        )
        .catch(() => undefined);
      await client
        .query("drop function if exists ticket12_fail_order_growth()")
        .catch(() => undefined);
      await client.end();
    }
  });

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
