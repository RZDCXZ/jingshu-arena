import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
let wallTime = fixedTime;
const database = createPublicSandboxDatabase(databaseUrl, {
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

async function withSandboxSql<T>(
  sandboxId: string,
  run: (client: pg.Client) => Promise<T>,
) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      sandboxId,
    ]);
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

async function createArrivedCustomerReservation() {
  const world = await database.create({
    creationKey: randomUUID(),
    selectedRole: "customer",
    visitorKey: `visitor-${randomUUID()}`,
  });
  const context = {
    contextVersion: world.roleContext.contextVersion,
    personaId: world.roleContext.persona.id,
    role: "customer",
    sandboxId: world.sandboxId,
  } as const;
  const availability = await database.readCustomerSeatAvailability({
    ...context,
    areaCode: "competitive-a",
    durationHours: 2,
    machineProfileCode: "competitive",
    mode: "immediate",
    storeCode: "prism-flagship",
  });
  const seat = availability.seats.find(
    (candidate) => candidate.availability === "available",
  );
  expect(seat).toBeDefined();
  const pending = await database.createCustomerPendingReservation({
    ...context,
    areaCode: "competitive-a",
    couponId: null,
    durationHours: 2,
    idempotencyKey: randomUUID(),
    machineProfileCode: "competitive",
    mode: "immediate",
    requestId: randomUUID(),
    seatCode: seat!.code,
    storeCode: "prism-flagship",
  });
  await database.simulateCustomerReservationPayment({
    ...context,
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    reservationId: pending.reservationId,
  });
  await withSandboxSql(context.sandboxId, async (client) => {
    await client.query(
      `update reservations
          set status = 'arrived', arrived_business_at = $3
        where sandbox_id = $1 and id = $2`,
      [context.sandboxId, pending.reservationId, wallTime],
    );
  });
  return { context, reservationId: pending.reservationId };
}

