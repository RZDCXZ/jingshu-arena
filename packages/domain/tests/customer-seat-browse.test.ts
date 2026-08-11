import { describe, expect, it } from "vitest";

import {
  businessDayRange,
  businessDayKey,
  deriveSeatAvailability,
  evaluateReservationCoupon,
  pricePlanEffectiveRangesOverlap,
  priceReservationWindow,
  priceReservationWindowForPlan,
  resolveCustomerReservationWindow,
  selectPricePlanVersion,
} from "../src/index.js";

const hour = 60 * 60 * 1_000;

describe("customer reservation browsing rules", () => {
  it("keeps the Shanghai 06:00 business-day boundary across midnight", () => {
    expect(businessDayKey(new Date("2026-08-09T21:59:59.000Z"))).toBe(
      "2026-08-09",
    );
    expect(businessDayKey(new Date("2026-08-09T22:00:00.000Z"))).toBe(
      "2026-08-10",
    );
    expect(businessDayRange(new Date("2026-08-09T21:59:59.000Z"))).toEqual({
      endsAt: new Date("2026-08-09T22:00:00.000Z"),
      key: "2026-08-09",
      startsAt: new Date("2026-08-08T22:00:00.000Z"),
    });
  });

  it("starts an immediate reservation at the current half-hour segment", () => {
    expect(
      resolveCustomerReservationWindow({
        businessHours: {
          closesAt: "00:00",
          closesNextDay: false,
          isOpen24Hours: true,
          opensAt: "00:00",
        },
        durationHours: 2,
        mode: "immediate",
        now: new Date("2026-08-10T11:47:23.000Z"),
      }),
    ).toEqual({
      endsAt: new Date("2026-08-10T13:30:00.000Z"),
      startsAt: new Date("2026-08-10T11:30:00.000Z"),
      status: "ready",
    });
  });

  it("accepts a future cross-midnight window inside store hours and rejects one past closing", () => {
    const businessHours = {
      closesAt: "02:00",
      closesNextDay: true,
      isOpen24Hours: false,
      opensAt: "10:00",
    } as const;
    const now = new Date("2026-08-10T02:00:00.000Z");

    expect(
      resolveCustomerReservationWindow({
        businessHours,
        durationHours: 2,
        mode: "future",
        now,
        requestedStartsAt: new Date("2026-08-10T15:30:00.000Z"),
      }),
    ).toMatchObject({ status: "ready" });
    expect(
      resolveCustomerReservationWindow({
        businessHours,
        durationHours: 2,
        mode: "future",
        now,
        requestedStartsAt: new Date("2026-08-10T17:00:00.000Z"),
      }),
    ).toEqual({ reason: "outside-business-hours", status: "invalid" });
  });

  it("requires future starts to be half-hour aligned, one to eight hours, and within seven days", () => {
    const base = {
      businessHours: {
        closesAt: "00:00",
        closesNextDay: false,
        isOpen24Hours: true,
        opensAt: "00:00",
      },
      mode: "future" as const,
      now: new Date("2026-08-10T02:00:00.000Z"),
    };

    expect(
      resolveCustomerReservationWindow({
        ...base,
        durationHours: 2,
        requestedStartsAt: new Date("2026-08-10T03:15:00.000Z"),
      }),
    ).toEqual({ reason: "half-hour-alignment", status: "invalid" });
    expect(
      resolveCustomerReservationWindow({
        ...base,
        durationHours: 9,
        requestedStartsAt: new Date("2026-08-10T03:30:00.000Z"),
      }),
    ).toEqual({ reason: "duration", status: "invalid" });
    expect(
      resolveCustomerReservationWindow({
        ...base,
        durationHours: 1,
        requestedStartsAt: new Date("2026-08-17T02:30:00.000Z"),
      }),
    ).toEqual({ reason: "seven-day-window", status: "invalid" });
  });

  it("derives maintenance, in-use and reserved results without persisting availability", () => {
    const startsAt = new Date("2026-08-10T11:30:00.000Z");
    const endsAt = new Date(startsAt.getTime() + 2 * hour);
    const reservations = [
      {
        endsAt: new Date("2026-08-10T12:30:00.000Z"),
        startsAt: new Date("2026-08-10T11:00:00.000Z"),
        status: "confirmed" as const,
      },
    ];

    expect(
      deriveSeatAvailability({
        endsAt,
        operationalStatus: "maintenance",
        reservations: [],
        startsAt,
      }),
    ).toBe("maintenance");
    expect(
      deriveSeatAvailability({
        endsAt,
        operationalStatus: "normal",
        reservations: [{ ...reservations[0]!, status: "in-use" }],
        startsAt,
      }),
    ).toBe("in-use");
    expect(
      deriveSeatAvailability({
        endsAt,
        operationalStatus: "normal",
        reservations,
        startsAt,
      }),
    ).toBe("reserved");
    expect(
      deriveSeatAvailability({
        endsAt,
        operationalStatus: "normal",
        reservations: [
          {
            endsAt: startsAt,
            startsAt: new Date(startsAt.getTime() - hour),
            status: "confirmed",
          },
        ],
        startsAt,
      }),
    ).toBe("available");
  });

  it("prices every half-hour in integer cents across weekday, weekend and midnight rules", () => {
    const weekday = priceReservationWindow({
      baseHourlyCents: 1_500,
      endsAt: new Date("2026-08-10T11:00:00.000Z"),
      startsAt: new Date("2026-08-10T09:00:00.000Z"),
    });
    expect(weekday.segments.map((segment) => segment.amountCents)).toEqual([
      750, 750, 900, 900,
    ]);
    expect(weekday.totalCents).toBe(3_300);

    const weekend = priceReservationWindow({
      baseHourlyCents: 1_500,
      endsAt: new Date("2026-08-09T14:00:00.000Z"),
      startsAt: new Date("2026-08-09T12:00:00.000Z"),
    });
    expect(weekend.segments.map((segment) => segment.amountCents)).toEqual([
      863, 863, 863, 863,
    ]);
    expect(weekend.totalCents).toBe(3_452);

    const midnight = priceReservationWindow({
      baseHourlyCents: 1_500,
      endsAt: new Date("2026-08-10T17:00:00.000Z"),
      startsAt: new Date("2026-08-10T15:00:00.000Z"),
    });
    expect(midnight.segments.map((segment) => segment.rule)).toEqual([
      "weekday-evening",
      "weekday-evening",
      "weekday-overnight",
      "weekday-overnight",
    ]);
    expect(midnight.segments.map((segment) => segment.amountCents)).toEqual([
      900, 900, 675, 675,
    ]);
  });

  it("selects the latest effective non-archived price-plan version", () => {
    const plans = [
      {
        effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
        effectiveUntil: new Date("2026-08-15T00:00:00.000Z"),
        id: "v1",
        status: "active" as const,
        version: 1,
      },
      {
        effectiveFrom: new Date("2026-08-15T00:00:00.000Z"),
        effectiveUntil: null,
        id: "v2",
        status: "active" as const,
        version: 2,
      },
      {
        effectiveFrom: new Date("2026-08-20T00:00:00.000Z"),
        effectiveUntil: null,
        id: "archived-v3",
        status: "archived" as const,
        version: 3,
      },
    ];

    expect(
      selectPricePlanVersion(plans, new Date("2026-08-14T23:59:59.000Z"))?.id,
    ).toBe("v1");
    expect(
      selectPricePlanVersion(plans, new Date("2026-08-15T00:00:00.000Z"))?.id,
    ).toBe("v2");
  });

  it("detects overlapping effective intervals with an exclusive end", () => {
    const existing = {
      effectiveFrom: new Date("2026-08-15T00:00:00.000Z"),
      effectiveUntil: new Date("2026-09-01T00:00:00.000Z"),
    };

    expect(
      pricePlanEffectiveRangesOverlap(existing, {
        effectiveFrom: new Date("2026-08-20T00:00:00.000Z"),
        effectiveUntil: null,
      }),
    ).toBe(true);
    expect(
      pricePlanEffectiveRangesOverlap(existing, {
        effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
        effectiveUntil: null,
      }),
    ).toBe(false);
  });

  it("prices a cross-midnight plan by the 06:00 Shanghai business day", () => {
    const fridayOvernight = priceReservationWindowForPlan({
      endsAt: new Date("2026-08-14T17:30:00.000Z"),
      plan: {
        endsAt: "06:00",
        endsNextDay: true,
        startsAt: "18:00",
        weekdayHalfHourCents: 900,
        weekendHalfHourCents: 1_100,
      },
      startsAt: new Date("2026-08-14T15:30:00.000Z"),
    });
    expect(fridayOvernight.segments.map((segment) => segment.rule)).toEqual([
      "weekday-base",
      "weekday-base",
      "weekday-base",
      "weekday-base",
    ]);
    expect(
      fridayOvernight.segments.map((segment) => segment.amountCents),
    ).toEqual([900, 900, 900, 900]);
    expect(fridayOvernight.totalCents).toBe(3_600);

    const saturdayNight = priceReservationWindowForPlan({
      endsAt: new Date("2026-08-15T17:00:00.000Z"),
      plan: {
        endsAt: "06:00",
        endsNextDay: true,
        startsAt: "18:00",
        weekdayHalfHourCents: 900,
        weekendHalfHourCents: 1_100,
      },
      startsAt: new Date("2026-08-15T15:00:00.000Z"),
    });
    expect(saturdayNight.segments.map((segment) => segment.rule)).toEqual([
      "weekend",
      "weekend",
      "weekend",
      "weekend",
    ]);
    expect(saturdayNight.totalCents).toBe(4_400);
  });

  it("explains coupon eligibility and caps a reservation discount at zero payable", () => {
    const base = {
      businessKind: "reservation" as const,
      coupon: {
        businessKind: "reservation" as const,
        discountCents: 4_000,
        eligibleEndMinutes: 24 * 60,
        eligibleStartMinutes: 0,
        minimumSpendCents: 2_000,
        status: "available" as const,
        storeCode: "prism-flagship",
        validFrom: new Date("2026-08-01T00:00:00.000Z"),
        validUntil: new Date("2026-08-31T00:00:00.000Z"),
      },
      endsAt: new Date("2026-08-10T13:30:00.000Z"),
      now: new Date("2026-08-10T11:47:23.000Z"),
      startsAt: new Date("2026-08-10T11:30:00.000Z"),
      storeCode: "prism-flagship",
      subtotalCents: 3_600,
    };

    expect(evaluateReservationCoupon(base)).toEqual({
      discountCents: 3_600,
      payableCents: 0,
      status: "eligible",
    });
    expect(
      evaluateReservationCoupon({
        ...base,
        storeCode: "starbridge-standard",
      }),
    ).toEqual({ reason: "store", status: "ineligible" });
    expect(
      evaluateReservationCoupon({
        ...base,
        coupon: { ...base.coupon, minimumSpendCents: 5_000 },
      }),
    ).toEqual({ reason: "minimum-spend", status: "ineligible" });
    expect(
      evaluateReservationCoupon({
        ...base,
        coupon: {
          ...base.coupon,
          eligibleEndMinutes: 21 * 60,
          eligibleStartMinutes: 20 * 60,
        },
      }),
    ).toEqual({ reason: "time-window", status: "ineligible" });
    expect(
      evaluateReservationCoupon({
        ...base,
        coupon: {
          ...base.coupon,
          eligibleEndMinutes: 2 * 60,
          eligibleStartMinutes: 20 * 60,
        },
        endsAt: new Date("2026-08-10T18:00:00.000Z"),
        startsAt: new Date("2026-08-10T15:00:00.000Z"),
      }),
    ).toMatchObject({ status: "eligible" });
    expect(
      evaluateReservationCoupon({
        ...base,
        coupon: {
          ...base.coupon,
          eligibleEndMinutes: 2 * 60,
          eligibleStartMinutes: 20 * 60,
        },
        endsAt: new Date("2026-08-10T20:00:00.000Z"),
        startsAt: new Date("2026-08-10T15:00:00.000Z"),
      }),
    ).toEqual({ reason: "time-window", status: "ineligible" });
  });
});
