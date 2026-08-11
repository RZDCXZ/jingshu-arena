import { describe, expect, it } from "vitest";

import {
  buildPublicSandboxSeed,
  isSafePlainTextReason,
  PUBLIC_SANDBOX_SCHEMA_VERSION,
  PUBLIC_SANDBOX_SEED_VERSION,
} from "../src/index.js";

describe("public sandbox seed", () => {
  it("accepts only bounded plain-text business reasons", () => {
    expect(isSafePlainTextReason("门店到货，店长已复核。")).toBe(true);
    expect(isSafePlainTextReason("   ")).toBe(false);
    expect(isSafePlainTextReason("含有<标签>的原因")).toBe(false);
    expect(isSafePlainTextReason(`换行\n原因`)).toBe(false);
    expect(isSafePlainTextReason("原".repeat(201))).toBe(false);
  });

  it("builds the same protected three-store world on every call", () => {
    const first = buildPublicSandboxSeed();
    const second = buildPublicSandboxSeed();

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(first.schemaVersion).toBe(PUBLIC_SANDBOX_SCHEMA_VERSION);
    expect(first.seedVersion).toBe(PUBLIC_SANDBOX_SEED_VERSION);
    expect(first.operator).toEqual({
      city: "栖光市",
      displayName: "竞枢演示经营方",
    });
    expect(first.stores.map((store) => store.displayName)).toEqual([
      "棱镜旗舰店",
      "星桥标准店",
      "极点新店",
    ]);
    expect(first.machineProfiles).toEqual([
      {
        code: "standard",
        displayName: "标准型",
        experienceDescription: "1080p / 144Hz",
      },
      {
        code: "competitive",
        displayName: "竞技型",
        experienceDescription: "2K / 180Hz",
      },
      {
        code: "flagship",
        displayName: "旗舰型",
        experienceDescription: "2K / 240Hz",
      },
    ]);
    expect(
      first.stores.map((store) => ({
        areas: store.areas.reduce((sum, area) => sum + area.seatCount, 0),
        machines: Object.values(store.machineProfileSeatCounts).reduce(
          (sum, count) => sum + count,
          0,
        ),
        profileCounts: store.machineProfileSeatCounts,
        seats: store.seatCount,
      })),
    ).toEqual([
      {
        areas: 96,
        machines: 96,
        profileCounts: { competitive: 40, flagship: 16, standard: 40 },
        seats: 96,
      },
      {
        areas: 64,
        machines: 64,
        profileCounts: { competitive: 24, flagship: 8, standard: 32 },
        seats: 64,
      },
      {
        areas: 40,
        machines: 40,
        profileCounts: { competitive: 12, flagship: 4, standard: 24 },
        seats: 40,
      },
    ]);
    expect(first.personas).toHaveLength(4);
    expect(first.personas.every((persona) => persona.protected)).toBe(true);
    expect(first.employees).toHaveLength(33);
    expect(
      first.stores.map((store) => ({
        count: first.employees.filter(
          (employee) => employee.storeCode === store.code,
        ).length,
        store: store.code,
      })),
    ).toEqual([
      { count: 16, store: "prism-flagship" },
      { count: 10, store: "starbridge-standard" },
      { count: 7, store: "apex-new" },
    ]);
    expect(
      first.employees
        .filter((employee) => employee.protected)
        .map((employee) => employee.displayName),
    ).toEqual(["周宁", "许知远"]);
  });
});
