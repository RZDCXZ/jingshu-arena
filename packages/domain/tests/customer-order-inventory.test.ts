import { describe, expect, it } from "vitest";

import {
  decideCustomerOrderLifecycle,
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
  });
});
