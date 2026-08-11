import { describe, expect, it } from "vitest";

import {
  decideAttendanceAction,
  evaluateStaffCoverage,
  validateShiftSchedule,
} from "../src/index.js";

describe("staff shift scheduling", () => {
  it("accepts an aligned cross-midnight shift and rejects misalignment, duration and overlap", () => {
    const startsAt = new Date("2026-08-10T20:00:00.000Z");
    const endsAt = new Date("2026-08-11T04:00:00.000Z");

    expect(
      validateShiftSchedule({ endsAt, existingWindows: [], startsAt }),
    ).toEqual({ status: "valid" });
    expect(
      validateShiftSchedule({
        endsAt,
        existingWindows: [],
        startsAt: new Date("2026-08-10T20:15:00.000Z"),
      }),
    ).toEqual({ reason: "half-hour-alignment", status: "invalid" });
    expect(
      validateShiftSchedule({
        endsAt: new Date("2026-08-10T23:30:00.000Z"),
        existingWindows: [],
        startsAt,
      }),
    ).toEqual({ reason: "duration", status: "invalid" });
    expect(
      validateShiftSchedule({
        endsAt,
        existingWindows: [
          {
            endsAt: new Date("2026-08-10T21:00:00.000Z"),
            startsAt: new Date("2026-08-10T19:00:00.000Z"),
          },
        ],
        startsAt,
      }),
    ).toEqual({ reason: "overlap", status: "invalid" });
  });

  it("returns savable half-hour coverage warnings without treating them as validation errors", () => {
    expect(
      evaluateStaffCoverage({
        minimumStaff: 3,
        range: {
          endsAt: new Date("2026-08-11T02:00:00.000Z"),
          startsAt: new Date("2026-08-10T23:00:00.000Z"),
        },
        shifts: [
          {
            endsAt: new Date("2026-08-11T01:00:00.000Z"),
            startsAt: new Date("2026-08-10T22:00:00.000Z"),
          },
          {
            endsAt: new Date("2026-08-11T00:30:00.000Z"),
            startsAt: new Date("2026-08-10T23:00:00.000Z"),
          },
          {
            endsAt: new Date("2026-08-11T02:00:00.000Z"),
            startsAt: new Date("2026-08-11T00:00:00.000Z"),
          },
        ],
      }),
    ).toEqual([
      {
        actualStaff: 2,
        endsAt: new Date("2026-08-11T00:00:00.000Z"),
        minimumStaff: 3,
        startsAt: new Date("2026-08-10T23:00:00.000Z"),
      },
      {
        actualStaff: 2,
        endsAt: new Date("2026-08-11T01:00:00.000Z"),
        minimumStaff: 3,
        startsAt: new Date("2026-08-11T00:30:00.000Z"),
      },
      {
        actualStaff: 1,
        endsAt: new Date("2026-08-11T02:00:00.000Z"),
        minimumStaff: 3,
        startsAt: new Date("2026-08-11T01:00:00.000Z"),
      },
    ]);
  });
});

describe("staff attendance", () => {
  const startsAt = new Date("2026-08-10T12:00:00.000Z");
  const endsAt = new Date("2026-08-10T20:00:00.000Z");

  it("uses the exact early boundary, marks post-start check-in late and rejects duplicates", () => {
    expect(
      decideAttendanceAction({
        action: "simulated-check-in",
        businessTime: new Date("2026-08-10T11:29:59.999Z"),
        endsAt,
        startsAt,
        status: null,
      }),
    ).toEqual({ reason: "sign-in-window-not-open", status: "invalid" });
    expect(
      decideAttendanceAction({
        action: "simulated-check-in",
        businessTime: new Date("2026-08-10T11:30:00.000Z"),
        endsAt,
        startsAt,
        status: null,
      }),
    ).toEqual({
      nextStatus: "checked-in",
      outcome: "on-time",
      status: "ready",
    });
    expect(
      decideAttendanceAction({
        action: "simulated-check-in",
        businessTime: new Date("2026-08-10T12:00:00.001Z"),
        endsAt,
        startsAt,
        status: null,
      }),
    ).toEqual({
      nextStatus: "checked-in",
      outcome: "late",
      status: "ready",
    });
    expect(
      decideAttendanceAction({
        action: "simulated-check-in",
        businessTime: new Date("2026-08-10T12:10:00.000Z"),
        endsAt,
        startsAt,
        status: "checked-in",
      }),
    ).toEqual({ reason: "already-checked-in", status: "invalid" });
    expect(
      decideAttendanceAction({
        action: "simulated-check-in",
        businessTime: endsAt,
        endsAt,
        startsAt,
        status: null,
      }),
    ).toEqual({ reason: "shift-ended", status: "invalid" });
  });

  it("marks an unsigned shift absent at its end and only checks out manually", () => {
    expect(
      decideAttendanceAction({
        action: "mark-absent",
        businessTime: new Date(endsAt.getTime() - 1),
        endsAt,
        startsAt,
        status: null,
      }),
    ).toEqual({ reason: "not-due", status: "invalid" });
    expect(
      decideAttendanceAction({
        action: "mark-absent",
        businessTime: endsAt,
        endsAt,
        startsAt,
        status: null,
      }),
    ).toEqual({ nextStatus: "absent", outcome: null, status: "ready" });
    expect(
      decideAttendanceAction({
        action: "manual-check-out",
        businessTime: new Date("2026-08-10T20:30:00.000Z"),
        endsAt,
        startsAt,
        status: "checked-in",
      }),
    ).toEqual({
      nextStatus: "checked-out",
      outcome: null,
      status: "ready",
    });
    expect(
      decideAttendanceAction({
        action: "mark-absent",
        businessTime: new Date("2026-08-10T20:30:00.000Z"),
        endsAt,
        startsAt,
        status: "checked-in",
      }),
    ).toEqual({ reason: "already-checked-in", status: "invalid" });
  });
});
