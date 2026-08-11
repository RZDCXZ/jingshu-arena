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

describe("staff handover persistence", () => {
  it("freezes the operational snapshot, permits immediate sign-out, and records a same-store confirmation", async () => {
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
    const attendance = await database.readOwnShiftAttendance(staff);
    const shift = attendance.shifts.current!;
    await database.executeOwnAttendanceCommand({
      ...staff,
      action: "simulated-check-in",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });

    const preview = await database.readOwnHandovers(staff);
    expect(preview.outgoing).toMatchObject({
      canSubmit: true,
      handover: null,
      shiftId: shift.shiftId,
    });
    expect(
      preview.outgoing?.snapshotPreview.reservations.length,
    ).toBeGreaterThan(0);
    expect(preview.outgoing?.snapshotPreview.orders).toEqual(expect.any(Array));
    expect(preview.outgoing?.snapshotPreview.repairs).toEqual(
      expect.any(Array),
    );
    expect(
      preview.outgoing?.snapshotPreview.lowStockAlerts.length,
    ).toBeGreaterThan(0);

    const submitted = await database.submitOwnHandover({
      ...staff,
      idempotencyKey: randomUUID(),
      note: "A-18 耳机报修待分派；晚高峰请优先关注。",
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });
    expect(submitted).toMatchObject({
      confirmed: null,
      note: "A-18 耳机报修待分派；晚高峰请优先关注。",
      replayed: false,
      shiftId: shift.shiftId,
      submittedBy: { displayName: "周宁" },
    });
    const frozenSnapshot = submitted.snapshot;

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await expect(
        client.query(`update handovers set note = '尝试改写' where id = $1`, [
          submitted.handoverId,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query(
        `update reservations set status = 'completed'
          where sandbox_id = $1 and status in ('pending-confirmation', 'confirmed', 'arrived', 'in-use')`,
        [staff.sandboxId],
      );
      await client.query(
        `update customer_orders set status = 'completed'
          where sandbox_id = $1 and status in ('pending-simulated-payment', 'simulated-paid', 'preparing', 'ready-for-pickup')`,
        [staff.sandboxId],
      );
      await client.query(
        `update repairs set
            status = 'closed',
            resolution_note = coalesce(resolution_note, '测试快照清理'),
            resolution_submitted_by_persona_id = coalesce(
              resolution_submitted_by_persona_id,
              assigned_to_persona_id,
              created_by_persona_id
            ),
            resolution_business_at = coalesce(
              resolution_business_at,
              processing_business_at,
              created_business_at
            ),
            latest_verification_outcome = 'success',
            verified_by_persona_id = coalesce(
              verified_by_persona_id,
              assigned_to_persona_id,
              created_by_persona_id
            ),
            verification_business_at = coalesce(
              verification_business_at,
              processing_business_at,
              created_business_at
            ),
            closed_business_at = coalesce(
              closed_business_at,
              processing_business_at,
              created_business_at
            )
          where sandbox_id = $1 and status <> 'closed'`,
        [staff.sandboxId],
      );
      await client.query(
        `update inventory_items set low_stock_threshold = 0
          where sandbox_id = $1`,
        [staff.sandboxId],
      );
    } finally {
      await client.end();
    }

    const reread = await database.readOwnHandovers(staff);
    expect(reread.outgoing?.handover?.snapshot).toEqual(frozenSnapshot);

    const checkedOut = await database.executeOwnAttendanceCommand({
      ...staff,
      action: "manual-check-out",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });
    expect(checkedOut.status).toBe("checked-out");

    const managerRole = await database.switchRoleContext({
      ...staff,
      requestId: randomUUID(),
      targetRole: "manager",
    });
    const manager = {
      contextVersion: managerRole.contextVersion,
      personaId: managerRole.persona.id,
      role: "manager" as const,
      sandboxId: managerRole.sandboxId,
    };
    const managerAttendance = await database.readOwnShiftAttendance(manager);
    const managerShift = managerAttendance.shifts.current!;
    await database.executeOwnAttendanceCommand({
      ...manager,
      action: "simulated-check-in",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: managerShift.shiftId,
    });
    const incoming = await database.readOwnHandovers(manager);
    expect(incoming.incoming[0]).toMatchObject({
      canConfirm: true,
      handover: {
        handoverId: submitted.handoverId,
        submittedBy: { displayName: "周宁" },
      },
    });

    const confirmed = await database.confirmHandover({
      ...manager,
      handoverId: submitted.handoverId,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
    expect(confirmed).toMatchObject({
      confirmed: {
        by: { displayName: "许知远" },
        businessOccurredAt: expect.any(Date),
        recordedAt: expect.any(Date),
      },
      handoverId: submitted.handoverId,
      replayed: false,
    });
  });

  it("marks confirmation eligibility and audits rejected handover commands", async () => {
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
    const staffSchedule = await database.readOwnShiftAttendance(staff);
    const staffShift = staffSchedule.shifts.current!;
    await database.executeOwnAttendanceCommand({
      ...staff,
      action: "simulated-check-in",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: staffShift.shiftId,
    });
    const handover = await database.submitOwnHandover({
      ...staff,
      idempotencyKey: randomUUID(),
      note: "等待同店接班员工确认。",
      requestId: randomUUID(),
      shiftId: staffShift.shiftId,
    });

    const duplicateSubmissionRequestId = randomUUID();
    await expect(
      database.submitOwnHandover({
        ...staff,
        idempotencyKey: randomUUID(),
        note: "重复提交应保留原始交接。",
        requestId: duplicateSubmissionRequestId,
        shiftId: staffShift.shiftId,
      }),
    ).rejects.toMatchObject({ reason: "already-submitted" });

    const selfConfirmationRequestId = randomUUID();
    await expect(
      database.confirmHandover({
        ...staff,
        handoverId: handover.handoverId,
        idempotencyKey: randomUUID(),
        requestId: selfConfirmationRequestId,
      }),
    ).rejects.toMatchObject({ reason: "confirmation-not-eligible" });

    const managerRole = await database.switchRoleContext({
      ...staff,
      requestId: randomUUID(),
      targetRole: "manager",
    });
    const manager = {
      contextVersion: managerRole.contextVersion,
      personaId: managerRole.persona.id,
      role: "manager" as const,
      sandboxId: managerRole.sandboxId,
    };
    const managerSchedule = await database.readOwnShiftAttendance(manager);
    const managerIncoming = await database.readOwnHandovers(manager);
    expect(managerIncoming.incoming[0]).toMatchObject({
      canConfirm: false,
      handover: { handoverId: handover.handoverId },
    });

    const uncheckedConfirmationRequestId = randomUUID();
    await expect(
      database.confirmHandover({
        ...manager,
        handoverId: handover.handoverId,
        idempotencyKey: randomUUID(),
        requestId: uncheckedConfirmationRequestId,
      }),
    ).rejects.toMatchObject({ reason: "confirmation-not-eligible" });

    const ineligibleSubmissionRequestId = randomUUID();
    await expect(
      database.submitOwnHandover({
        ...manager,
        idempotencyKey: randomUUID(),
        note: "尚未签到时不可提交。",
        requestId: ineligibleSubmissionRequestId,
        shiftId: managerSchedule.shifts.current!.shiftId,
      }),
    ).rejects.toMatchObject({ reason: "shift-not-eligible" });

    await database.executeOwnAttendanceCommand({
      ...manager,
      action: "simulated-check-in",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: managerSchedule.shifts.current!.shiftId,
    });
    await database.confirmHandover({
      ...manager,
      handoverId: handover.handoverId,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
    });
    const duplicateConfirmationRequestId = randomUUID();
    await expect(
      database.confirmHandover({
        ...manager,
        handoverId: handover.handoverId,
        idempotencyKey: randomUUID(),
        requestId: duplicateConfirmationRequestId,
      }),
    ).rejects.toMatchObject({ reason: "already-confirmed" });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const audits = await client.query<{ reason: string; request_id: string }>(
        `select request_id, reason from audit_events
          where request_id = any($1::uuid[])
          order by request_id`,
        [
          [
            selfConfirmationRequestId,
            uncheckedConfirmationRequestId,
            ineligibleSubmissionRequestId,
            duplicateSubmissionRequestId,
            duplicateConfirmationRequestId,
          ],
        ],
      );
      expect(audits.rows).toEqual(
        [
          {
            reason: "self-confirmation",
            request_id: selfConfirmationRequestId,
          },
          {
            reason: "confirmation-not-checked-in",
            request_id: uncheckedConfirmationRequestId,
          },
          {
            reason: "shift-not-eligible",
            request_id: ineligibleSubmissionRequestId,
          },
          {
            reason: "already-submitted",
            request_id: duplicateSubmissionRequestId,
          },
          {
            reason: "already-confirmed",
            request_id: duplicateConfirmationRequestId,
          },
        ].toSorted((left, right) =>
          left.request_id.localeCompare(right.request_id),
        ),
      );
    } finally {
      await client.end();
    }
  });

  it("materializes missing, late, and long-unconfirmed handovers as separate operating exceptions", async () => {
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
    const schedule = await database.readOwnShiftAttendance(staff);
    const shift = schedule.shifts.current!;
    await database.executeOwnAttendanceCommand({
      ...staff,
      action: "simulated-check-in",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });

    wallTime = new Date(shift.window.endsAt.getTime() + 30 * 60_000);
    await database.readOwnHandovers(staff);
    const late = await database.submitOwnHandover({
      ...staff,
      idempotencyKey: randomUUID(),
      note: "迟交原因已在审计中保留。",
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });

    const managerRole = await database.switchRoleContext({
      ...staff,
      requestId: randomUUID(),
      targetRole: "manager",
    });
    const manager = {
      contextVersion: managerRole.contextVersion,
      personaId: managerRole.persona.id,
      role: "manager" as const,
      sandboxId: managerRole.sandboxId,
    };
    const exceptions = await database.readManagerHandoverExceptions(manager);

    expect(
      exceptions.exceptions
        .filter((row) => row.shiftId === shift.shiftId)
        .map((row) => row.kind)
        .toSorted(),
    ).toEqual(
      [
        "confirmation-overdue",
        "late-submission",
        "submission-overdue",
      ].toSorted(),
    );
    expect(
      exceptions.exceptions.find(
        (row) =>
          row.shiftId === shift.shiftId && row.kind === "late-submission",
      )?.handover,
    ).toMatchObject({
      handoverId: late.handoverId,
      snapshot: { capturedAt: wallTime },
    });
  });

  it("rejects and audits a cross-store confirmation without exposing the target", async () => {
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
    const ownSchedule = await database.readOwnShiftAttendance(staff);
    await database.executeOwnAttendanceCommand({
      ...staff,
      action: "simulated-check-in",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: ownSchedule.shifts.current!.shiftId,
    });

    const employeeId = randomUUID();
    const shiftId = randomUUID();
    const attendanceId = randomUUID();
    const handoverId = randomUUID();
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const store = await client.query<{ id: string }>(
        `select id from stores where sandbox_id = $1 and code = 'starbridge-standard'`,
        [staff.sandboxId],
      );
      const storeId = store.rows[0]!.id;
      await client.query(
        `insert into employees (
           id, sandbox_id, store_id, employee_code, display_name, role
         ) values ($1, $2, $3, 'STAR-S099', '异店背景员工', 'staff')`,
        [employeeId, staff.sandboxId, storeId],
      );
      await client.query(
        `insert into shifts (
           id, sandbox_id, store_id, employee_id, starts_at, ends_at
         ) values ($1, $2, $3, $4, '2026-08-10T10:00:00.000Z', '2026-08-10T18:00:00.000Z')`,
        [shiftId, staff.sandboxId, storeId, employeeId],
      );
      await client.query(
        `insert into attendance_records (
           id, sandbox_id, store_id, employee_id, shift_id, status,
           check_in_outcome, check_in_business_at, check_in_recorded_at
         ) values ($1, $2, $3, $4, $5, 'checked-in', 'on-time',
           '2026-08-10T10:00:00.000Z', '2026-08-10T10:00:00.000Z')`,
        [attendanceId, staff.sandboxId, storeId, employeeId, shiftId],
      );
      await client.query(
        `insert into handovers (
           id, sandbox_id, store_id, shift_id, submitted_by_employee_id,
           note, snapshot, submitted_business_at, submitted_recorded_at
         ) values ($1, $2, $3, $4, $5, '', $6::jsonb,
           '2026-08-10T11:30:00.000Z', '2026-08-10T11:30:00.000Z')`,
        [
          handoverId,
          staff.sandboxId,
          storeId,
          shiftId,
          employeeId,
          JSON.stringify({
            capturedAt: "2026-08-10T11:30:00.000Z",
            lowStockAlerts: [],
            orders: [],
            repairs: [],
            reservations: [],
          }),
        ],
      );

      const requestId = randomUUID();
      await expect(
        database.confirmHandover({
          ...staff,
          handoverId,
          idempotencyKey: randomUUID(),
          requestId,
        }),
      ).rejects.toMatchObject({ reason: "handover-not-found" });
      const audit = await client.query<{
        reason: string;
        result: string;
      }>(`select reason, result from audit_events where request_id = $1`, [
        requestId,
      ]);
      expect(audit.rows).toEqual([{ reason: "cross-store", result: "denied" }]);
    } finally {
      await client.end();
    }
  });
});
