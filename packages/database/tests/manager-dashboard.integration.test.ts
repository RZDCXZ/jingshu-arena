import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => fixedTime },
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

async function createContext(role: "manager" | "staff") {
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

describe("manager store dashboard persistence", () => {
  it("calculates the current store and exposes fourteen real business-day filters", async () => {
    const context = await createContext("manager");

    const dashboard = await database.readManagerDashboard(context);

    expect(dashboard.store).toEqual({
      code: "prism-flagship",
      displayName: "棱镜旗舰店",
    });
    expect(dashboard.availableBusinessDays).toHaveLength(14);
    expect(dashboard.availableBusinessDays[0]?.key).toBe("2026-07-28");
    expect(dashboard.availableBusinessDays[13]?.key).toBe("2026-08-10");
    expect(dashboard.range).toMatchObject({
      fromBusinessDay: "2026-08-10",
      preset: "current",
      toBusinessDay: "2026-08-10",
    });
    expect(dashboard.summary.revenue.reservationCents).toBeGreaterThan(0);
    expect(dashboard.summary.revenue.totalCents).toBe(
      dashboard.summary.revenue.reservationCents +
        dashboard.summary.revenue.orderCents,
    );
    expect(dashboard.summary.seats.normalSeatMinutes).toBe(
      dashboard.summary.seats.businessSeatMinutes -
        dashboard.summary.seats.maintenanceMinutes,
    );
    expect(dashboard.summary.repairs).toMatchObject({
      openCount: 1,
      openByPriority: { high: 1 },
    });
    expect(dashboard.summary.repairs.medianResolutionMinutes).not.toBeNull();
    expect(dashboard.summary.repairs.maintenanceMinutes).toBeGreaterThan(0);
    expect(
      dashboard.summary.attendance.onTime +
        dashboard.summary.attendance.late +
        dashboard.summary.attendance.absent,
    ).toBeGreaterThan(0);
    expect(dashboard.summary.handoverExceptionCount).toBeGreaterThan(0);
    expect(dashboard.trend).toHaveLength(7);
    expect(dashboard.recentEvidence.length).toBeGreaterThan(0);
  });

  it("keeps custom ranges inside the fourteen seeded business days and rejects staff scope", async () => {
    const manager = await createContext("manager");
    const dashboard = await database.readManagerDashboard({
      ...manager,
      fromBusinessDay: "2026-08-04",
      toBusinessDay: "2026-08-10",
    });
    expect(dashboard.range).toMatchObject({
      fromBusinessDay: "2026-08-04",
      preset: "custom",
      toBusinessDay: "2026-08-10",
    });
    expect(dashboard.days).toHaveLength(7);
    expect(dashboard.days.every((day) => day.revenue.totalCents > 0)).toBe(
      true,
    );

    await expect(
      database.readManagerDashboard({
        ...manager,
        fromBusinessDay: "2026-07-27",
        toBusinessDay: "2026-08-10",
      }),
    ).rejects.toMatchObject({ reason: "outside-seed-range" });

    const staff = await createContext("staff");
    await expect(database.readManagerDashboard(staff)).rejects.toMatchObject({
      code: "ROLE_CONTEXT_STALE",
    });
  });

  it("returns same-range drilldown facts instead of precomputed labels", async () => {
    const context = await createContext("manager");
    const dashboard = await database.readManagerDashboard({
      ...context,
      drilldown: "revenue",
    });

    expect(dashboard.drilldown).toMatchObject({
      fromBusinessDay: "2026-08-10",
      kind: "revenue",
      storeCode: "prism-flagship",
      toBusinessDay: "2026-08-10",
    });
    expect(dashboard.drilldown?.rows.length).toBeGreaterThan(0);
    expect(
      dashboard.drilldown?.rows.every(
        (row) =>
          row.businessDayKey === "2026-08-10" &&
          row.objectId.length > 0 &&
          row.occurredAt instanceof Date,
      ),
    ).toBe(true);
  });

  it("uses the latest attendance correction without rewriting the original fact", async () => {
    const context = await createContext("manager");
    const before = await database.readManagerDashboard(context);
    const people = await database.readManagerPeopleSchedule(context);
    const late = people.attendance.find(
      (item) => item.original.checkInOutcome === "late",
    );
    expect(late).toBeDefined();

    await database.executeManagerPeopleCommand({
      ...context,
      action: "correct-attendance",
      attendanceRecordId: late!.attendanceRecordId,
      correctedBusinessAt: late!.window.startsAt,
      correctionKind: "late",
      idempotencyKey: randomUUID(),
      reason: "已核对冻结交接记录，修正虚构到岗时间。",
      requestId: randomUUID(),
      storeId: people.store.storeId,
    });

    const after = await database.readManagerDashboard(context);
    const reread = await database.readManagerPeopleSchedule(context);
    const corrected = reread.attendance.find(
      (item) => item.attendanceRecordId === late!.attendanceRecordId,
    );
    expect(corrected?.original).toEqual(late!.original);
    expect(corrected?.corrections).toContainEqual(
      expect.objectContaining({ correctionKind: "late" }),
    );
    expect(after.summary.attendance.late).toBe(
      before.summary.attendance.late - 1,
    );
    expect(after.summary.attendance.onTime).toBe(
      before.summary.attendance.onTime + 1,
    );
  });
});
