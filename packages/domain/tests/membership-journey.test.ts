import { describe, expect, it } from "vitest";

import {
  applyGrowthAward,
  deriveExperienceCouponStatus,
  memberTierForGrowth,
  reservationGrowthAward,
} from "../src/index.js";

describe("member tiers", () => {
  it.each([
    [0, "bronze", 500, 500],
    [499, "bronze", 500, 1],
    [500, "silver", 1_500, 1_000],
    [1_499, "silver", 1_500, 1],
    [1_500, "gold", null, 0],
    [9_999, "gold", null, 0],
  ] as const)(
    "maps %i growth points to %s",
    (growthPoints, tier, nextThreshold, remainingToNext) => {
      expect(memberTierForGrowth(growthPoints)).toEqual({
        growthPoints,
        nextThreshold,
        remainingToNext,
        tier,
      });
    },
  );

  it("rejects negative or fractional lifetime growth", () => {
    expect(() => memberTierForGrowth(-1)).toThrow(RangeError);
    expect(() => memberTierForGrowth(500.5)).toThrow(RangeError);
  });
});

describe("reservation growth", () => {
  it("floors the final simulated amount after coupon and refunds", () => {
    expect(
      reservationGrowthAward({
        alreadyAwarded: false,
        payableCents: 2_499,
        refundedCents: 550,
        status: "completed",
      }),
    ).toEqual({ finalSimulatedAmountCents: 1_949, growthPoints: 19 });
  });

  it.each(["cancelled", "expired"] as const)(
    "does not award %s reservations",
    (status) => {
      expect(
        reservationGrowthAward({
          alreadyAwarded: false,
          payableCents: 2_499,
          refundedCents: 0,
          status,
        }),
      ).toBeNull();
    },
  );

  it("does not duplicate an existing completion award", () => {
    expect(
      reservationGrowthAward({
        alreadyAwarded: true,
        payableCents: 2_499,
        refundedCents: 0,
        status: "completed",
      }),
    ).toBeNull();
  });

  it("never decreases lifetime growth", () => {
    expect(applyGrowthAward(860, 19)).toBe(879);
    expect(() => applyGrowthAward(860, -1)).toThrow(RangeError);
  });
});

describe("experience coupon status", () => {
  const now = new Date("2026-08-10T12:00:00.000+08:00");

  it.each(["available", "reserved", "redeemed", "expired"] as const)(
    "preserves the stored %s state before expiry",
    (status) => {
      expect(
        deriveExperienceCouponStatus({
          now,
          status,
          validUntil: new Date("2026-08-11T12:00:00.000+08:00"),
        }),
      ).toBe(status);
    },
  );

  it("shows elapsed available and reserved coupons as expired", () => {
    for (const status of ["available", "reserved"] as const) {
      expect(
        deriveExperienceCouponStatus({
          now,
          status,
          validUntil: now,
        }),
      ).toBe("expired");
    }
  });

  it("keeps redeemed history stable after validity ends", () => {
    expect(
      deriveExperienceCouponStatus({
        now,
        status: "redeemed",
        validUntil: new Date("2026-08-09T12:00:00.000+08:00"),
      }),
    ).toBe("redeemed");
  });
});
