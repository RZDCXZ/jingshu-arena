import { describe, expect, it } from "vitest";

import {
  calculateManagerDashboardMetrics,
  managerDashboardBusinessDays,
} from "../src/index.js";

describe("manager dashboard rules", () => {
  it("offers exactly the latest fourteen Shanghai 06:00 business days", () => {
    const days = managerDashboardBusinessDays(
      new Date("2026-08-10T21:59:59.000Z"),
    );

    expect(days).toHaveLength(14);
    expect(days[0]).toEqual({
      endsAt: new Date("2026-07-28T22:00:00.000Z"),
      key: "2026-07-28",
      startsAt: new Date("2026-07-27T22:00:00.000Z"),
    });
    expect(days[13]).toEqual({
      endsAt: new Date("2026-08-10T22:00:00.000Z"),
      key: "2026-08-10",
      startsAt: new Date("2026-08-09T22:00:00.000Z"),
    });
  });

  it("calculates revenue, independent seat denominators, orders, repairs and people from fixed facts", () => {
    const result = calculateManagerDashboardMetrics({
      activeSeatCount: 2,
      attendance: [
        {
          businessOccurredAt: new Date("2026-08-09T20:00:00.000Z"),
          outcome: "on-time",
        },
        {
          businessOccurredAt: new Date("2026-08-09T20:30:00.000Z"),
          outcome: "late",
        },
        {
          businessOccurredAt: new Date("2026-08-10T01:00:00.000Z"),
          outcome: "absent",
        },
      ],
      businessDays: [
        {
          endsAt: new Date("2026-08-09T22:00:00.000Z"),
          key: "2026-08-09",
          opensAt: new Date("2026-08-08T22:00:00.000Z"),
          startsAt: new Date("2026-08-08T22:00:00.000Z"),
        },
        {
          endsAt: new Date("2026-08-10T22:00:00.000Z"),
          key: "2026-08-10",
          opensAt: new Date("2026-08-09T22:00:00.000Z"),
          startsAt: new Date("2026-08-09T22:00:00.000Z"),
        },
      ],
      currentTime: new Date("2026-08-10T03:10:00.000Z"),
      handoverExceptions: [
        { businessOccurredAt: new Date("2026-08-09T20:00:00.000Z") },
        { businessOccurredAt: new Date("2026-08-10T01:00:00.000Z") },
      ],
      inventory: { lowStockCount: 3 },
      orders: [
        {
          completedAt: new Date("2026-08-09T22:10:00.000Z"),
          createdAt: new Date("2026-08-09T21:00:00.000Z"),
          paidCents: 1_500,
          refundCents: 200,
          status: "completed",
          terminalAt: new Date("2026-08-09T22:10:00.000Z"),
          wasteCents: 0,
          wasteQuantity: 0,
        },
        {
          completedAt: null,
          createdAt: new Date("2026-08-09T21:10:00.000Z"),
          paidCents: 500,
          refundCents: 500,
          status: "cancelled",
          terminalAt: new Date("2026-08-09T22:20:00.000Z"),
          wasteCents: 500,
          wasteQuantity: 2,
        },
        {
          completedAt: null,
          createdAt: new Date("2026-08-09T21:20:00.000Z"),
          paidCents: null,
          refundCents: 0,
          status: "expired",
          terminalAt: new Date("2026-08-09T22:30:00.000Z"),
          wasteCents: 0,
          wasteQuantity: 0,
        },
        {
          completedAt: null,
          createdAt: new Date("2026-08-10T01:30:00.000Z"),
          paidCents: 800,
          refundCents: 0,
          status: "preparing",
          terminalAt: null,
          wasteCents: 0,
          wasteQuantity: 0,
        },
        {
          completedAt: new Date("2026-08-08T12:00:00.000Z"),
          createdAt: new Date("2026-08-08T11:00:00.000Z"),
          paidCents: 9_900,
          refundCents: 0,
          status: "completed",
          terminalAt: new Date("2026-08-08T12:00:00.000Z"),
          wasteCents: 0,
          wasteQuantity: 0,
        },
      ],
      repairs: [
        {
          closedAt: new Date("2026-08-09T23:00:00.000Z"),
          createdAt: new Date("2026-08-09T21:00:00.000Z"),
          priority: "urgent",
          processingAt: new Date("2026-08-09T21:30:00.000Z"),
        },
        {
          closedAt: new Date("2026-08-10T01:20:00.000Z"),
          createdAt: new Date("2026-08-10T01:00:00.000Z"),
          priority: "normal",
          processingAt: new Date("2026-08-10T01:05:00.000Z"),
        },
        {
          closedAt: null,
          createdAt: new Date("2026-08-10T02:00:00.000Z"),
          priority: "high",
          processingAt: new Date("2026-08-10T02:10:00.000Z"),
        },
      ],
      reservations: [
        {
          completedAt: new Date("2026-08-09T22:00:00.000Z"),
          paidCents: 2_000,
          priceSegments: [
            {
              amountCents: 1_000,
              endsAt: new Date("2026-08-09T22:00:00.000Z"),
              startsAt: new Date("2026-08-09T21:30:00.000Z"),
            },
            {
              amountCents: 1_000,
              endsAt: new Date("2026-08-09T22:30:00.000Z"),
              startsAt: new Date("2026-08-09T22:00:00.000Z"),
            },
          ],
          refundCents: 1_000,
          refundFrom: new Date("2026-08-09T22:00:00.000Z"),
          startedAt: new Date("2026-08-09T21:30:00.000Z"),
          status: "completed",
        },
      ],
    });

    expect(result.summary).toEqual({
      attendance: { absent: 1, late: 1, onTime: 1 },
      handoverExceptionCount: 2,
      inventory: { lowStockCount: 3 },
      orders: {
        backlogCount: 1,
        completedCount: 1,
        completionRateBasisPoints: 5_000,
        eligibleTerminalCount: 2,
        wasteCents: 500,
        wasteQuantity: 2,
      },
      repairs: {
        maintenanceMinutes: 165,
        medianResolutionMinutes: 70,
        openByPriority: { high: 1, normal: 0, urgent: 0 },
        openCount: 1,
      },
      revenue: {
        orderCents: 1_300,
        reservationCents: 1_000,
        totalCents: 2_300,
      },
      seats: {
        businessSeatMinutes: 5_760,
        maintenanceMinutes: 165,
        maintenanceRateBasisPoints: 286,
        normalSeatMinutes: 5_595,
        operationalUtilizationBasisPoints: 54,
        usedMinutes: 30,
      },
    });
    expect(result.days.map((day) => day.revenue)).toEqual([
      { orderCents: 0, reservationCents: 1_000, totalCents: 1_000 },
      { orderCents: 1_300, reservationCents: 0, totalCents: 1_300 },
    ]);
  });
});
