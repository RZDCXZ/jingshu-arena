import { describe, expect, it } from "vitest";

import {
  HANDOVER_EXCEPTION_GRACE_MS,
  classifyHandoverExceptions,
  normalizeHandoverNote,
} from "../src/index.js";

describe("handover notes", () => {
  it("normalizes a 500-character operational note and rejects unsafe or sensitive content", () => {
    expect(normalizeHandoverNote("  A-18 耳机报修待分派。  ")).toBe(
      "A-18 耳机报修待分派。",
    );
    expect(normalizeHandoverNote("交接".repeat(250))).toHaveLength(500);
    expect(normalizeHandoverNote("交接".repeat(251))).toBeNull();
    expect(normalizeHandoverNote("现金盘点差异待复核")).toBeNull();
    expect(normalizeHandoverNote("真实支付对账待处理")).toBeNull();
    expect(normalizeHandoverNote("包含<字段>的说明")).toBeNull();
  });
});

describe("handover exceptions", () => {
  const shiftEndsAt = new Date("2026-08-10T18:00:00.000Z");
  const deadline = new Date(
    shiftEndsAt.getTime() + HANDOVER_EXCEPTION_GRACE_MS,
  );

  it("distinguishes an overdue missing submission from attendance", () => {
    expect(
      classifyHandoverExceptions({
        confirmedAt: null,
        currentTime: new Date(deadline.getTime() - 1),
        shiftEndsAt,
        submittedAt: null,
      }),
    ).toEqual([]);
    expect(
      classifyHandoverExceptions({
        confirmedAt: null,
        currentTime: deadline,
        shiftEndsAt,
        submittedAt: null,
      }),
    ).toEqual(["submission-overdue"]);
  });

  it("keeps late submission and long confirmation delay as separate explainable exceptions", () => {
    expect(
      classifyHandoverExceptions({
        confirmedAt: new Date(deadline.getTime() + 60_000),
        currentTime: new Date(deadline.getTime() + 60_000),
        shiftEndsAt,
        submittedAt: new Date(shiftEndsAt.getTime() + 60_000),
      }),
    ).toEqual(["late-submission", "confirmation-overdue"]);

    expect(
      classifyHandoverExceptions({
        confirmedAt: new Date(shiftEndsAt.getTime() + 10 * 60_000),
        currentTime: deadline,
        shiftEndsAt,
        submittedAt: new Date(shiftEndsAt.getTime() + 60_000),
      }),
    ).toEqual(["late-submission"]);
  });
});
