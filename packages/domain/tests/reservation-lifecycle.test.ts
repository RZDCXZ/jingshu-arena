import { describe, expect, it } from "vitest";

import {
  decideFrontlineReservationLifecycle,
  decideReservationLifecycle,
  RESERVATION_STATUSES,
  type FrontlineReservationAction,
} from "../src/index.js";

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

const frontlineBase = {
  businessTime: new Date("2026-08-10T12:30:00.000Z"),
  endsAt: new Date("2026-08-10T14:30:00.000Z"),
  hasCoupon: true,
  holdExpiresAt: new Date("2026-08-10T12:40:00.000Z"),
  payableCents: 3_000,
  startsAt: new Date("2026-08-10T12:30:00.000Z"),
} as const;

describe("frontline reservation lifecycle rules", () => {
  it("allows arrival from the inclusive opening until the no-show boundary", () => {
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "arrive",
        businessTime: new Date("2026-08-10T12:00:00.000Z"),
        status: "confirmed",
      }),
    ).toMatchObject({ nextStatus: "arrived", status: "ready" });
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "arrive",
        businessTime: new Date("2026-08-10T11:59:59.999Z"),
        status: "confirmed",
      }),
    ).toEqual({ reason: "arrival-window-not-open", status: "invalid" });
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "arrive",
        businessTime: new Date("2026-08-10T12:44:59.999Z"),
        status: "confirmed",
      }),
    ).toMatchObject({ nextStatus: "arrived", status: "ready" });
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "arrive",
        businessTime: new Date("2026-08-10T12:45:00.000Z"),
        status: "confirmed",
      }),
    ).toEqual({ reason: "arrival-window-closed", status: "invalid" });
  });

  it("starts only an arrived reservation from planned start until planned end", () => {
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "start-use",
        businessTime: new Date("2026-08-10T12:29:59.999Z"),
        status: "arrived",
      }),
    ).toEqual({ reason: "reservation-not-started", status: "invalid" });
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "start-use",
        status: "arrived",
      }),
    ).toMatchObject({ nextStatus: "in-use", status: "ready" });
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "start-use",
        businessTime: frontlineBase.endsAt,
        status: "arrived",
      }),
    ).toEqual({ reason: "reservation-ended", status: "invalid" });
  });

  it("separates reasoned early completion from exact-boundary automatic completion", () => {
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "complete-early",
        status: "in-use",
      }),
    ).toMatchObject({ nextStatus: "completed", status: "ready" });
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "complete-early",
        businessTime: frontlineBase.endsAt,
        status: "in-use",
      }),
    ).toEqual({ reason: "reservation-ended", status: "invalid" });
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "complete-auto",
        businessTime: new Date("2026-08-10T14:29:59.999Z"),
        status: "in-use",
      }),
    ).toEqual({ reason: "not-due", status: "invalid" });
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "complete-auto",
        businessTime: frontlineBase.endsAt,
        status: "in-use",
      }),
    ).toMatchObject({ nextStatus: "completed", status: "ready" });
  });

  it("cancels every pre-use state with snapshot-derived coupon and refund effects", () => {
    expect(
      decideFrontlineReservationLifecycle({
        ...frontlineBase,
        action: "cancel",
        status: "pending-confirmation",
      }),
    ).toMatchObject({
      couponEffect: "release",
      nextStatus: "cancelled",
      simulatedRefundCents: 0,
      status: "ready",
    });
    for (const status of ["confirmed", "arrived"] as const) {
      expect(
        decideFrontlineReservationLifecycle({
          ...frontlineBase,
          action: "cancel",
          status,
        }),
      ).toMatchObject({
        couponEffect: "restore",
        nextStatus: "cancelled",
        simulatedRefundCents: 3_000,
        status: "ready",
      });
    }
  });

  it("exhaustively allows only the action/status pairs defined by the contract", () => {
    const actions: ReadonlyArray<FrontlineReservationAction> = [
      "arrive",
      "start-use",
      "complete-early",
      "complete-auto",
      "cancel",
    ];
    const allowed = new Set([
      "arrive:confirmed",
      "start-use:arrived",
      "complete-early:in-use",
      "complete-auto:in-use",
      "cancel:pending-confirmation",
      "cancel:confirmed",
      "cancel:arrived",
    ]);

    for (const action of actions) {
      for (const status of RESERVATION_STATUSES) {
        const result = decideFrontlineReservationLifecycle({
          ...frontlineBase,
          action,
          businessTime:
            action === "complete-auto"
              ? frontlineBase.endsAt
              : frontlineBase.businessTime,
          status,
        });
        expect(result.status, `${action}:${status}`).toBe(
          allowed.has(`${action}:${status}`) ? "ready" : "invalid",
        );
      }
    }
  });
});
