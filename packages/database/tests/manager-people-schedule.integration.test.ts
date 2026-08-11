import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

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
const sql = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
  await sql.end();
});

async function createManagerContext() {
  const world = await database.create({
    creationKey: randomUUID(),
    selectedRole: "manager",
    visitorKey: `visitor-${randomUUID()}`,
  });
  return {
    contextVersion: world.roleContext.contextVersion,
    personaId: world.roleContext.persona.id,
    role: "manager" as const,
    sandboxId: world.sandboxId,
  };
}

describe("manager people, schedule and attendance persistence", () => {
  it("reads the fixed store roster and protects public demo personas", async () => {
    const context = await createManagerContext();
    const page = await database.readManagerPeopleSchedule(context);

    expect(page.store).toMatchObject({
      code: "prism-flagship",
      displayName: "棱镜旗舰店",
      fixed: true,
    });
    expect(page.employees).toHaveLength(16);
    expect(
      page.employees.filter((employee) => employee.protected),
    ).toHaveLength(2);
    expect(page.employees[0]).toMatchObject({
      active: true,
      employeeCode: expect.any(String),
      role: expect.stringMatching(/staff|manager/u),
      store: { code: "prism-flagship", fixed: true },
    });

    const protectedEmployee = page.employees.find(
      (employee) => employee.protected,
    )!;
    await expect(
      database.executeManagerPeopleCommand({
        ...context,
        action: "deactivate-employee",
        employeeId: protectedEmployee.employeeId,
        expectedVersion: protectedEmployee.version,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        storeId: page.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "protected-employee" });
  });

  it("creates and edits a background employee, saves a low-coverage shift, and blocks deactivation dependencies", async () => {
    const context = await createManagerContext();
    const initial = await database.readManagerPeopleSchedule(context);
    const createKey = randomUUID();
    const create = () =>
      database.executeManagerPeopleCommand({
        ...context,
        action: "create-employee" as const,
        displayName: "背景员工 17",
        employeeCode: "PRISM-S017",
        employeeRole: "staff" as const,
        idempotencyKey: createKey,
        requestId: randomUUID(),
        storeId: initial.store.storeId,
      });

    const created = await create();
    await expect(create()).resolves.toEqual({ ...created, replayed: true });
    const afterCreate = await database.readManagerPeopleSchedule(context);
    const employee = afterCreate.employees.find(
      (candidate) => candidate.employeeId === created.objectId,
    )!;
    expect(employee).toMatchObject({
      displayName: "背景员工 17",
      employeeCode: "PRISM-S017",
      protected: false,
      role: "staff",
    });

    await database.executeManagerPeopleCommand({
      ...context,
      action: "update-employee",
      displayName: "背景员工 17A",
      employeeCode: "PRISM-S017A",
      employeeId: employee.employeeId,
      expectedVersion: employee.version,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      storeId: initial.store.storeId,
    });

    const startsAt = new Date("2026-08-14T00:00:00.000Z");
    const endsAt = new Date("2026-08-14T08:00:00.000Z");
    const preview = await database.previewManagerShiftCoverage({
      ...context,
      employeeId: employee.employeeId,
      endsAt,
      requestId: randomUUID(),
      startsAt,
      storeId: initial.store.storeId,
    });
    expect(preview.validation).toEqual({ status: "valid" });
    expect(preview.warnings).toContainEqual({
      actualStaff: 1,
      endsAt,
      minimumStaff: 3,
      startsAt,
    });

    const saved = await database.executeManagerPeopleCommand({
      ...context,
      action: "create-shift",
      employeeId: employee.employeeId,
      endsAt,
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      startsAt,
      storeId: initial.store.storeId,
    });
    expect(saved.coverageWarnings).toEqual(preview.warnings);
    const withShift = await database.readManagerPeopleSchedule(context);
    expect(
      withShift.employees.find(
        (candidate) => candidate.employeeId === employee.employeeId,
      )?.dependencies.futureShifts,
    ).toBe(1);

    const intake = await database.readStaffRepairIntake(context);
    const backgroundHandler = intake.handlers.find(
      (handler) => handler.displayName === "背景员工 17A",
    );
    const availableSeat = intake.seats.find(
      (seat) => seat.existingRepair === null,
    );
    expect(backgroundHandler).toBeDefined();
    expect(availableSeat).toBeDefined();
    const repair = await database.createStaffRepair({
      ...context,
      description: "员工停用依赖测试",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      seatId: availableSeat!.id,
    });
    await database.executeRepairCommand({
      ...context,
      action: "assign",
      assigneePersonaId: backgroundHandler!.personaId,
      idempotencyKey: randomUUID(),
      internalNote: "交由背景员工完成虚构设备检查。",
      priority: "normal",
      publicNote: "门店已安排虚构员工检查。",
      repairId: repair.repairId,
      requestId: randomUUID(),
    });
    const withDependencies = await database.readManagerPeopleSchedule(context);
    expect(
      withDependencies.employees.find(
        (candidate) => candidate.employeeId === employee.employeeId,
      )?.dependencies,
    ).toMatchObject({
      currentOrFutureShifts: 1,
      openRepairAssignments: 1,
    });
    await expect(
      database.executeManagerPeopleCommand({
        ...context,
        action: "deactivate-employee",
        employeeId: employee.employeeId,
        expectedVersion: withDependencies.employees.find(
          (candidate) => candidate.employeeId === employee.employeeId,
        )!.version,
        idempotencyKey: randomUUID(),
        requestId: randomUUID(),
        storeId: initial.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "employee-dependencies" });
  });

  it("appends attendance corrections while retaining original facts", async () => {
    const context = await createManagerContext();
    const own = await database.readOwnShiftAttendance(context);
    const shift = own.shifts.current!;
    wallTime = shift.signInWindow.opensAt;
    await database.executeOwnAttendanceCommand({
      ...context,
      action: "simulated-check-in",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });
    await database.executeOwnAttendanceCommand({
      ...context,
      action: "manual-check-out",
      idempotencyKey: randomUUID(),
      requestId: randomUUID(),
      shiftId: shift.shiftId,
    });
    const page = await database.readManagerPeopleSchedule(context);
    const attendance = page.attendance.find(
      (item) => item.shiftId === shift.shiftId,
    )!;
    const original = attendance.original;

    await database.executeManagerPeopleCommand({
      ...context,
      action: "correct-attendance",
      attendanceRecordId: attendance.attendanceRecordId,
      correctedBusinessAt: new Date(
        shift.window.startsAt.getTime() + 12 * 60_000,
      ),
      correctionKind: "late",
      idempotencyKey: randomUUID(),
      reason: "已核对当班交接记录，确认实际到岗时间。",
      requestId: randomUUID(),
      storeId: page.store.storeId,
    });
    await database.executeManagerPeopleCommand({
      ...context,
      action: "correct-attendance",
      attendanceRecordId: attendance.attendanceRecordId,
      correctedBusinessAt: new Date(
        shift.window.startsAt.getTime() + 7 * 60 * 60_000 + 55 * 60_000,
      ),
      correctionKind: "check-out",
      idempotencyKey: randomUUID(),
      reason: "已核对冻结交接快照，修正虚构签退时间。",
      requestId: randomUUID(),
      storeId: page.store.storeId,
    });

    const confirmed = await database.readManagerPeopleSchedule(context);
    const corrected = confirmed.attendance.find(
      (item) => item.shiftId === shift.shiftId,
    )!;
    expect(corrected.original).toEqual(original);
    expect(corrected.corrections).toHaveLength(2);
    expect(corrected.corrections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          correctionKind: "late",
          reason: "已核对当班交接记录，确认实际到岗时间。",
        }),
        expect.objectContaining({
          correctionKind: "check-out",
          reason: "已核对冻结交接快照，修正虚构签退时间。",
        }),
      ]),
    );

    let absentAttendance: (typeof confirmed.attendance)[number] | undefined;
    for (let index = 0; index < 24 && !absentAttendance; index += 1) {
      const preview = await database.readDemoTime(context);
      if (!preview.nextEvent) break;
      await database.advanceDemoTime({
        ...context,
        idempotencyKey: randomUUID(),
        mode: "next-event",
        requestId: randomUUID(),
      });
      const advanced = await database.readManagerPeopleSchedule(context);
      absentAttendance = advanced.attendance.find(
        (item) => item.original.status === "absent",
      );
    }
    expect(absentAttendance).toBeDefined();
    const absentOriginal = absentAttendance!.original;
    await expect(
      database.executeManagerPeopleCommand({
        ...context,
        action: "correct-attendance",
        attendanceRecordId: absentAttendance!.attendanceRecordId,
        correctedBusinessAt: absentAttendance!.window.endsAt,
        correctionKind: "check-out",
        idempotencyKey: randomUUID(),
        reason: "错误事实类型必须被拒绝。",
        requestId: randomUUID(),
        storeId: page.store.storeId,
      }),
    ).rejects.toMatchObject({ reason: "invalid-attendance-correction" });
    await database.executeManagerPeopleCommand({
      ...context,
      action: "correct-attendance",
      attendanceRecordId: absentAttendance!.attendanceRecordId,
      correctedBusinessAt: absentAttendance!.window.endsAt,
      correctionKind: "absence",
      idempotencyKey: randomUUID(),
      reason: "已核对本店排班，确认缺勤事实时间。",
      requestId: randomUUID(),
      storeId: page.store.storeId,
    });
    const withAbsenceCorrection =
      await database.readManagerPeopleSchedule(context);
    const correctedAbsence = withAbsenceCorrection.attendance.find(
      (item) =>
        item.attendanceRecordId === absentAttendance!.attendanceRecordId,
    )!;
    expect(correctedAbsence.original).toEqual(absentOriginal);
    expect(correctedAbsence.corrections).toContainEqual(
      expect.objectContaining({ correctionKind: "absence" }),
    );

    const rows = await sql.query<{ count: number }>(
      `select count(*)::integer as count from attendance_corrections
        where sandbox_id = $1`,
      [context.sandboxId],
    );
    expect(rows.rows).toEqual([{ count: 3 }]);

    const removedSandbox = await sql.query<{ id: string }>(
      `delete from sandboxes where id = $1 returning id`,
      [context.sandboxId],
    );
    expect(removedSandbox.rows).toEqual([{ id: context.sandboxId }]);
  });

  it("returns headquarters read-only store summaries and rejects a foreign store target", async () => {
    const context = await createManagerContext();
    const page = await database.readManagerPeopleSchedule(context);
    const otherStore = await sql.query<{ id: string }>(
      `select id from stores where sandbox_id = $1 and id <> $2 order by code limit 1`,
      [context.sandboxId, page.store.storeId],
    );
    const previewRequestId = randomUUID();
    await expect(
      database.previewManagerShiftCoverage({
        ...context,
        employeeId: page.employees[0]!.employeeId,
        endsAt: new Date("2026-08-14T08:00:00.000Z"),
        requestId: previewRequestId,
        startsAt: new Date("2026-08-14T00:00:00.000Z"),
        storeId: otherStore.rows[0]!.id,
      }),
    ).rejects.toMatchObject({ reason: "cross-store" });
    const commandRequestId = randomUUID();
    await expect(
      database.executeManagerPeopleCommand({
        ...context,
        action: "create-employee",
        displayName: "跨店员工",
        employeeCode: "CROSS-S001",
        employeeRole: "staff",
        idempotencyKey: randomUUID(),
        requestId: commandRequestId,
        storeId: otherStore.rows[0]!.id,
      }),
    ).rejects.toMatchObject({ reason: "cross-store" });
    const deniedAudits = await sql.query<{
      action: string;
      reason: string;
      result: string;
    }>(
      `select action, reason, result from audit_events
        where sandbox_id = $1 and request_id = any($2::uuid[])
        order by action`,
      [context.sandboxId, [previewRequestId, commandRequestId]],
    );
    expect(deniedAudits.rows).toEqual([
      {
        action: "manager.create-employee",
        reason: "cross-store",
        result: "denied",
      },
      {
        action: "manager.preview-shift",
        reason: "cross-store",
        result: "denied",
      },
    ]);

    const hqRole = await database.switchRoleContext({
      ...context,
      requestId: randomUUID(),
      targetRole: "hq",
    });
    const summary = await database.readHeadquartersPeopleSchedule({
      contextVersion: hqRole.contextVersion,
      personaId: hqRole.persona.id,
      role: "hq",
      sandboxId: context.sandboxId,
    });
    expect(summary.stores).toHaveLength(3);
    expect(summary.stores.map((store) => store.employeeCount)).toEqual([
      7, 16, 10,
    ]);
    expect(
      summary.stores.every(
        (store) =>
          Number.isInteger(store.attendanceAnomalyCount) &&
          store.attendanceAnomalyCount >= 0,
      ),
    ).toBe(true);
  });
});
