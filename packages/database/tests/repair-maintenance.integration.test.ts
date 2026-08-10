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

async function createRepairWorld() {
  const world = await database.create({
    creationKey: randomUUID(),
    selectedRole: "staff",
    visitorKey: `visitor-${randomUUID()}`,
  });
  const staff = {
    contextVersion: world.roleContext.contextVersion,
    personaId: world.roleContext.persona.id,
    role: "staff" as const,
    sandboxId: world.sandboxId,
  };
  const intake = await database.readStaffRepairIntake(staff);
  const seat = intake.seats.find((candidate) => candidate.code === "A-18");
  const manager = intake.handlers.find(
    (candidate) => candidate.role === "manager",
  );
  expect(seat).toBeDefined();
  expect(manager).toMatchObject({
    displayName: "许知远",
    role: "manager",
  });
  const repair = await database.createStaffRepair({
    ...staff,
    description: "显示器间歇闪烁",
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    seatId: seat!.id,
  });
  return { manager: manager!, repair, staff };
}

async function createMaintenanceWorld() {
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
  const starts = [
    "2026-08-10T12:30:00.000Z",
    "2026-08-10T14:30:00.000Z",
    "2026-08-10T16:30:00.000Z",
    "2026-08-10T18:30:00.000Z",
  ].map((value) => new Date(value));
  const maintenanceWindow = await database.readCustomerSeatAvailability({
    ...customer,
    areaCode: "competitive-a",
    durationHours: 8,
    machineProfileCode: "competitive",
    mode: "future",
    requestedStartsAt: starts[0],
    storeCode: "prism-flagship",
  });
  const seatCode = maintenanceWindow.seats.find(
    (candidate) => candidate.availability === "available",
  )?.code;
  expect(seatCode).toBeDefined();
  const coupon = (
    await database.readCustomerSeatAvailability({
      ...customer,
      areaCode: "competitive-a",
      durationHours: 2,
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt: starts[1],
      storeCode: "prism-flagship",
    })
  ).coupons.find((candidate) => candidate.eligibility.status === "eligible");
  expect(coupon).toBeDefined();
  const reservations = [];
  for (const [index, requestedStartsAt] of starts.entries()) {
    const pending = await database.createCustomerPendingReservation({
      ...customer,
      areaCode: "competitive-a",
      couponId: index === 1 ? coupon!.id : null,
      durationHours: 2,
      idempotencyKey: randomUUID(),
      machineProfileCode: "competitive",
      mode: "future",
      requestedStartsAt,
      requestId: randomUUID(),
      seatCode: seatCode!,
      storeCode: "prism-flagship",
    });
    if (index < 3) {
      await database.simulateCustomerReservationPayment({
        ...customer,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        reservationId: pending.reservationId,
      });
    }
    reservations.push(pending);
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      customer.sandboxId,
    ]);
    await client.query(
      `update reservations
          set status = 'in-use', arrived_business_at = $3,
              started_business_at = $3
        where sandbox_id = $1 and id = $2`,
      [customer.sandboxId, reservations[0]!.reservationId, starts[0]],
    );
    await client.query(
      `update reservations
          set status = 'arrived', arrived_business_at = $3
        where sandbox_id = $1 and id = $2`,
      [customer.sandboxId, reservations[2]!.reservationId, fixedTime],
    );
    await client.query(
      `update reservations
          set hold_expires_at = $3
        where sandbox_id = $1 and id = $2`,
      [
        customer.sandboxId,
        reservations[3]!.reservationId,
        new Date("2026-08-10T13:30:00.000Z"),
      ],
    );
    await client.query("commit");
  } finally {
    await client.end();
  }
  wallTime = new Date("2026-08-10T12:47:23.000Z");
  const inUseCatalog = await database.readCustomerOrderCatalog({
    ...customer,
    reservationId: reservations[0]!.reservationId,
  });
  const unpaidOrder = await database.createCustomerPendingOrder({
    ...customer,
    couponId: null,
    idempotencyKey: randomUUID(),
    lines: [{ productId: inUseCatalog.products[0]!.id, quantity: 1 }],
    requestId: randomUUID(),
    reservationId: reservations[0]!.reservationId,
  });
  const arrivedCatalog = await database.readCustomerOrderCatalog({
    ...customer,
    reservationId: reservations[2]!.reservationId,
  });
  const paidOrder = await database.createCustomerPendingOrder({
    ...customer,
    couponId: null,
    idempotencyKey: randomUUID(),
    lines: [{ productId: arrivedCatalog.products[0]!.id, quantity: 1 }],
    requestId: randomUUID(),
    reservationId: reservations[2]!.reservationId,
  });
  await database.simulateCustomerOrderPayment({
    ...customer,
    idempotencyKey: randomUUID(),
    orderId: paidOrder.orderId,
    requestId: randomUUID(),
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
  const intake = await database.readStaffRepairIntake(staff);
  const seat = intake.seats.find((candidate) => candidate.code === seatCode);
  expect(seat).toBeDefined();
  const repair = await database.createStaffRepair({
    ...staff,
    description: "显示器突发黑屏",
    idempotencyKey: randomUUID(),
    requestId: randomUUID(),
    seatId: seat!.id,
  });
  await database.executeRepairCommand({
    ...staff,
    action: "assign",
    assigneePersonaId: staff.personaId,
    idempotencyKey: randomUUID(),
    internalNote: "先隔离设备，再检查显示线与供电。",
    priority: "urgent",
    publicNote: "门店已安排紧急检查。",
    repairId: repair.repairId,
    requestId: randomUUID(),
  });
  return {
    coupon: coupon!,
    orders: { paid: paidOrder, unpaid: unpaidOrder },
    repair,
    reservations,
    seatCode: seatCode!,
    staff,
  };
}

describe("repair maintenance persistence", () => {
  it("assigns a new repair to a same-store handler with queue priority but leaves the seat normal", async () => {
    const { manager, repair, staff } = await createRepairWorld();
    const command = {
      ...staff,
      action: "assign" as const,
      assigneePersonaId: manager.personaId,
      idempotencyKey: randomUUID(),
      internalNote: "晚高峰前先排查显示器线材",
      priority: "urgent" as const,
      publicNote: "门店已安排处理人，将尽快检查设备。",
      repairId: repair.repairId,
      requestId: randomUUID(),
    };

    const assigned = await database.executeRepairCommand(command);
    const replayed = await database.executeRepairCommand(command);
    const detail = await database.readRepairDetail({
      ...staff,
      repairId: repair.repairId,
    });

    expect(assigned).toMatchObject({
      action: "assign",
      affectedReservations: [],
      repairId: repair.repairId,
      replayed: false,
      seatOperationalStatus: "normal",
      status: "assigned",
    });
    expect(replayed).toEqual({ ...assigned, replayed: true });
    expect(detail).toMatchObject({
      assignedTo: {
        displayName: "许知远",
        personaId: manager.personaId,
        role: "manager",
      },
      internal: {
        notes: ["晚高峰前先排查显示器线材"],
      },
      priority: "urgent",
      publicUpdates: [
        expect.objectContaining({
          note: "门店已安排处理人，将尽快检查设备。",
          type: "repair.assigned",
        }),
      ],
      seat: { code: "A-18", operationalStatus: "normal" },
      status: "assigned",
    });
  });

  it("serializes concurrent repair commands with the same idempotency key", async () => {
    const { manager, repair, staff } = await createRepairWorld();
    const command = {
      ...staff,
      action: "assign" as const,
      assigneePersonaId: manager.personaId,
      idempotencyKey: randomUUID(),
      internalNote: "并发分派只提交一次。",
      priority: "high" as const,
      publicNote: "门店已安排处理人。",
      repairId: repair.repairId,
    };

    const results = await Promise.all([
      database.executeRepairCommand({ ...command, requestId: randomUUID() }),
      database.executeRepairCommand({ ...command, requestId: randomUUID() }),
    ]);

    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(results[0]!.repairId).toBe(results[1]!.repairId);
  });

  it("starts an assigned repair and atomically maintains the seat, interrupts reservations, refunds price segments and restores only unused coupons", async () => {
    const { coupon, orders, repair, reservations, seatCode, staff } =
      await createMaintenanceWorld();
    const currentTime = wallTime;
    const inUse = reservations[0]!;
    const expectedInUseRefund = Math.min(
      inUse.snapshot.price.payableCents,
      inUse.snapshot.price.segments
        .filter((segment) => segment.startsAt >= currentTime)
        .reduce((total, segment) => total + segment.amountCents, 0),
    );

    const started = await database.executeRepairCommand({
      ...staff,
      action: "start",
      assigneePersonaId: null,
      idempotencyKey: randomUUID(),
      internalNote: "已确认黑屏可复现，开始断电检修。",
      priority: null,
      publicNote: "设备已进入检修，受影响预约已自动处理。",
      repairId: repair.repairId,
      requestId: randomUUID(),
    });
    const detail = await database.readRepairDetail({
      ...staff,
      repairId: repair.repairId,
    });

    expect(started).toMatchObject({
      action: "start",
      repairId: repair.repairId,
      replayed: false,
      seatOperationalStatus: "maintenance",
      status: "processing",
    });
    expect(started.affectedReservations).toEqual(
      expect.arrayContaining([
        {
          couponRestored: false,
          outcome: "completed",
          reservationId: reservations[0]!.reservationId,
          simulatedRefundCents: expectedInUseRefund,
        },
        {
          couponRestored: true,
          outcome: "cancelled",
          reservationId: reservations[1]!.reservationId,
          simulatedRefundCents: reservations[1]!.snapshot.price.payableCents,
        },
        {
          couponRestored: false,
          outcome: "cancelled",
          reservationId: reservations[2]!.reservationId,
          simulatedRefundCents: reservations[2]!.snapshot.price.payableCents,
        },
        {
          couponRestored: false,
          outcome: "cancelled",
          reservationId: reservations[3]!.reservationId,
          simulatedRefundCents: 0,
        },
      ]),
    );
    expect(detail).toMatchObject({
      actions: { canAssign: false, canStart: false },
      seat: { code: seatCode, operationalStatus: "maintenance" },
      status: "processing",
    });
    expect(detail.publicUpdates.at(-1)).toMatchObject({
      note: "设备已进入检修，受影响预约已自动处理。",
      type: "repair.processing-started",
    });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role jingshu_runtime");
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        staff.sandboxId,
      ]);
      const states = await client.query<{
        id: string;
        status: string;
        terminal_reason: string | null;
      }>(
        `select id, status, terminal_reason from reservations
          where sandbox_id = $1 and id = any($2::uuid[])
          order by starts_at`,
        [
          staff.sandboxId,
          reservations.map((reservation) => reservation.reservationId),
        ],
      );
      expect(states.rows.map((row) => row.status)).toEqual([
        "completed",
        "cancelled",
        "cancelled",
        "cancelled",
      ]);
      expect(
        states.rows.every(
          (row) => row.terminal_reason === "repair-device-failure",
        ),
      ).toBe(true);
      const restoredCoupon = await client.query<{ status: string }>(
        `select status from experience_coupons
          where sandbox_id = $1 and id = $2`,
        [staff.sandboxId, coupon.id],
      );
      expect(restoredCoupon.rows).toEqual([{ status: "available" }]);
      const eventCounts = await client.query<{
        audit_count: number;
        event_count: number;
        refund_count: number;
      }>(
        `select
          (select count(*)::integer from reservation_business_events
            where sandbox_id = $1 and event_data->>'repairId' = $2::text) as event_count,
          (select count(*)::integer from reservation_simulated_refunds refund
            where sandbox_id = $1 and reservation_id = any($3::uuid[])) as refund_count,
          (select count(*)::integer from audit_events
            where sandbox_id = $1 and object_type = 'reservation'
              and after_data->>'repairId' = $2) as audit_count`,
        [
          staff.sandboxId,
          repair.repairId,
          reservations.map((reservation) => reservation.reservationId),
        ],
      );
      expect(eventCounts.rows).toEqual([
        { audit_count: 4, event_count: 4, refund_count: 3 },
      ]);
      const orderResults = await client.query<{
        hold_status: string;
        id: string;
        status: string;
      }>(
        `select orders.id, orders.status, hold.status as hold_status
           from customer_orders orders
           join order_inventory_reservations hold on hold.order_id = orders.id
          where orders.sandbox_id = $1 and orders.id = any($2::uuid[])
          order by orders.id`,
        [staff.sandboxId, [orders.unpaid.orderId, orders.paid.orderId]],
      );
      expect(orderResults.rows).toEqual(
        expect.arrayContaining([
          {
            hold_status: "released",
            id: orders.unpaid.orderId,
            status: "cancelled",
          },
          {
            hold_status: "active",
            id: orders.paid.orderId,
            status: "simulated-paid",
          },
        ]),
      );
      await client.query("commit");
    } finally {
      await client.end();
    }
  });

  it("settles overdue deadlines and still cancels an arrived reservation past its planned end", async () => {
    const { repair, reservations, staff } = await createMaintenanceWorld();
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role jingshu_runtime");
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        staff.sandboxId,
      ]);
      await client.query(
        `update reservations set status = 'cancelled'
          where sandbox_id = $1 and id = any($2::uuid[])`,
        [
          staff.sandboxId,
          reservations.map((reservation) => reservation.reservationId),
        ],
      );
      await client.query(
        `update reservations
            set status = 'in-use', starts_at = $3, ends_at = $4,
                started_business_at = $3, terminal_reason = null
                , price_snapshot = jsonb_set(
                    jsonb_set(
                      price_snapshot, '{window,startsAt}', to_jsonb($5::text)
                    ),
                    '{window,endsAt}', to_jsonb($6::text)
                  )
          where sandbox_id = $1 and id = $2`,
        [
          staff.sandboxId,
          reservations[0]!.reservationId,
          new Date("2026-08-10T08:00:00.000Z"),
          new Date("2026-08-10T10:00:00.000Z"),
          "2026-08-10T08:00:00.000Z",
          "2026-08-10T10:00:00.000Z",
        ],
      );
      await client.query(
        `update reservations
            set status = 'confirmed', starts_at = $3, ends_at = $4,
                price_snapshot = jsonb_set(
                  price_snapshot, '{window,startsAt}', to_jsonb($5::text)
                ),
                terminal_reason = null
          where sandbox_id = $1 and id = $2`,
        [
          staff.sandboxId,
          reservations[1]!.reservationId,
          new Date("2026-08-10T10:00:00.000Z"),
          new Date("2026-08-10T11:00:00.000Z"),
          "2026-08-10T10:00:00.000Z",
        ],
      );
      await client.query(
        `update reservations
            set status = 'arrived', starts_at = $3, ends_at = $4,
                terminal_reason = null
          where sandbox_id = $1 and id = $2`,
        [
          staff.sandboxId,
          reservations[2]!.reservationId,
          new Date("2026-08-10T11:00:00.000Z"),
          new Date("2026-08-10T11:30:00.000Z"),
        ],
      );
      await client.query(
        `update reservations
            set status = 'pending-confirmation', starts_at = $3, ends_at = $4,
                hold_expires_at = $5, terminal_reason = null
          where sandbox_id = $1 and id = $2`,
        [
          staff.sandboxId,
          reservations[3]!.reservationId,
          new Date("2026-08-10T16:30:00.000Z"),
          new Date("2026-08-10T18:30:00.000Z"),
          new Date("2026-08-10T12:00:00.000Z"),
        ],
      );
      await client.query("commit");
    } finally {
      await client.end();
    }

    const started = await database.executeRepairCommand({
      ...staff,
      action: "start",
      assigneePersonaId: null,
      idempotencyKey: randomUUID(),
      internalNote: "先结算已到期预约，再开始维修。",
      priority: null,
      publicNote: "设备已进入检修。",
      repairId: repair.repairId,
      requestId: randomUUID(),
    });

    expect(started.affectedReservations).toEqual([
      expect.objectContaining({
        outcome: "cancelled",
        reservationId: reservations[2]!.reservationId,
      }),
    ]);
    const verification = new Client({ connectionString: databaseUrl });
    await verification.connect();
    try {
      await verification.query("begin");
      await verification.query("set local role jingshu_runtime");
      await verification.query(
        "select set_config('app.sandbox_id', $1, true)",
        [staff.sandboxId],
      );
      const states = await verification.query<{
        id: string;
        status: string;
        terminal_reason: string | null;
      }>(
        `select id, status, terminal_reason from reservations
          where sandbox_id = $1 and id = any($2::uuid[])
          order by starts_at`,
        [
          staff.sandboxId,
          reservations.map((reservation) => reservation.reservationId),
        ],
      );
      expect(states.rows).toEqual([
        {
          id: reservations[0]!.reservationId,
          status: "completed",
          terminal_reason: "planned-end-auto-completed",
        },
        {
          id: reservations[1]!.reservationId,
          status: "expired",
          terminal_reason: "confirmed-no-show",
        },
        {
          id: reservations[2]!.reservationId,
          status: "cancelled",
          terminal_reason: "repair-device-failure",
        },
        {
          id: reservations[3]!.reservationId,
          status: "expired",
          terminal_reason: "pending-confirmation-timeout",
        },
      ]);
      await verification.query("commit");
    } finally {
      await verification.end();
    }
  });

  it("allows only the assignee or a same-store manager to start an assigned repair", async () => {
    const { manager, repair, staff } = await createRepairWorld();
    await database.executeRepairCommand({
      ...staff,
      action: "assign",
      assigneePersonaId: manager.personaId,
      idempotencyKey: randomUUID(),
      internalNote: "交由值班店长统筹处理。",
      priority: "high",
      publicNote: "门店已安排处理人。",
      repairId: repair.repairId,
      requestId: randomUUID(),
    });

    await expect(
      database.executeRepairCommand({
        ...staff,
        action: "start",
        assigneePersonaId: null,
        idempotencyKey: randomUUID(),
        internalNote: "越权尝试。",
        priority: null,
        publicNote: "准备处理。",
        repairId: repair.repairId,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ reason: "not-assignee" });

    const managerRole = await database.switchRoleContext({
      ...staff,
      requestId: randomUUID(),
      targetRole: "manager",
    });
    const started = await database.executeRepairCommand({
      contextVersion: managerRole.contextVersion,
      personaId: managerRole.persona.id,
      role: "manager",
      sandboxId: managerRole.sandboxId,
      action: "start",
      assigneePersonaId: null,
      idempotencyKey: randomUUID(),
      internalNote: "店长确认设备故障，开始处理。",
      priority: null,
      publicNote: "设备已进入检修。",
      repairId: repair.repairId,
      requestId: randomUUID(),
    });

    expect(started).toMatchObject({ status: "processing" });
  });

  it("records denied repair commands", async () => {
    const { manager, repair, staff } = await createRepairWorld();
    const assignKey = randomUUID();
    const assigned = {
      ...staff,
      action: "assign" as const,
      assigneePersonaId: manager.personaId,
      idempotencyKey: assignKey,
      internalNote: "只向一线员工展示的排查说明。",
      priority: "high" as const,
      publicNote: "门店已安排处理人。",
      repairId: repair.repairId,
      requestId: randomUUID(),
    };
    await database.executeRepairCommand(assigned);

    await expect(
      database.executeRepairCommand({
        ...staff,
        action: "start",
        assigneePersonaId: null,
        idempotencyKey: randomUUID(),
        internalNote: "非处理人尝试开始。",
        priority: null,
        publicNote: "准备开始。",
        repairId: repair.repairId,
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ reason: "not-assignee" });
    await expect(
      database.executeRepairCommand({
        ...assigned,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ reason: "illegal-transition" });
    await expect(
      database.executeRepairCommand({
        ...assigned,
        priority: "urgent",
        requestId: randomUUID(),
      }),
    ).rejects.toMatchObject({ reason: "idempotency-conflict" });

    const auditClient = new Client({ connectionString: databaseUrl });
    await auditClient.connect();
    try {
      await auditClient.query("begin");
      await auditClient.query("set local role jingshu_runtime");
      await auditClient.query("select set_config('app.sandbox_id', $1, true)", [
        staff.sandboxId,
      ]);
      const denials = await auditClient.query<{ reason: string }>(
        `select reason from audit_events
          where sandbox_id = $1 and object_type = 'repair'
            and object_id = $2 and result = 'denied'
          order by recorded_at, id`,
        [staff.sandboxId, repair.repairId],
      );
      expect(denials.rows.map((row) => row.reason)).toEqual(
        expect.arrayContaining([
          "not-assignee",
          "illegal-transition",
          "idempotency-conflict",
        ]),
      );
      await auditClient.query("commit");
    } finally {
      await auditClient.end();
    }
  });

  it("serializes reservation creation against repair maintenance", async () => {
    const { repair, seatCode, staff } = await createMaintenanceWorld();
    const customerRole = await database.switchRoleContext({
      ...staff,
      requestId: randomUUID(),
      targetRole: "customer",
    });
    const customer = {
      contextVersion: customerRole.contextVersion,
      personaId: customerRole.persona.id,
      role: "customer" as const,
      sandboxId: customerRole.sandboxId,
    };
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `delay_repair_reservation_${suffix}`;
    const triggerName = `delay_repair_reservation_${suffix}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        `create function ${functionName}() returns trigger language plpgsql as $$
         begin
           perform pg_sleep(0.5);
           return new;
         end
         $$`,
      );
      await client.query(
        `create trigger ${triggerName} before insert on reservations
         for each row when (new.sandbox_id = '${staff.sandboxId}'::uuid)
         execute function ${functionName}()`,
      );

      const pendingPromise = database.createCustomerPendingReservation({
        ...customer,
        areaCode: "competitive-a",
        couponId: null,
        durationHours: 2,
        idempotencyKey: randomUUID(),
        machineProfileCode: "competitive",
        mode: "future",
        requestedStartsAt: new Date("2026-08-11T02:30:00.000Z"),
        requestId: randomUUID(),
        seatCode,
        storeCode: "prism-flagship",
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const staffAgain = await database.switchRoleContext({
        ...customer,
        requestId: randomUUID(),
        targetRole: "staff",
      });
      const startPromise = database.executeRepairCommand({
        contextVersion: staffAgain.contextVersion,
        personaId: staffAgain.persona.id,
        role: "staff",
        sandboxId: staffAgain.sandboxId,
        action: "start",
        assigneePersonaId: null,
        idempotencyKey: randomUUID(),
        internalNote: "并发边界维修。",
        priority: null,
        publicNote: "设备已进入检修。",
        repairId: repair.repairId,
        requestId: randomUUID(),
      });
      const [pending, started] = await Promise.all([
        pendingPromise,
        startPromise,
      ]);
      expect(started.affectedReservations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ reservationId: pending.reservationId }),
        ]),
      );

      await client.query("begin");
      await client.query("set local role jingshu_runtime");
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        staff.sandboxId,
      ]);
      const invariant = await client.query<{
        operational_status: string;
        reservation_status: string;
      }>(
        `select seat.operational_status,
                reservation.status as reservation_status
           from reservations reservation
           join seats seat on seat.id = reservation.seat_id
          where reservation.sandbox_id = $1 and reservation.id = $2`,
        [staff.sandboxId, pending.reservationId],
      );
      expect(invariant.rows).toEqual([
        {
          operational_status: "maintenance",
          reservation_status: "cancelled",
        },
      ]);
      await client.query("commit");
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.query(
        `drop trigger if exists ${triggerName} on reservations`,
      );
      await client.query(`drop function if exists ${functionName}()`);
      await client.end();
    }
  });

  it.each([
    {
      name: "预约状态",
      table: "reservations",
      timing: "before update",
      when: "new.terminal_reason = 'repair-device-failure'",
    },
    {
      name: "模拟退款",
      table: "reservation_simulated_refunds",
      timing: "before insert",
      when: "new.reason = 'repair-device-failure'",
    },
    {
      name: "预约事件",
      table: "reservation_business_events",
      timing: "before insert",
      when: "new.event_data ? 'repairId'",
    },
    {
      name: "报修事件",
      table: "repair_business_events",
      timing: "before insert",
      when: "new.event_type = 'repair.processing-started'",
    },
    {
      name: "审计",
      table: "audit_events",
      timing: "before insert",
      when: "new.action like 'reservation.repair-maintenance%'",
    },
  ])(
    "rolls back the whole start transaction when $name persistence fails",
    async ({ table, timing, when }) => {
      const { repair, reservations, staff } = await createMaintenanceWorld();
      const suffix = randomUUID().replaceAll("-", "");
      const functionName = `fail_repair_start_${suffix}`;
      const triggerName = `fail_repair_start_${suffix}`;
      const client = new Client({ connectionString: databaseUrl });
      await client.connect();
      const command = {
        ...staff,
        action: "start" as const,
        assigneePersonaId: null,
        idempotencyKey: randomUUID(),
        internalNote: "故障注入事务。",
        priority: null,
        publicNote: "设备已进入检修。",
        repairId: repair.repairId,
        requestId: randomUUID(),
      };
      try {
        await client.query(
          `create function ${functionName}() returns trigger language plpgsql as $$
         begin
           raise exception 'injected repair maintenance failure';
         end
         $$`,
        );
        await client.query(
          `create trigger ${triggerName} ${timing} on ${table}
         for each row when (${when}) execute function ${functionName}()`,
        );

        await expect(database.executeRepairCommand(command)).rejects.toThrow(
          "injected repair maintenance failure",
        );

        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          staff.sandboxId,
        ]);
        const rollbackState = await client.query<{
          audit_count: number;
          command_count: number;
          event_count: number;
          operational_status: string;
          refund_count: number;
          repair_event_count: number;
          repair_status: string;
          reservation_statuses: string[];
        }>(
          `select
          repair.status as repair_status,
          seat.operational_status,
          array(
            select reservation.status::text from reservations reservation
             where reservation.sandbox_id = $1
               and reservation.id = any($3::uuid[])
             order by reservation.starts_at
          ) as reservation_statuses,
          (select count(*)::integer from reservation_simulated_refunds
            where sandbox_id = $1 and reservation_id = any($3::uuid[])) as refund_count,
          (select count(*)::integer from reservation_business_events
            where sandbox_id = $1 and event_data->>'repairId' = $2) as event_count,
          (select count(*)::integer from repair_business_events
            where sandbox_id = $1 and repair_id = $2::uuid
              and event_type = 'repair.processing-started') as repair_event_count,
          (select count(*)::integer from audit_events
            where sandbox_id = $1 and after_data->>'repairId' = $2::text) as audit_count,
          (select count(*)::integer from repair_state_command_requests
            where sandbox_id = $1 and repair_id = $2::uuid
              and command_type = 'start') as command_count
         from repairs repair
         join seats seat on seat.id = repair.seat_id
        where repair.sandbox_id = $1 and repair.id = $2::uuid`,
          [
            staff.sandboxId,
            repair.repairId,
            reservations.map((reservation) => reservation.reservationId),
          ],
        );
        expect(rollbackState.rows).toEqual([
          {
            audit_count: 0,
            command_count: 0,
            event_count: 0,
            operational_status: "normal",
            refund_count: 0,
            repair_event_count: 0,
            repair_status: "assigned",
            reservation_statuses: [
              "in-use",
              "confirmed",
              "arrived",
              "pending-confirmation",
            ],
          },
        ]);
        await client.query("commit");
      } finally {
        await client.query("rollback").catch(() => undefined);
        await client.query(`drop trigger if exists ${triggerName} on ${table}`);
        await client.query(`drop function if exists ${functionName}()`);
        await client.end();
      }

      await expect(
        database.executeRepairCommand(command),
      ).resolves.toMatchObject({
        replayed: false,
        status: "processing",
      });
    },
  );
});
