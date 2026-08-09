import { describe, expect, it } from "vitest";

import {
  buildPublicSandboxSeed,
  PUBLIC_SANDBOX_SCHEMA_VERSION,
  PUBLIC_SANDBOX_SEED_VERSION,
} from "../src/index.js";

describe("public sandbox seed", () => {
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
    expect(first.personas).toHaveLength(4);
    expect(first.personas.every((persona) => persona.protected)).toBe(true);
  });
});
