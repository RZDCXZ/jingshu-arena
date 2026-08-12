import { describe, expect, it, vi } from "vitest";

import { createBrowserUuid } from "./browser-uuid.js";

describe("createBrowserUuid", () => {
  it("uses the browser native UUID implementation when available", () => {
    const randomUUID = vi.fn(() => "4b79e744-40f7-41b2-88bb-2742550050b1");

    expect(
      createBrowserUuid({
        getRandomValues: vi.fn(),
        randomUUID,
      }),
    ).toBe("4b79e744-40f7-41b2-88bb-2742550050b1");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates a valid UUID v4 when randomUUID is unavailable over LAN HTTP", () => {
    const getRandomValues = vi.fn((target: Uint8Array) => {
      target.set([
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
        0x0c, 0x0d, 0x0e, 0x0f,
      ]);
      return target;
    });

    expect(createBrowserUuid({ getRandomValues })).toBe(
      "00010203-0405-4607-8809-0a0b0c0d0e0f",
    );
    expect(getRandomValues).toHaveBeenCalledOnce();
  });
});
