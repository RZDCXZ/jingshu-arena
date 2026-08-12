import { describe, expect, it } from "vitest";

import { resolveAllowedOrigins } from "./allowed-origins.js";

describe("resolveAllowedOrigins", () => {
  it("allows exact loopback and LAN Web origins during local development", () => {
    expect(
      resolveAllowedOrigins({
        developmentOrigins:
          "http://127.0.0.1:3000,http://localhost:3000,http://192.168.1.8:3000",
        nodeEnvironment: "development",
        publicOrigin: "http://127.0.0.1:3000",
      }),
    ).toEqual([
      "http://127.0.0.1:3000",
      "http://localhost:3000",
      "http://192.168.1.8:3000",
    ]);
  });

  it("ignores development-only origins in production", () => {
    expect(
      resolveAllowedOrigins({
        developmentOrigins: "http://192.168.1.8:3000",
        nodeEnvironment: "production",
        publicOrigin: "https://arena.example",
      }),
    ).toEqual(["https://arena.example"]);
  });

  it("rejects development entries that are not exact HTTP origins", () => {
    expect(() =>
      resolveAllowedOrigins({
        developmentOrigins: "http://192.168.1.8:3000/path",
        nodeEnvironment: "development",
        publicOrigin: "http://127.0.0.1:3000",
      }),
    ).toThrow(/exact HTTP origin/u);
  });
});
