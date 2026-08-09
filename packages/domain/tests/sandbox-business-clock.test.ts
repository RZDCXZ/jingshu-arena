import { describe, expect, it } from "vitest";

import {
  SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
  sandboxBusinessTimeAt,
  planSandboxBusinessTimeAdvance,
} from "../src/index.js";

const minute = 60_000;
const anchor = new Date("2026-08-09T11:30:00.000Z");

describe("sandbox business clock", () => {
  it("flows at wall-clock speed from its anchor without changing the explicit advance budget", () => {
    const wallTime = new Date(anchor.getTime() + 12 * minute);

    expect(
      sandboxBusinessTimeAt({
        advancedMilliseconds: 0,
        businessAnchor: anchor,
        wallAnchor: anchor,
        wallTime,
      }),
    ).toEqual(new Date("2026-08-09T11:42:00.000Z"));
  });

  it("plans only the two allowed forward commands and accepts the exact 24-hour boundary", () => {
    const currentBusinessTime = new Date("2026-08-09T11:42:00.000Z");

    expect(
      planSandboxBusinessTimeAdvance({
        accumulatedAdvanceMilliseconds:
          SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS - 30 * minute,
        currentBusinessTime,
        mode: "half-hour",
        nextEventTime: null,
      }),
    ).toEqual({
      accumulatedAdvanceMilliseconds: SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
      advanceByMilliseconds: 30 * minute,
      afterBusinessTime: new Date("2026-08-09T12:12:00.000Z"),
      status: "ready",
    });

    expect(
      planSandboxBusinessTimeAdvance({
        accumulatedAdvanceMilliseconds: SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
        currentBusinessTime,
        mode: "half-hour",
        nextEventTime: null,
      }),
    ).toEqual({
      limitMilliseconds: SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
      status: "limit-reached",
    });

    expect(
      planSandboxBusinessTimeAdvance({
        accumulatedAdvanceMilliseconds: 0,
        currentBusinessTime,
        mode: "next-event",
        nextEventTime: new Date("2026-08-09T11:54:00.000Z"),
      }),
    ).toEqual({
      accumulatedAdvanceMilliseconds: 12 * minute,
      advanceByMilliseconds: 12 * minute,
      afterBusinessTime: new Date("2026-08-09T11:54:00.000Z"),
      status: "ready",
    });
  });

  it("does not invent a next event when no registered handler has one", () => {
    expect(
      planSandboxBusinessTimeAdvance({
        accumulatedAdvanceMilliseconds: 0,
        currentBusinessTime: anchor,
        mode: "next-event",
        nextEventTime: null,
      }),
    ).toEqual({ status: "no-next-event" });
  });
});
