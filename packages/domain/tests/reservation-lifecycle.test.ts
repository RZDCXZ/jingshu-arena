import { describe, expect, it } from "vitest";

import { decideReservationLifecycle } from "../src/index.js";

const base = {
  businessTime: new Date("2026-08-10T11:50:00.000Z"),
  hasCoupon: true,
  holdExpiresAt: new Date("2026-08-10T12:00:00.000Z"),
  payableCents: 3_000,
  startsAt: new Date("2026-08-10T12:30:00.000Z"),
} as const;

describe("reservation lifecycle rules", () => {
  it("confirms a live hold using only the immutable payable snapshot", () => {
    expect(
      decideReservationLifecycle({
        ...base,
        action: "simulate-payment",
        status: "pending-confirmation",
      }),
    ).toEqual({
      couponEffect: "redeem",
      nextStatus: "confirmed",
      simulatedPaymentCents: 3_000,
      simulatedRefundCents: 0,
      status: "ready",
    });
  });

  it("expires a pending hold exactly at ten minutes and never refunds an unpaid reservation", () => {
    expect(
      decideReservationLifecycle({
        ...base,
        action: "expire-hold",
        businessTime: new Date("2026-08-10T11:59:59.999Z"),
        status: "pending-confirmation",
      }),
    ).toEqual({ reason: "not-due", status: "invalid" });
    expect(
      decideReservationLifecycle({
        ...base,
        action: "expire-hold",
        businessTime: base.holdExpiresAt,
        status: "pending-confirmation",
      }),
    ).toEqual({
      couponEffect: "release",
      nextStatus: "expired",
      simulatedPaymentCents: 0,
      simulatedRefundCents: 0,
      status: "ready",
    });
  });

  it("expires a confirmed no-show exactly fifteen minutes after start with a full simulated refund", () => {
    expect(
      decideReservationLifecycle({
        ...base,
        action: "expire-no-show",
        businessTime: new Date("2026-08-10T12:44:59.999Z"),
        status: "confirmed",
      }),
    ).toEqual({ reason: "not-due", status: "invalid" });
    expect(
      decideReservationLifecycle({
        ...base,
        action: "expire-no-show",
        businessTime: new Date("2026-08-10T12:45:00.000Z"),
        status: "confirmed",
      }),
    ).toEqual({
      couponEffect: "restore",
      nextStatus: "expired",
      simulatedPaymentCents: 0,
      simulatedRefundCents: 3_000,
      status: "ready",
    });
  });

  it("cancels unpaid holds without a refund and paid reservations before start with a full refund", () => {
    expect(
      decideReservationLifecycle({
        ...base,
        action: "cancel",
        status: "pending-confirmation",
      }),
    ).toEqual({
      couponEffect: "release",
      nextStatus: "cancelled",
      simulatedPaymentCents: 0,
      simulatedRefundCents: 0,
      status: "ready",
    });
    expect(
      decideReservationLifecycle({
        ...base,
        action: "cancel",
        status: "confirmed",
      }),
    ).toEqual({
      couponEffect: "restore",
      nextStatus: "cancelled",
      simulatedPaymentCents: 0,
      simulatedRefundCents: 3_000,
      status: "ready",
    });
  });

  it("rejects payment after the hold boundary, cancellation at start, and all terminal transitions", () => {
    expect(
      decideReservationLifecycle({
        ...base,
        action: "simulate-payment",
        businessTime: base.holdExpiresAt,
        status: "pending-confirmation",
      }),
    ).toEqual({ reason: "hold-expired", status: "invalid" });
    expect(
      decideReservationLifecycle({
        ...base,
        action: "cancel",
        businessTime: base.startsAt,
        status: "confirmed",
      }),
    ).toEqual({ reason: "reservation-started", status: "invalid" });

    for (const status of ["completed", "cancelled", "expired"] as const) {
      expect(
        decideReservationLifecycle({
          ...base,
          action: "cancel",
          status,
        }),
      ).toEqual({ reason: "illegal-transition", status: "invalid" });
    }
  });

  it("does not invent coupon effects when the reservation has no coupon", () => {
    expect(
      decideReservationLifecycle({
        ...base,
        action: "simulate-payment",
        hasCoupon: false,
        status: "pending-confirmation",
      }),
    ).toMatchObject({ couponEffect: null, status: "ready" });
  });
});
