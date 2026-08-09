import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

let wallTime = new Date("2026-08-10T11:47:23.000Z");
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => wallTime },
});
const { Client } = pg;

async function readDeniedLifecycleAudits(
  sandboxId: string,
  reservationId: string,
) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      sandboxId,
    ]);
    const result = await client.query<{
      action: string;
      after_data: { status: string };
      before_data: { status: string };
      reason: string;
      result: string;
    }>(
      `select action, result, reason, before_data, after_data
         from audit_events
        where sandbox_id = $1 and object_id = $2 and result = 'denied'
        order by recorded_at, id`,
      [sandboxId, reservationId],
    );
    await client.query("commit");
    return result.rows;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

describe("customer reservation lifecycle persistence", () => {
  it("simulates payment from the immutable snapshot and safely replays the command", async () => {
    wallTime = new Date("2026-08-10T11:47:23.000Z");
    const world = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const context = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: world.roleContext.role,
      sandboxId: world.sandboxId,
    } as const;
    const availability = await database.readCustomerSeatAvailability({
      ...context,
      areaCode: "competitive-a",
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      storeCode: "prism-flagship",
    });
    const coupon = availability.coupons.find(
      (item) => item.eligibility.status === "eligible",
    );
    expect(coupon).toBeDefined();
    const pending = await database.createCustomerPendingReservation({
      ...context,
      areaCode: "competitive-a",
      couponId: coupon?.id ?? null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      requestId: randomUUID(),
      seatCode: "A-08",
      storeCode: "prism-flagship",
    });
    const key = randomUUID();
    const command = {
      ...context,
      idempotencyKey: key,
      requestId: randomUUID(),
      reservationId: pending.reservationId,
    };

    const first = await database.simulateCustomerReservationPayment(command);
    const replay = await database.simulateCustomerReservationPayment({
      ...command,
      requestId: randomUUID(),
    });
    const detail = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });

    expect(first).toMatchObject({
      payment: {
        amountCents: pending.snapshot.price.payableCents,
        simulated: true,
      },
      replayed: false,
      reservationId: pending.reservationId,
      status: "confirmed",
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(detail).toMatchObject({
      coupon: { status: "redeemed" },
      payment: first.payment,
      refund: null,
      status: "confirmed",
    });
    expect(detail.events.map((event) => event.type)).toEqual([
      "reservation.pending-created",
      "reservation.simulated-payment-succeeded",
    ]);
  });

  it("cancels a confirmed reservation with one full simulated refund and restores its coupon", async () => {
    wallTime = new Date("2026-08-10T11:47:23.000Z");
    const world = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const context = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: world.roleContext.role,
      sandboxId: world.sandboxId,
    } as const;
    const availability = await database.readCustomerSeatAvailability({
      ...context,
      areaCode: "competitive-a",
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      storeCode: "prism-flagship",
    });
    const coupon = availability.coupons.find(
      (item) => item.eligibility.status === "eligible",
    );
    const pending = await database.createCustomerPendingReservation({
      ...context,
      areaCode: "competitive-a",
      couponId: coupon?.id ?? null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      requestId: randomUUID(),
      seatCode: "A-08",
      storeCode: "prism-flagship",
    });
    await database.simulateCustomerReservationPayment({
      ...context,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      reservationId: pending.reservationId,
    });
    const key = randomUUID();
    const command = {
      ...context,
      idempotencyKey: key,
      reason: "行程变更",
      requestId: randomUUID(),
      reservationId: pending.reservationId,
    };

    const first = await database.cancelCustomerReservation(command);
    const replay = await database.cancelCustomerReservation({
      ...command,
      requestId: randomUUID(),
    });
    const detail = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });

    expect(first).toMatchObject({
      couponRestored: true,
      refund: {
        amountCents: pending.snapshot.price.payableCents,
        reason: "customer-cancelled-before-start",
        simulated: true,
      },
      replayed: false,
      reservationId: pending.reservationId,
      status: "cancelled",
    });
    expect(replay).toEqual({ ...first, replayed: true });
    expect(detail).toMatchObject({
      actions: { canCancel: false, canSimulatePayment: false },
      coupon: { status: "available" },
      refund: first.refund,
      status: "cancelled",
      terminalReason: "行程变更",
    });
    expect(detail.events.map((event) => event.type)).toEqual([
      "reservation.pending-created",
      "reservation.simulated-payment-succeeded",
      "reservation.cancelled",
    ]);
  });

  it("lazily expires a ten-minute hold once and releases its seat and coupon without a refund", async () => {
    wallTime = new Date("2026-08-10T11:47:23.000Z");
    const world = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const context = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: world.roleContext.role,
      sandboxId: world.sandboxId,
    } as const;
    const availability = await database.readCustomerSeatAvailability({
      ...context,
      areaCode: "competitive-a",
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      storeCode: "prism-flagship",
    });
    const coupon = availability.coupons.find(
      (item) => item.eligibility.status === "eligible",
    );
    const pending = await database.createCustomerPendingReservation({
      ...context,
      areaCode: "competitive-a",
      couponId: coupon?.id ?? null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      requestId: randomUUID(),
      seatCode: "A-08",
      storeCode: "prism-flagship",
    });

    wallTime = new Date(pending.holdExpiresAt.getTime() - 1);
    const beforeBoundary = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });
    expect(beforeBoundary).toMatchObject({
      coupon: { status: "reserved" },
      refund: null,
      status: "pending-confirmation",
    });

    wallTime = pending.holdExpiresAt;
    const first = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });
    const second = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });
    const availabilityAfterExpiry = await database.readCustomerSeatAvailability(
      {
        ...context,
        areaCode: "competitive-a",
        durationHours: 2,
        machineProfileCode: "competitive",
        mode: "future",
        requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
        storeCode: "prism-flagship",
      },
    );

    expect(first).toMatchObject({
      coupon: { status: "available" },
      refund: null,
      status: "expired",
      terminalReason: "pending-confirmation-timeout",
    });
    expect(first.events.map((event) => event.type)).toEqual([
      "reservation.pending-created",
      "reservation.pending-expired",
    ]);
    expect(second.events).toEqual(first.events);
    expect(
      availabilityAfterExpiry.seats.find((seat) => seat.code === "A-08"),
    ).toMatchObject({ availability: "available" });
  });

  it("lazily expires a confirmed no-show at fifteen minutes with one full simulated refund", async () => {
    wallTime = new Date("2026-08-10T11:47:23.000Z");
    const world = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const context = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: world.roleContext.role,
      sandboxId: world.sandboxId,
    } as const;
    const availability = await database.readCustomerSeatAvailability({
      ...context,
      areaCode: "competitive-a",
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      storeCode: "prism-flagship",
    });
    const coupon = availability.coupons.find(
      (item) => item.eligibility.status === "eligible",
    );
    const pending = await database.createCustomerPendingReservation({
      ...context,
      areaCode: "competitive-a",
      couponId: coupon?.id ?? null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      requestId: randomUUID(),
      seatCode: "A-08",
      storeCode: "prism-flagship",
    });
    await database.simulateCustomerReservationPayment({
      ...context,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      reservationId: pending.reservationId,
    });

    wallTime = new Date("2026-08-10T12:44:59.999Z");
    const beforeBoundary = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });
    expect(beforeBoundary).toMatchObject({
      arrivalWindow: {
        closesAt: new Date("2026-08-10T12:45:00.000Z"),
        opensAt: new Date("2026-08-10T12:00:00.000Z"),
      },
      coupon: { status: "redeemed" },
      refund: null,
      status: "confirmed",
    });

    wallTime = new Date("2026-08-10T12:45:00.000Z");
    const first = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });
    const second = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });

    expect(first).toMatchObject({
      coupon: { status: "available" },
      refund: {
        amountCents: pending.snapshot.price.payableCents,
        reason: "confirmed-no-show",
        simulated: true,
      },
      status: "expired",
      terminalReason: "confirmed-no-show",
    });
    expect(first.events.map((event) => event.type)).toEqual([
      "reservation.pending-created",
      "reservation.simulated-payment-succeeded",
      "reservation.no-show-expired",
    ]);
    expect(second.refund).toEqual(first.refund);
    expect(second.events).toEqual(first.events);
  });

  it("previews and advances to the next hold expiry exactly once", async () => {
    wallTime = new Date("2026-08-10T11:47:23.000Z");
    const world = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const context = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: world.roleContext.role,
      sandboxId: world.sandboxId,
    } as const;
    const pending = await database.createCustomerPendingReservation({
      ...context,
      areaCode: "competitive-a",
      couponId: null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      requestId: randomUUID(),
      seatCode: "A-08",
      storeCode: "prism-flagship",
    });

    const preview = await database.readDemoTime(context);
    const advance = await database.advanceDemoTime({
      ...context,
      idempotencyKey: randomUUID(),
      mode: "next-event",
      requestId: randomUUID(),
    });
    const detail = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });

    expect(preview.nextEvent).toEqual({
      afterTime: pending.holdExpiresAt,
      impacts: [{ count: 1, kind: "pending-reservation-expiration" }],
    });
    expect(advance).toMatchObject({
      afterTime: pending.holdExpiresAt,
      impacts: [{ count: 1, kind: "pending-reservation-expiration" }],
      mode: "next-event",
      replayed: false,
    });
    expect(detail.status).toBe("expired");
  });

  it("cancels an unpaid hold without inventing a refund", async () => {
    wallTime = new Date("2026-08-10T11:47:23.000Z");
    const world = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const context = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: world.roleContext.role,
      sandboxId: world.sandboxId,
    } as const;
    const pending = await database.createCustomerPendingReservation({
      ...context,
      areaCode: "competitive-a",
      couponId: null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      requestId: randomUUID(),
      seatCode: "A-08",
      storeCode: "prism-flagship",
    });

    const cancelled = await database.cancelCustomerReservation({
      ...context,
      idempotencyKey: randomUUID(),
      reason: "临时有事",
      requestId: randomUUID(),
      reservationId: pending.reservationId,
    });

    expect(cancelled).toMatchObject({
      couponRestored: false,
      refund: null,
      status: "cancelled",
    });
  });

  it("keeps an illegal command from changing terminal state and records a filtered denial", async () => {
    wallTime = new Date("2026-08-10T11:47:23.000Z");
    const world = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const context = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: world.roleContext.role,
      sandboxId: world.sandboxId,
    } as const;
    const pending = await database.createCustomerPendingReservation({
      ...context,
      areaCode: "competitive-a",
      couponId: null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      requestId: randomUUID(),
      seatCode: "A-08",
      storeCode: "prism-flagship",
    });
    const requestId = randomUUID();

    wallTime = pending.holdExpiresAt;
    const rejection = await database
      .simulateCustomerReservationPayment({
        ...context,
        idempotencyKey: randomUUID(),
        requestId,
        reservationId: pending.reservationId,
      })
      .catch((error: unknown) => error);
    const detail = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });
    const audits = await readDeniedLifecycleAudits(
      context.sandboxId,
      pending.reservationId,
    );

    expect(rejection).toMatchObject({
      code: "CUSTOMER_RESERVATION_LIFECYCLE_CONFLICT",
      currentStatus: "expired",
      reason: "illegal-transition",
    });
    expect(detail).toMatchObject({
      payment: null,
      status: "expired",
      terminalReason: "pending-confirmation-timeout",
    });
    expect(audits).toEqual([
      {
        action: "reservation.simulate-payment",
        after_data: { status: "expired" },
        before_data: { status: "expired" },
        reason: "illegal-transition",
        result: "denied",
      },
    ]);
  });

  it("rolls back status, coupon, event, audit and command key when payment persistence fails", async () => {
    wallTime = new Date("2026-08-10T11:47:23.000Z");
    const world = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const context = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: world.roleContext.role,
      sandboxId: world.sandboxId,
    } as const;
    const availability = await database.readCustomerSeatAvailability({
      ...context,
      areaCode: "competitive-a",
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      storeCode: "prism-flagship",
    });
    const coupon = availability.coupons.find(
      (item) => item.eligibility.status === "eligible",
    );
    const pending = await database.createCustomerPendingReservation({
      ...context,
      areaCode: "competitive-a",
      couponId: coupon?.id ?? null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      requestId: randomUUID(),
      seatCode: "A-08",
      storeCode: "prism-flagship",
    });
    const command = {
      ...context,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      reservationId: pending.reservationId,
    };
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`
      create function fail_ticket08_payment_event() returns trigger
      language plpgsql as $$
      begin
        if new.event_type = 'reservation.simulated-payment-succeeded' then
          raise exception 'forced simulated payment event failure';
        end if;
        return new;
      end
      $$
    `);
    await client.query(`
      create trigger fail_ticket08_payment_event
      before insert on reservation_business_events
      for each row execute function fail_ticket08_payment_event()
    `);

    try {
      await expect(
        database.simulateCustomerReservationPayment(command),
      ).rejects.toThrow("forced simulated payment event failure");
    } finally {
      await client.query(
        "drop trigger fail_ticket08_payment_event on reservation_business_events",
      );
      await client.query("drop function fail_ticket08_payment_event()");
    }

    const afterFailure = await database.readCustomerReservationDetail({
      ...context,
      reservationId: pending.reservationId,
    });
    const counts = await client.query<{
      allowed_audit_count: string;
      command_count: string;
      payment_event_count: string;
    }>(
      `select
         (select count(*)::text from reservation_lifecycle_command_requests
           where sandbox_id = $1 and reservation_id = $2
             and command_type = 'simulate-payment') as command_count,
         (select count(*)::text from reservation_business_events
           where sandbox_id = $1 and reservation_id = $2
             and event_type = 'reservation.simulated-payment-succeeded')
           as payment_event_count,
         (select count(*)::text from audit_events
           where sandbox_id = $1 and object_id = $2
             and action = 'reservation.simulate-payment'
             and result = 'allowed') as allowed_audit_count`,
      [context.sandboxId, pending.reservationId],
    );
    await client.end();

    expect(afterFailure).toMatchObject({
      coupon: { status: "reserved" },
      payment: null,
      status: "pending-confirmation",
    });
    expect(counts.rows).toEqual([
      {
        allowed_audit_count: "0",
        command_count: "0",
        payment_event_count: "0",
      },
    ]);

    const retry = await database.simulateCustomerReservationPayment(command);
    expect(retry).toMatchObject({ replayed: false, status: "confirmed" });
  });
});
