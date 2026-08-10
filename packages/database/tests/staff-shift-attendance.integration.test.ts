import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const { Client } = pg;

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
let wallTime = fixedTime;
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => wallTime },
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

beforeEach(() => {
  wallTime = fixedTime;
});

afterAll(async () => {
  await database.close();
});

async function createEmployeeContext(role: "manager" | "staff") {
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

describe("staff shift attendance persistence", () => {
  it("shows only the current employee schedule and safely records early sign-in and manual sign-out", async () => {
    const context = await createEmployeeContext("staff");
    const initial = await database.readOwnShiftAttendance(context);

    expect(initial).toMatchObject({
      employee: {
        displayName: "周宁",
        role: "staff",
      },
      store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
    });
    expect(initial.shifts.current).toMatchObject({
      attendance: null,
      canManageSchedule: true,
      nextAction: {
        kind: "simulated-check-in",
        label: "模拟签到",
      },
    });
    expect(initial.shifts.future).toHaveLength(2);

    const shift = initial.shifts.current!;
    wallTime = shift.signInWindow.opensAt;
    const idempotencyKey = randomUUID();
    const checkedIn = await database.executeOwnAttendanceCommand({
      ...context,
      action: "simulated-check-in",
      idempotencyKey,
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });
    const replay = await database.executeOwnAttendanceCommand({
      ...context,
      action: "simulated-check-in",
      idempotencyKey,
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });

    expect(checkedIn).toMatchObject({
      outcome: "on-time",
      replayed: false,
      status: "checked-in",
    });
    expect(replay).toEqual({ ...checkedIn, replayed: true });

    wallTime = new Date(shift.window.endsAt.getTime() + 30 * 60_000);
    const awaitingManualSignOut =
      await database.readOwnShiftAttendance(context);
    expect(awaitingManualSignOut.shifts.current).toMatchObject({
      attendance: { status: "checked-in" },
      nextAction: { kind: "manual-check-out" },
    });
    const checkedOut = await database.executeOwnAttendanceCommand({
      ...context,
      action: "manual-check-out",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });
    expect(checkedOut).toMatchObject({
      outcome: "on-time",
      status: "checked-out",
    });

    const final = await database.readOwnShiftAttendance(context);
    expect(final.shifts.current).toBeNull();
    expect(final.shifts.recent[0]).toMatchObject({
      attendance: {
        checkIn: { outcome: "on-time" },
        checkOut: { source: "manual" },
        status: "checked-out",
      },
      canManageSchedule: false,
      nextAction: null,
    });
    expect(final.shifts.recent[0]?.facts.map((fact) => fact.type)).toEqual([
      "attendance.simulated-check-in",
      "attendance.manual-check-out",
    ]);
  });

  it("marks the employee absent when the shared business clock advances to the unsigned shift end", async () => {
    const context = await createEmployeeContext("manager");
    const initial = await database.readOwnShiftAttendance(context);
    const shift = initial.shifts.current!;
    let attendanceAdvanceSeen = false;

    for (let index = 0; index < 24; index += 1) {
      const preview = await database.readDemoTime(context);
      if (!preview.nextEvent) break;
      if (
        preview.nextEvent.impacts.some(
          (impact) => impact.kind === "attendance-absence",
        )
      ) {
        expect(preview.nextEvent.afterTime).toEqual(shift.window.endsAt);
        attendanceAdvanceSeen = true;
      }
      await database.advanceDemoTime({
        ...context,
        idempotencyKey: randomUUID(),
        mode: "next-event",
        requestId: randomUUID(),
      });
      if (attendanceAdvanceSeen) break;
    }

    expect(attendanceAdvanceSeen).toBe(true);
    const afterAdvance = await database.readOwnShiftAttendance(context);
    expect(afterAdvance.shifts.recent[0]).toMatchObject({
      attendance: {
        absence: { businessOccurredAt: shift.window.endsAt },
        status: "absent",
      },
      nextAction: null,
    });
  });

  it("previews and settles an unsigned shift already passed by natural business time", async () => {
    const context = await createEmployeeContext("staff");
    const initial = await database.readOwnShiftAttendance(context);
    const shift = initial.shifts.current!;
    wallTime = new Date(shift.window.endsAt.getTime() + 60_000);

    const preview = await database.readDemoTime(context);
    expect(preview.halfHour.impacts).toContainEqual({
      count: 2,
      kind: "attendance-absence",
    });
    const advanced = await database.advanceDemoTime({
      ...context,
      idempotencyKey: randomUUID(),
      mode: "half-hour",
      requestId: randomUUID(),
    });
    expect(advanced.impacts).toContainEqual({
      count: 2,
      kind: "attendance-absence",
    });

    const attendance = await database.readOwnShiftAttendance(context);
    expect(attendance.shifts.recent[0]).toMatchObject({
      attendance: { status: "absent" },
      shiftId: shift.shiftId,
    });
  });

  it("serializes different-key concurrent check-in and check-out as deterministic domain conflicts", async () => {
    const context = await createEmployeeContext("staff");
    const initial = await database.readOwnShiftAttendance(context);
    const shift = initial.shifts.current!;
    wallTime = shift.signInWindow.opensAt;

    const checkIns = await Promise.allSettled(
      [randomUUID(), randomUUID()].map((idempotencyKey) =>
        database.executeOwnAttendanceCommand({
          ...context,
          action: "simulated-check-in",
          idempotencyKey,
          requestId: randomUUID(),
          shiftId: shift.shiftId,
        }),
      ),
    );
    expect(
      checkIns.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      checkIns.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { reason: "already-checked-in" },
      status: "rejected",
    });

    const checkOuts = await Promise.allSettled(
      [randomUUID(), randomUUID()].map((idempotencyKey) =>
        database.executeOwnAttendanceCommand({
          ...context,
          action: "manual-check-out",
          idempotencyKey,
          requestId: randomUUID(),
          shiftId: shift.shiftId,
        }),
      ),
    );
    expect(
      checkOuts.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      checkOuts.find((result) => result.status === "rejected"),
    ).toMatchObject({
      reason: { reason: "attendance-finalized" },
      status: "rejected",
    });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const facts = await client.query<{ event_type: string }>(
        `select event_type from attendance_events
          where sandbox_id = $1 and shift_id = $2
          order by business_occurred_at, recorded_at, id`,
        [context.sandboxId, shift.shiftId],
      );
      expect(facts.rows).toHaveLength(2);
      expect(facts.rows.map((row) => row.event_type)).toEqual(
        expect.arrayContaining([
          "attendance.simulated-check-in",
          "attendance.manual-check-out",
        ]),
      );
    } finally {
      await client.end();
    }
  });

  it("uses a consistent lock order for concurrent commands at the absence boundary", async () => {
    const context = await createEmployeeContext("staff");
    const initial = await database.readOwnShiftAttendance(context);
    const shift = initial.shifts.current!;
    wallTime = shift.window.endsAt;

    const results = await Promise.allSettled(
      [randomUUID(), randomUUID()].map((idempotencyKey) =>
        database.executeOwnAttendanceCommand({
          ...context,
          action: "simulated-check-in",
          idempotencyKey,
          requestId: randomUUID(),
          shiftId: shift.shiftId,
        }),
      ),
    );
    expect(results).toHaveLength(2);
    expect(results).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ reason: "attendance-finalized" }),
        status: "rejected",
      }),
      expect.objectContaining({
        reason: expect.objectContaining({ reason: "attendance-finalized" }),
        status: "rejected",
      }),
    ]);
  });

  it("requires the employee to sign out an older shift before checking into another", async () => {
    const context = await createEmployeeContext("staff");
    const initial = await database.readOwnShiftAttendance(context);
    const current = initial.shifts.current!;
    const next = initial.shifts.future[0]!;
    wallTime = current.signInWindow.opensAt;
    await database.executeOwnAttendanceCommand({
      ...context,
      action: "simulated-check-in",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: current.shiftId,
    });

    wallTime = next.signInWindow.opensAt;
    await expect(
      database.executeOwnAttendanceCommand({
        ...context,
        action: "simulated-check-in",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        shiftId: next.shiftId,
      }),
    ).rejects.toMatchObject({ reason: "employee-already-checked-in" });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const open = await client.query<{ count: string }>(
        `select count(*)::text as count from attendance_records
          where sandbox_id = $1 and employee_id = (
            select id from employees where sandbox_id = $1 and persona_id = $2
          ) and status = 'checked-in'`,
        [context.sandboxId, context.personaId],
      );
      expect(open.rows[0]?.count).toBe("1");
    } finally {
      await client.end();
    }
  });

  it("keeps recorded attendance facts append-only for the runtime role", async () => {
    const context = await createEmployeeContext("staff");
    const initial = await database.readOwnShiftAttendance(context);
    const shift = initial.shifts.current!;
    await database.executeOwnAttendanceCommand({
      ...context,
      action: "simulated-check-in",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await expect(
        client.query(
          `update attendance_records
              set check_in_business_at = check_in_business_at + interval '1 minute'
            where sandbox_id = $1 and shift_id = $2`,
          [context.sandboxId, shift.shiftId],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      await client.query("begin");
      await client.query("set local role jingshu_runtime");
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        context.sandboxId,
      ]);
      await expect(
        client.query(
          `delete from attendance_events
            where sandbox_id = $1 and shift_id = $2`,
          [context.sandboxId, shift.shiftId],
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
    } finally {
      await client.end();
    }

    await expect(
      database.executeOwnAttendanceCommand({
        ...context,
        action: "manual-check-out",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        shiftId: shift.shiftId,
      }),
    ).resolves.toMatchObject({ status: "checked-out" });
  });

  it("denies and audits a shift owned by an employee in another store", async () => {
    const context = await createEmployeeContext("staff");
    const client = new Client({ connectionString: databaseUrl });
    const otherEmployeeId = randomUUID();
    const otherShiftId = randomUUID();
    await client.connect();
    try {
      const otherStore = await client.query<{ id: string }>(
        `select id from stores
          where sandbox_id = $1
            and id <> (
              select store_id from demo_personas
               where sandbox_id = $1 and id = $2
            )
          order by code limit 1`,
        [context.sandboxId, context.personaId],
      );
      await client.query(
        `insert into employees (
           id, sandbox_id, store_id, employee_code, display_name, role
         ) values ($1, $2, $3, 'HARBOR-S009', '跨店员工', 'staff')`,
        [otherEmployeeId, context.sandboxId, otherStore.rows[0]!.id],
      );
      await client.query(
        `insert into shifts (
           id, sandbox_id, store_id, employee_id, starts_at, ends_at
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          otherShiftId,
          context.sandboxId,
          otherStore.rows[0]!.id,
          otherEmployeeId,
          "2026-08-10T12:00:00.000Z",
          "2026-08-10T20:00:00.000Z",
        ],
      );

      await expect(
        database.executeOwnAttendanceCommand({
          ...context,
          action: "simulated-check-in",
          idempotencyKey: randomUUID(),
          requestId: randomUUID(),
          shiftId: otherShiftId,
        }),
      ).rejects.toMatchObject({ reason: "not-own-shift" });
      const audit = await client.query<{
        action: string;
        reason: string | null;
        result: string;
      }>(
        `select action, reason, result from audit_events
          where sandbox_id = $1 and object_id = $2
          order by recorded_at desc limit 1`,
        [context.sandboxId, otherShiftId],
      );
      expect(audit.rows[0]).toEqual({
        action: "attendance.simulated-check-in",
        reason: "not-own-shift",
        result: "denied",
      });
    } finally {
      await client.end();
    }
  });

  it("enforces fixed employee scope, aligned 4–12 hour shifts and no overlap in Postgres", async () => {
    const context = await createEmployeeContext("staff");
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const employee = await client.query<{
        employee_id: string;
        store_id: string;
      }>(
        `select id as employee_id, store_id
           from employees
          where sandbox_id = $1 and persona_id = $2`,
        [context.sandboxId, context.personaId],
      );
      const row = employee.rows[0]!;
      const otherStore = await client.query<{ id: string }>(
        `select id from stores
          where sandbox_id = $1 and id <> $2
          order by code limit 1`,
        [context.sandboxId, row.store_id],
      );
      await expect(
        client.query(
          `update employees set store_id = $3
            where sandbox_id = $1 and id = $2`,
          [context.sandboxId, row.employee_id, otherStore.rows[0]!.id],
        ),
      ).rejects.toMatchObject({ code: "23514" });

      const validShiftId = randomUUID();
      await client.query(
        `insert into shifts (
           id, sandbox_id, store_id, employee_id, starts_at, ends_at
         ) values ($1, $2, $3, $4, $5, $6)`,
        [
          validShiftId,
          context.sandboxId,
          row.store_id,
          row.employee_id,
          "2026-08-13T20:00:00.000Z",
          "2026-08-14T04:00:00.000Z",
        ],
      );
      await expect(
        client.query(
          `insert into shifts (
             id, sandbox_id, store_id, employee_id, starts_at, ends_at
           ) values ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            context.sandboxId,
            row.store_id,
            row.employee_id,
            "2026-08-14T03:30:00.000Z",
            "2026-08-14T11:30:00.000Z",
          ],
        ),
      ).rejects.toMatchObject({ code: "23P01" });
      await expect(
        client.query(
          `insert into shifts (
             id, sandbox_id, store_id, employee_id, starts_at, ends_at
           ) values ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            context.sandboxId,
            row.store_id,
            row.employee_id,
            "2026-08-15T12:15:00.000Z",
            "2026-08-15T20:15:00.000Z",
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await expect(
        client.query(
          `insert into shifts (
             id, sandbox_id, store_id, employee_id, starts_at, ends_at
           ) values ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            context.sandboxId,
            row.store_id,
            row.employee_id,
            "2026-08-15T12:00:00.000Z",
            "2026-08-15T15:00:00.000Z",
          ],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.end();
    }
  });

  it("allows unsigned future schedule edits but freezes attended shift facts", async () => {
    const context = await createEmployeeContext("manager");
    const initial = await database.readOwnShiftAttendance(context);
    const current = initial.shifts.current!;
    const future = initial.shifts.future[0]!;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        `update shifts
            set starts_at = starts_at + interval '30 minutes',
                ends_at = ends_at + interval '30 minutes'
          where sandbox_id = $1 and id = $2`,
        [context.sandboxId, future.shiftId],
      );
      await database.executeOwnAttendanceCommand({
        ...context,
        action: "simulated-check-in",
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        shiftId: current.shiftId,
      });
      await expect(
        client.query(
          `update shifts set starts_at = starts_at + interval '30 minutes'
            where sandbox_id = $1 and id = $2`,
          [context.sandboxId, current.shiftId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.end();
    }
  });
});