describe("customer order and whole-cart inventory persistence", () => {
  it("shows only this store's listed HQ products at store price for an arrived reservation", async () => {
    const { context, reservationId } = await createArrivedCustomerReservation();
    const catalog = await database.readCustomerOrderCatalog({
      ...context,
      reservationId,
    });

    expect(catalog).toMatchObject({
      reservation: {
        reservationId,
        status: "arrived",
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
      },
    });
    expect(catalog.products).toHaveLength(6);
    expect(catalog.products[0]).toMatchObject({
      availableQuantity: 18,
      name: "脉冲气泡水",
      unitPriceCents: 800,
    });
    expect(
      catalog.products.every((product) => product.availableQuantity >= 0),
    ).toBe(true);
    expect(catalog.coupons).toEqual([
      expect.objectContaining({
        code: "order-five",
        discountCents: 500,
        eligibility: expect.objectContaining({ status: "eligible" }),
      }),
    ]);

    await withSandboxSql(context.sandboxId, async (client) => {
      const visibility = await client.query<{ kind: string; listed: boolean }>(
        `select item.kind, coalesce(config.listed, false) as listed
           from inventory_items item
           left join store_products config on config.inventory_item_id = item.id
           join stores store on store.id = item.store_id
          where item.sandbox_id = $1 and store.code = 'prism-flagship'`,
        [context.sandboxId],
      );
      expect(visibility.rows.some((row) => row.kind === "spare")).toBe(true);
      expect(visibility.rows.some((row) => !row.listed)).toBe(true);
      expect(catalog.products).toHaveLength(
        visibility.rows.filter((row) => row.kind === "product" && row.listed)
          .length,
      );
    });
  });

  it("atomically snapshots, reserves and safely replays create and simulated payment", async () => {
    const { context, reservationId } = await createArrivedCustomerReservation();
    const catalog = await database.readCustomerOrderCatalog({
      ...context,
      reservationId,
    });
    const product = catalog.products[0]!;
    const coupon = catalog.coupons[0]!;
    const createKey = randomUUID();
    const command = {
      ...context,
      couponId: coupon.id,
      idempotencyKey: createKey,
      lines: [{ productId: product.id, quantity: 2 }],
      requestId: randomUUID(),
      reservationId,
    };
    const first = await database.createCustomerPendingOrder(command);
    const replay = await database.createCustomerPendingOrder({
      ...command,
      requestId: randomUUID(),
    });

    expect(first).toMatchObject({
      holdExpiresAt: new Date(fixedTime.getTime() + 10 * 60 * 1_000),
      replayed: false,
      snapshot: {
        discountCents: 500,
        lines: [
          {
            productId: product.id,
            productName: product.name,
            quantity: 2,
            unitPriceCents: product.unitPriceCents,
          },
        ],
        payableCents: product.unitPriceCents * 2 - 500,
      },
      status: "pending-simulated-payment",
    });
    expect(replay).toEqual({ ...first, replayed: true });
    await withSandboxSql(context.sandboxId, async (client) => {
      await client.query(
        `update products set name = '后续改名'
          where sandbox_id = $1 and id = $2`,
        [context.sandboxId, product.id],
      );
      await client.query(
        `update store_products
            set unit_price_cents = unit_price_cents + 700, listed = false
          where sandbox_id = $1 and product_id = $2`,
        [context.sandboxId, product.id],
      );
    });
    const pendingDetail = await database.readCustomerOrderDetail({
      ...context,
      orderId: first.orderId,
    });
    expect(pendingDetail).toMatchObject({
      actions: { canCancel: true, canSimulatePayment: true },
      coupon: { status: "reserved" },
      inventory: [
        {
          availableQuantity: product.availableQuantity - 2,
          reservedQuantity: 2,
        },
      ],
      snapshot: {
        lines: [
          {
            productName: product.name,
            unitPriceCents: product.unitPriceCents,
          },
        ],
      },
    });

    const paymentKey = randomUUID();
    const payment = await database.simulateCustomerOrderPayment({
      ...context,
      idempotencyKey: paymentKey,
      orderId: first.orderId,
      requestId: randomUUID(),
    });
    const paymentReplay = await database.simulateCustomerOrderPayment({
      ...context,
      idempotencyKey: paymentKey,
      orderId: first.orderId,
      requestId: randomUUID(),
    });
    expect(payment).toMatchObject({
      payment: {
        amountCents: first.snapshot.payableCents,
        doesNotCharge: true,
        simulated: true,
      },
      replayed: false,
      status: "simulated-paid",
    });
    expect(paymentReplay).toEqual({ ...payment, replayed: true });
    expect(
      await database.readCustomerOrderDetail({
        ...context,
        orderId: first.orderId,
      }),
    ).toMatchObject({
      coupon: { status: "redeemed" },
      status: "simulated-paid",
    });
  });

  it("rolls back the order, coupon, reservations and events when any cart line is short", async () => {
    const { context, reservationId } = await createArrivedCustomerReservation();
    const catalog = await database.readCustomerOrderCatalog({
      ...context,
      reservationId,
    });
    const enough = catalog.products[0]!;
    const short = catalog.products.find(
      (product) => product.availableQuantity === 3,
    )!;
    const coupon = catalog.coupons[0]!;

    await expect(
      database.createCustomerPendingOrder({
        ...context,
        couponId: coupon.id,
        idempotencyKey: randomUUID(),
        lines: [
          { productId: enough.id, quantity: 1 },
          { productId: short.id, quantity: 4 },
        ],
        requestId: randomUUID(),
        reservationId,
      }),
    ).rejects.toMatchObject({ reason: "insufficient-inventory" });

    await withSandboxSql(context.sandboxId, async (client) => {
      const counts = await client.query<{
        audits: number;
        events: number;
        movements: number;
        orders: number;
        reservations: number;
        reservedQuantity: number;
      }>(
        `select
           (select count(*)::integer from customer_orders where sandbox_id = $1) as orders,
           (select count(*)::integer from order_inventory_reservations where sandbox_id = $1) as reservations,
           (select count(*)::integer from order_business_events where sandbox_id = $1) as events,
           (select count(*)::integer from inventory_movements where sandbox_id = $1) as movements,
           (select count(*)::integer from audit_events where sandbox_id = $1 and action = 'order.create') as audits,
           (select sum(reserved_quantity)::integer from inventory_items where sandbox_id = $1) as "reservedQuantity"`,
        [context.sandboxId],
      );
      expect(counts.rows[0]).toEqual({
        audits: 0,
        events: 0,
        movements: 0,
        orders: 0,
        reservations: 0,
        reservedQuantity: 0,
      });
      const couponRow = await client.query<{ status: string }>(
        `select status from experience_coupons where sandbox_id = $1 and id = $2`,
        [context.sandboxId, coupon.id],
      );
      expect(couponRow.rows[0]?.status).toBe("available");
    });
  });

  it("releases unpaid holds on cancellation, timeout or reservation terminal, but keeps paid orders", async () => {
    const cancelledSetup = await createArrivedCustomerReservation();
    const cancelledCatalog = await database.readCustomerOrderCatalog({
      ...cancelledSetup.context,
      reservationId: cancelledSetup.reservationId,
    });
    const cancelledOrder = await database.createCustomerPendingOrder({
      ...cancelledSetup.context,
      couponId: cancelledCatalog.coupons[0]!.id,
      idempotencyKey: randomUUID(),
      lines: [{ productId: cancelledCatalog.products[0]!.id, quantity: 2 }],
      requestId: randomUUID(),
      reservationId: cancelledSetup.reservationId,
    });
    await expect(
      database.cancelCustomerOrder({
        ...cancelledSetup.context,
        idempotencyKey: randomUUID(),
        orderId: cancelledOrder.orderId,
        reason: "改变主意",
        requestId: randomUUID(),
      }),
    ).resolves.toMatchObject({ couponRestored: true, status: "cancelled" });

    const expiredSetup = await createArrivedCustomerReservation();
    const expiredCatalog = await database.readCustomerOrderCatalog({
      ...expiredSetup.context,
      reservationId: expiredSetup.reservationId,
    });
    const expiredOrder = await database.createCustomerPendingOrder({
      ...expiredSetup.context,
      couponId: null,
      idempotencyKey: randomUUID(),
      lines: [{ productId: expiredCatalog.products[0]!.id, quantity: 1 }],
      requestId: randomUUID(),
      reservationId: expiredSetup.reservationId,
    });
    wallTime = expiredOrder.holdExpiresAt;
    await expect(
      database.readCustomerOrderDetail({
        ...expiredSetup.context,
        orderId: expiredOrder.orderId,
      }),
    ).resolves.toMatchObject({ status: "expired" });

    wallTime = fixedTime;
    const terminalSetup = await createArrivedCustomerReservation();
    const terminalCatalog = await database.readCustomerOrderCatalog({
      ...terminalSetup.context,
      reservationId: terminalSetup.reservationId,
    });
    const unpaid = await database.createCustomerPendingOrder({
      ...terminalSetup.context,
      couponId: null,
      idempotencyKey: randomUUID(),
      lines: [{ productId: terminalCatalog.products[0]!.id, quantity: 1 }],
      requestId: randomUUID(),
      reservationId: terminalSetup.reservationId,
    });
    await withSandboxSql(terminalSetup.context.sandboxId, async (client) => {
      await client.query(
        `update reservations set status = 'completed', completed_business_at = $3
          where sandbox_id = $1 and id = $2`,
        [
          terminalSetup.context.sandboxId,
          terminalSetup.reservationId,
          wallTime,
        ],
      );
    });
    await expect(
      database.readCustomerOrderDetail({
        ...terminalSetup.context,
        orderId: unpaid.orderId,
      }),
    ).resolves.toMatchObject({ status: "cancelled" });

    const paidSetup = await createArrivedCustomerReservation();
    const paidCatalog = await database.readCustomerOrderCatalog({
      ...paidSetup.context,
      reservationId: paidSetup.reservationId,
    });
    const paid = await database.createCustomerPendingOrder({
      ...paidSetup.context,
      couponId: null,
      idempotencyKey: randomUUID(),
      lines: [{ productId: paidCatalog.products[0]!.id, quantity: 1 }],
      requestId: randomUUID(),
      reservationId: paidSetup.reservationId,
    });
    await database.simulateCustomerOrderPayment({
      ...paidSetup.context,
      idempotencyKey: randomUUID(),
      orderId: paid.orderId,
      requestId: randomUUID(),
    });
    await withSandboxSql(paidSetup.context.sandboxId, async (client) => {
      await client.query(
        `update reservations set status = 'completed', completed_business_at = $3
          where sandbox_id = $1 and id = $2`,
        [paidSetup.context.sandboxId, paidSetup.reservationId, wallTime],
      );
    });
    await expect(
      database.readCustomerOrderDetail({
        ...paidSetup.context,
        orderId: paid.orderId,
      }),
    ).resolves.toMatchObject({ status: "simulated-paid" });
  });

  it("serializes twenty requests against five items and collapses twenty same-key requests", async () => {
    const firstSetup = await createArrivedCustomerReservation();
    const firstCatalog = await database.readCustomerOrderCatalog({
      ...firstSetup.context,
      reservationId: firstSetup.reservationId,
    });
    const product = firstCatalog.products[0]!;
    await withSandboxSql(firstSetup.context.sandboxId, async (client) => {
      await client.query(
        `update inventory_items set on_hand_quantity = 5, reserved_quantity = 0
          where sandbox_id = $1 and product_id = $2`,
        [firstSetup.context.sandboxId, product.id],
      );
    });
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        database.createCustomerPendingOrder({
          ...firstSetup.context,
          couponId: null,
          idempotencyKey: randomUUID(),
          lines: [{ productId: product.id, quantity: 1 }],
          requestId: randomUUID(),
          reservationId: firstSetup.reservationId,
        }),
      ),
    );
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(5);

    const replaySetup = await createArrivedCustomerReservation();
    const replayCatalog = await database.readCustomerOrderCatalog({
      ...replaySetup.context,
      reservationId: replaySetup.reservationId,
    });
    const replayProduct = replayCatalog.products[0]!;
    const key = randomUUID();
    const replayOutcomes = await Promise.all(
      Array.from({ length: 20 }, () =>
        database.createCustomerPendingOrder({
          ...replaySetup.context,
          couponId: null,
          idempotencyKey: key,
          lines: [{ productId: replayProduct.id, quantity: 1 }],
          requestId: randomUUID(),
          reservationId: replaySetup.reservationId,
        }),
      ),
    );
    expect(
      new Set(replayOutcomes.map((outcome) => outcome.orderId)),
    ).toHaveLength(1);
    await withSandboxSql(replaySetup.context.sandboxId, async (client) => {
      const counts = await client.query<{
        events: number;
        orders: number;
        reservations: number;
      }>(
        `select
           (select count(*)::integer from customer_orders where sandbox_id = $1) as orders,
           (select count(*)::integer from order_inventory_reservations where sandbox_id = $1) as reservations,
           (select count(*)::integer from order_business_events where sandbox_id = $1) as events`,
        [replaySetup.context.sandboxId],
      );
      expect(counts.rows[0]).toEqual({ events: 1, orders: 1, reservations: 1 });
    });
  });
});
