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

async function createFrontlineContext(role: "manager" | "staff") {
  const world = await database.create({
    creationKey: randomUUID(),
    selectedRole: role,
    visitorKey: `visitor-${randomUUID()}`,
  });
  return {
    contextVersion: world.roleContext.contextVersion,
    personaId: world.roleContext.persona.id,
    role,
    sandboxId: world.sandboxId,
  } as const;
}

const allFilters = {
  anomaly: "all",
  areaCode: null,
  machineProfileCode: null,
  search: "",
  status: null,
  time: "all",
} as const;

async function readAudits(sandboxId: string, reservationId: string) {
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
      reason: string | null;
      result: string;
    }>(
      `select action, result, reason from audit_events
        where sandbox_id = $1 and object_id = $2
        order by recorded_at, id`,
      [sandboxId, reservationId],
    );
    await client.query("commit");
    return result.rows;
  } finally {
    await client.end();
  }
}

describe("staff reservation operations persistence", () => {
  it("builds the current 06:00 business-day queues and applies all list filters", async () => {
    const context = await createFrontlineContext("staff");
    const workbench = await database.readStaffReservationWorkbench(context);
    const all = await database.readStaffReservationList({
      ...context,
      ...allFilters,
    });
    const arrived = await database.readStaffReservationList({
      ...context,
      ...allFilters,
      status: "arrived",
    });
    const anomalies = await database.readStaffReservationList({
      ...context,
      ...allFilters,
      anomaly: "only",
    });
    const upcoming = await database.readStaffReservationList({
      ...context,
      ...allFilters,
      time: "upcoming",
    });
    const bySearch = await database.readStaffReservationList({
      ...context,
      ...allFilters,
      search: workbench.queues.arrivalWindow[0]?.customer.displayName ?? "",
    });

    expect(workbench).toMatchObject({
      businessDay: {
        endsAt: new Date("2026-08-10T22:00:00.000Z"),
        key: "2026-08-10",
        startsAt: new Date("2026-08-09T22:00:00.000Z"),
      },
      store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
    });
    expect(workbench.queues.arrivalWindow.length).toBeGreaterThan(0);
    expect(workbench.queues.arrived).toHaveLength(1);
    expect(workbench.queues.inUse.length).toBeGreaterThanOrEqual(2);
    expect(workbench.queues.anomalies).toEqual([
      expect.objectContaining({
        anomaly: { code: "seat-maintenance", label: "座位维护中" },
        status: "in-use",
      }),
    ]);
    expect(all.rows.length).toBeGreaterThanOrEqual(8);
    expect(arrived.rows).toEqual([
      expect.objectContaining({ status: "arrived" }),
    ]);
    expect(anomalies.rows).toHaveLength(1);
    expect(upcoming.rows.length).toBeGreaterThan(0);
    expect(bySearch.rows).toHaveLength(1);
    expect(all.filterOptions.areas.length).toBeGreaterThan(1);
    expect(all.filterOptions.machineProfiles.length).toBeGreaterThan(1);
  });

  it("enforces arrival and start boundaries against the real database clock", async () => {
    const beforeOpenContext = await createFrontlineContext("staff");
    const beforeOpenReservation = (
      await database.readStaffReservationList({
        ...beforeOpenContext,
        ...allFilters,
        status: "confirmed",
      })
    ).rows.find(
      (row) => row.arrivalWindow.opensAt.getTime() > fixedTime.getTime(),
    );
    expect(beforeOpenReservation).toBeDefined();
    wallTime = new Date(
      beforeOpenReservation!.arrivalWindow.opensAt.getTime() - 1,
    );
    const tooEarly = await database
      .executeStaffReservationCommand({
        ...beforeOpenContext,
        action: "arrive",
        idempotencyKey: randomUUID(),
        reason: null,
        requestId: randomUUID(),
        reservationId: beforeOpenReservation!.reservationId,
      })
      .catch((error: unknown) => error);
    expect(tooEarly).toMatchObject({
      currentStatus: "confirmed",
      reason: "arrival-window-not-open",
    });
    wallTime = beforeOpenReservation!.arrivalWindow.opensAt;
    await expect(
      database.executeStaffReservationCommand({
        ...beforeOpenContext,
        action: "arrive",
        idempotencyKey: randomUUID(),
        reason: null,
        requestId: randomUUID(),
        reservationId: beforeOpenReservation!.reservationId,
      }),
    ).resolves.toMatchObject({ status: "arrived" });

    wallTime = fixedTime;
    const beforeCloseContext = await createFrontlineContext("staff");
    const beforeCloseReservation = (
      await database.readStaffReservationWorkbench(beforeCloseContext)
    ).queues.arrivalWindow[0];
    expect(beforeCloseReservation).toBeDefined();
    wallTime = new Date(
      beforeCloseReservation!.arrivalWindow.closesAt.getTime() - 1,
    );
    await expect(
      database.executeStaffReservationCommand({
        ...beforeCloseContext,
        action: "arrive",
        idempotencyKey: randomUUID(),
        reason: null,
        requestId: randomUUID(),
        reservationId: beforeCloseReservation!.reservationId,
      }),
    ).resolves.toMatchObject({ status: "arrived" });

    wallTime = fixedTime;
    const atNoShowContext = await createFrontlineContext("staff");
    const atNoShowReservation = (
      await database.readStaffReservationWorkbench(atNoShowContext)
    ).queues.arrivalWindow[0];
    expect(atNoShowReservation).toBeDefined();
    wallTime = atNoShowReservation!.arrivalWindow.closesAt;
    const atNoShow = await database
      .executeStaffReservationCommand({
        ...atNoShowContext,
        action: "arrive",
        idempotencyKey: randomUUID(),
        reason: null,
        requestId: randomUUID(),
        reservationId: atNoShowReservation!.reservationId,
      })
      .catch((error: unknown) => error);
    expect(atNoShow).toMatchObject({
      currentStatus: "expired",
      reason: "illegal-transition",
    });

    wallTime = fixedTime;
    const startContext = await createFrontlineContext("staff");
    const arrivedReservation = (
      await database.readStaffReservationWorkbench(startContext)
    ).queues.arrived[0];
    expect(arrivedReservation).toBeDefined();
    wallTime = new Date(arrivedReservation!.window.startsAt.getTime() - 1);
    const beforeStart = await database
      .executeStaffReservationCommand({
        ...startContext,
        action: "start-use",
        idempotencyKey: randomUUID(),
        reason: null,
        requestId: randomUUID(),
        reservationId: arrivedReservation!.reservationId,
      })
      .catch((error: unknown) => error);
    expect(beforeStart).toMatchObject({
      currentStatus: "arrived",
      reason: "reservation-not-started",
    });
    wallTime = arrivedReservation!.window.startsAt;
    await expect(
      database.executeStaffReservationCommand({
        ...startContext,
        action: "start-use",
        idempotencyKey: randomUUID(),
        reason: null,
        requestId: randomUUID(),
        reservationId: arrivedReservation!.reservationId,
      }),
    ).resolves.toMatchObject({ status: "in-use" });
  });

  it("atomically arrives, starts and reason-completes a reservation with safe replay", async () => {
    const context = await createFrontlineContext("staff");
    const workbench = await database.readStaffReservationWorkbench(context);
    const reservation = workbench.queues.arrivalWindow[0];
    expect(reservation).toBeDefined();
    const arriveKey = randomUUID();
    const arrived = await database.executeStaffReservationCommand({
      ...context,
      action: "arrive",
      idempotencyKey: arriveKey,
      reason: null,
      requestId: randomUUID(),
      reservationId: reservation!.reservationId,
    });
    const replay = await database.executeStaffReservationCommand({
      ...context,
      action: "arrive",
      idempotencyKey: arriveKey,
      reason: null,
      requestId: randomUUID(),
      reservationId: reservation!.reservationId,
    });
    expect(arrived).toMatchObject({ replayed: false, status: "arrived" });
    expect(replay).toEqual({ ...arrived, replayed: true });

    wallTime = reservation!.window.startsAt;
    await database.executeStaffReservationCommand({
      ...context,
      action: "start-use",
      idempotencyKey: randomUUID(),
      reason: null,
      requestId: randomUUID(),
      reservationId: reservation!.reservationId,
    });
    wallTime = new Date(reservation!.window.startsAt.getTime() + 60_000);
    await database.executeStaffReservationCommand({
      ...context,
      action: "complete-early",
      idempotencyKey: randomUUID(),
      reason: "顾客主动提前结束",
      requestId: randomUUID(),
      reservationId: reservation!.reservationId,
    });
    const detail = await database.readStaffReservationDetail({
      ...context,
      reservationId: reservation!.reservationId,
    });
    expect(detail).toMatchObject({
      actions: { canCancel: false, primary: null },
      terminalReason: "顾客主动提前结束",
      reservation: { status: "completed" },
    });
    expect(detail.events.map((event) => event.type)).toEqual([
      "reservation.pending-created",
      "reservation.simulated-payment-succeeded",
      "reservation.arrived",
      "reservation.started",
      "reservation.completed-early",
    ]);
    expect(
      (await readAudits(context.sandboxId, reservation!.reservationId)).map(
        (audit) => audit.action,
      ),
    ).toEqual([
      "reservation.arrive",
      "reservation.start-use",
      "reservation.complete-early",
    ]);
  });

  it("lets a manager cancel an arrived reservation with a full simulated refund", async () => {
    const context = await createFrontlineContext("manager");
    const list = await database.readStaffReservationList({
      ...context,
      ...allFilters,
      status: "arrived",
    });
    const reservation = list.rows[0];
    expect(reservation).toBeDefined();
    const cancelled = await database.executeStaffReservationCommand({
      ...context,
      action: "cancel",
      idempotencyKey: randomUUID(),
      reason: "门店应顾客请求取消",
      requestId: randomUUID(),
      reservationId: reservation!.reservationId,
    });
    const detail = await database.readStaffReservationDetail({
      ...context,
      reservationId: reservation!.reservationId,
    });
    expect(cancelled.status).toBe("cancelled");
    expect(detail).toMatchObject({
      actions: { canCancel: false, primary: null },
      auditAvailable: true,
      refund: { amountCents: expect.any(Number), simulated: true },
      terminalReason: "门店应顾客请求取消",
      reservation: { status: "cancelled" },
    });
  });

  it("auto-completes at the exact planned end and does not append duplicates", async () => {
    const context = await createFrontlineContext("staff");
    const list = await database.readStaffReservationList({
      ...context,
      ...allFilters,
      status: "in-use",
    });
    const reservation = list.rows.find((row) => row.anomaly === null);
    expect(reservation).toBeDefined();
    wallTime = new Date(reservation!.window.endsAt.getTime() - 1);
    const before = await database.readStaffReservationDetail({
      ...context,
      reservationId: reservation!.reservationId,
    });
    expect(before.reservation.status).toBe("in-use");
    wallTime = reservation!.window.endsAt;
    const first = await database.readStaffReservationDetail({
      ...context,
      reservationId: reservation!.reservationId,
    });
    const second = await database.readStaffReservationDetail({
      ...context,
      reservationId: reservation!.reservationId,
    });
    expect(first).toMatchObject({
      completedAt: reservation!.window.endsAt,
      reservation: { status: "completed" },
      terminalReason: "planned-end-auto-completed",
    });
    expect(
      first.events.filter(
        (event) => event.type === "reservation.auto-completed",
      ),
    ).toHaveLength(1);
    expect(second.events).toEqual(first.events);
  });

  it("denies and audits cross-store and illegal commands without changing state", async () => {
    const world = await database.create({
      creationKey: randomUUID(),
      selectedRole: "customer",
      visitorKey: `visitor-${randomUUID()}`,
    });
    const customer = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: "customer" as const,
      sandboxId: world.sandboxId,
    };
    const pending = await database.createCustomerPendingReservation({
      ...customer,
      areaCode: "competitive-lane",
      couponId: null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: new Date("2026-08-10T12:30:00.000Z"),
      requestId: randomUUID(),
      seatCode: "B-01",
      storeCode: "starbridge-standard",
    });
    await database.simulateCustomerReservationPayment({
      ...customer,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      reservationId: pending.reservationId,
    });
    const staffRole = await database.switchRoleContext({
      ...customer,
      requestId: randomUUID(),
      targetRole: "staff",
    });
    const staff = {
      contextVersion: staffRole.contextVersion,
      personaId: staffRole.persona.id,
      role: "staff" as const,
      sandboxId: staffRole.sandboxId,
    };
    const crossStore = await database
      .executeStaffReservationCommand({
        ...staff,
        action: "arrive",
        idempotencyKey: randomUUID(),
        reason: null,
        requestId: randomUUID(),
        reservationId: pending.reservationId,
      })
      .catch((error: unknown) => error);
    expect(crossStore).toMatchObject({
      code: "FRONTLINE_RESERVATION_CONFLICT",
      reason: "cross-store",
    });
    expect(
      await readAudits(staff.sandboxId, pending.reservationId),
    ).toContainEqual(
      expect.objectContaining({ reason: "cross-store", result: "denied" }),
    );

    const completed = (
      await database.readStaffReservationList({
        ...staff,
        ...allFilters,
        status: "completed",
      })
    ).rows[0];
    const illegal = await database
      .executeStaffReservationCommand({
        ...staff,
        action: "arrive",
        idempotencyKey: randomUUID(),
        reason: null,
        requestId: randomUUID(),
        reservationId: completed!.reservationId,
      })
      .catch((error: unknown) => error);
    expect(illegal).toMatchObject({
      currentStatus: "completed",
      reason: "illegal-transition",
    });
    expect(await readAudits(staff.sandboxId, completed!.reservationId)).toEqual(
      [
        expect.objectContaining({
          action: "reservation.arrive",
          reason: "illegal-transition",
          result: "denied",
        }),
      ],
    );
  });

  it("rolls back state, event, audit and command key when event persistence fails", async () => {
    const context = await createFrontlineContext("staff");
    const reservation = (await database.readStaffReservationWorkbench(context))
      .queues.arrivalWindow[0];
    expect(reservation).toBeDefined();
    const command = {
      ...context,
      action: "arrive" as const,
      idempotencyKey: randomUUID(),
      reason: null,
      requestId: randomUUID(),
      reservationId: reservation!.reservationId,
    };
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`
      create function fail_ticket09_arrival_event() returns trigger
      language plpgsql as $$
      begin
        if new.event_type = 'reservation.arrived' then
          raise exception 'forced arrival event failure';
        end if;
        return new;
      end
      $$
    `);
    await client.query(`
      create trigger fail_ticket09_arrival_event
      before insert on reservation_business_events
      for each row execute function fail_ticket09_arrival_event()
    `);
    await expect(
      database.executeStaffReservationCommand(command),
    ).rejects.toThrow("forced arrival event failure");
    await client.query(
      "drop trigger fail_ticket09_arrival_event on reservation_business_events",
    );
    await client.query("drop function fail_ticket09_arrival_event()");
    const beforeRetry = await database.readStaffReservationDetail({
      ...context,
      reservationId: reservation!.reservationId,
    });
    expect(beforeRetry.reservation.status).toBe("confirmed");
    expect(
      beforeRetry.events.filter(
        (event) => event.type === "reservation.arrived",
      ),
    ).toHaveLength(0);
    expect(
      await readAudits(context.sandboxId, reservation!.reservationId),
    ).toEqual([]);
    await expect(
      database.executeStaffReservationCommand(command),
    ).resolves.toMatchObject({
      replayed: false,
      status: "arrived",
    });
    await client.end();
  });
});
