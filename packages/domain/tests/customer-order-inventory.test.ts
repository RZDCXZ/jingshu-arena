import { describe, expect, it } from "vitest";

import {
  decideCustomerOrderLifecycle,
  decideStaffOrderFulfillment,
  priceCustomerOrder,
} from "../src/index.js";

const lines = [
  {
    availableQuantity: 5,
    productId: "spark",
    productName: "脉冲气泡水",
    quantity: 2,
    unitPriceCents: 800,
  },
  {
    availableQuantity: 7,
    productId: "chips",
    productName: "夜航薯片",
    quantity: 1,
    unitPriceCents: 1_000,
  },
] as const;

describe("customer order inventory rules", () => {
  it("advances a paid order to preparing without consuming its reservation", () => {
    expect(
      decideStaffOrderFulfillment({
        action: "start-preparing",
        finalSimulatedAmountCents: 2_100,
        status: "simulated-paid",
      }),
    ).toEqual({
      couponEffect: "none",
      growthPoints: 0,
      inventoryEffect: "retain",
      nextStatus: "preparing",
      simulatedRefundCents: 0,
      status: "applied",
    });
  });

  it("marks only a preparing order ready for pickup", () => {
    expect(
      decideStaffOrderFulfillment({
        action: "mark-ready",
        finalSimulatedAmountCents: 2_100,
        status: "preparing",
      }),
    ).toEqual({
      couponEffect: "none",
      growthPoints: 0,
      inventoryEffect: "retain",
      nextStatus: "ready-for-pickup",
      simulatedRefundCents: 0,
      status: "applied",
    });
  });

  it("completes only a ready order as a sale and awards growth from its final simulated amount", () => {
    expect(
      decideStaffOrderFulfillment({
        action: "complete",
        finalSimulatedAmountCents: 2_199,
        status: "ready-for-pickup",
      }),
    ).toEqual({
      couponEffect: "none",
      growthPoints: 21,
      inventoryEffect: "sale",
      nextStatus: "completed",
      simulatedRefundCents: 0,
      status: "applied",
    });
  });

  it("releases pre-production cancellations and records post-production cancellations as waste", () => {
    expect(
      decideStaffOrderFulfillment({
        action: "cancel",
        finalSimulatedAmountCents: 2_100,
        status: "pending-simulated-payment",
      }),
    ).toEqual({
      couponEffect: "restore",
      growthPoints: 0,
      inventoryEffect: "release",
      nextStatus: "cancelled",
      simulatedRefundCents: 0,
      status: "applied",
    });
    expect(
      decideStaffOrderFulfillment({
        action: "cancel",
        finalSimulatedAmountCents: 2_100,
        status: "simulated-paid",
      }),
    ).toEqual({
      couponEffect: "restore",
      growthPoints: 0,
      inventoryEffect: "release",
      nextStatus: "cancelled",
      simulatedRefundCents: 2_100,
      status: "applied",
    });
    for (const status of ["preparing", "ready-for-pickup"] as const) {
      expect(
        decideStaffOrderFulfillment({
          action: "cancel",
          finalSimulatedAmountCents: 2_100,
          status,
        }),
      ).toEqual({
        couponEffect: "none",
        growthPoints: 0,
        inventoryEffect: "waste",
        nextStatus: "cancelled",
        simulatedRefundCents: 2_100,
        status: "applied",
      });
    }
  });

  it("rejects every skipped or repeated staff transition across all seven statuses", () => {
    const statuses = [
      "pending-simulated-payment",
      "simulated-paid",
      "preparing",
      "ready-for-pickup",
      "completed",
      "cancelled",
      "expired",
    ] as const;
    const actions = [
      "start-preparing",
      "mark-ready",
      "complete",
      "cancel",
    ] as const;
    const legal = new Set([
      "pending-simulated-payment:cancel",
      "simulated-paid:start-preparing",
      "simulated-paid:cancel",
      "preparing:mark-ready",
      "preparing:cancel",
      "ready-for-pickup:complete",
      "ready-for-pickup:cancel",
    ]);
    for (const status of statuses) {
      for (const action of actions) {
        const result = decideStaffOrderFulfillment({
          action,
          finalSimulatedAmountCents: 2_100,
          status,
        });
        expect(result.status, `${status}:${action}`).toBe(
          legal.has(`${status}:${action}`) ? "applied" : "invalid",
        );
      }
    }
  });

  it("prices one immutable whole-cart snapshot with at most one fixed coupon", () => {
    expect(priceCustomerOrder({ couponDiscountCents: 500, lines })).toEqual({
      discountCents: 500,
      lines: [
        {
          lineTotalCents: 1_600,
          productId: "spark",
          productName: "脉冲气泡水",
          quantity: 2,
          unitPriceCents: 800,
        },
        {
          lineTotalCents: 1_000,
          productId: "chips",
          productName: "夜航薯片",
          quantity: 1,
          unitPriceCents: 1_000,
        },
      ],
      payableCents: 2_100,
      status: "ready",
      subtotalCents: 2_600,
    });
  });

  it("rejects the whole cart before any side effect when a quantity is invalid or unavailable", () => {
    expect(
      priceCustomerOrder({
        couponDiscountCents: 0,
        lines: [{ ...lines[0], quantity: 0 }],
      }),
    ).toEqual({ reason: "invalid-quantity", status: "invalid" });
    expect(
      priceCustomerOrder({
        couponDiscountCents: 0,
        lines: [{ ...lines[0], availableQuantity: 1 }],
      }),
    ).toEqual({
      productId: "spark",
      reason: "insufficient-inventory",
      status: "invalid",
    });
  });

  it("expires or reservation-cancels only unpaid orders and keeps paid orders independent", () => {
    const holdExpiresAt = new Date("2026-08-10T12:00:00.000Z");
    expect(
      decideCustomerOrderLifecycle({
        action: "expire",
        businessTime: holdExpiresAt,
        holdExpiresAt,
        status: "pending-simulated-payment",
      }),
    ).toEqual({
      couponEffect: "release",
      inventoryEffect: "release",
      nextStatus: "expired",
      status: "applied",
    });
    expect(
      decideCustomerOrderLifecycle({
        action: "reservation-terminal",
        businessTime: new Date("2026-08-10T11:55:00.000Z"),
        holdExpiresAt,
        status: "pending-simulated-payment",
      }),
    ).toEqual({
      couponEffect: "release",
      inventoryEffect: "release",
      nextStatus: "cancelled",
      status: "applied",
    });
    expect(
      decideCustomerOrderLifecycle({
        action: "reservation-terminal",
        businessTime: new Date("2026-08-10T11:55:00.000Z"),
        holdExpiresAt,
        status: "simulated-paid",
      }),
    ).toEqual({
      reason: "paid-order-independent",
      status: "unchanged",
    });
  });

  it("allows payment and customer cancellation only while the ten-minute hold is live", () => {
    const holdExpiresAt = new Date("2026-08-10T12:00:00.000Z");
    expect(
      decideCustomerOrderLifecycle({
        action: "simulate-payment",
        businessTime: new Date("2026-08-10T11:59:59.999Z"),
        holdExpiresAt,
        status: "pending-simulated-payment",
      }),
    ).toEqual({
      couponEffect: "redeem",
      inventoryEffect: "retain",
      nextStatus: "simulated-paid",
      status: "applied",
    });
    expect(
      decideCustomerOrderLifecycle({
        action: "cancel",
        businessTime: new Date("2026-08-10T11:59:59.999Z"),
        holdExpiresAt,
        status: "pending-simulated-payment",
      }),
    ).toEqual({
      couponEffect: "release",
      inventoryEffect: "release",
      nextStatus: "cancelled",
      status: "applied",
    });
    expect(
      decideCustomerOrderLifecycle({
        action: "simulate-payment",
        businessTime: holdExpiresAt,
        holdExpiresAt,
        status: "pending-simulated-payment",
      }),
    ).toEqual({ reason: "hold-expired", status: "invalid" });
    expect(
      decideCustomerOrderLifecycle({
        action: "cancel",
        businessTime: new Date("2026-08-10T12:01:00.000Z"),
        holdExpiresAt,
        status: "simulated-paid",
      }),
    ).toEqual({
      couponEffect: "release",
      inventoryEffect: "release",
      nextStatus: "cancelled",
      status: "applied",
    });
  });
});
