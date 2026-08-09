import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { DatabaseRoleContext } from "@jingshu/database";

import {
  issueRoleSession,
  readRoleSession,
  readRoleSessionWithLegacyFallback,
} from "./role-session.js";

const secret = "ticket-04-role-session-unit-secret-32-bytes";

function roleContext(expiresAt: Date): DatabaseRoleContext {
  return {
    businessClock: {
      advanceLimitMilliseconds: 86_400_000,
      advancedMilliseconds: 0,
      currentTime: new Date(),
      remainingAdvanceMilliseconds: 86_400_000,
      timeZone: "Asia/Shanghai",
    },
    contextVersion: 4,
    expiresAt,
    persona: {
      displayName: "周宁",
      id: "00000000-0000-4000-8000-000000000201",
      protected: true,
      scope: "棱镜旗舰店",
      storeId: "00000000-0000-4000-8000-000000000101",
    },
    role: "staff",
    sandboxId: "00000000-0000-4000-8000-000000000001",
    schemaVersion: "3",
    seedVersion: "2026-08-09.1",
    storeScope: {
      kind: "store",
      stores: [
        {
          code: "prism-flagship",
          displayName: "棱镜旗舰店",
          id: "00000000-0000-4000-8000-000000000101",
        },
      ],
    },
  };
}

describe("signed role session", () => {
  it("round-trips the canonical server context and rejects tampering", () => {
    const issued = issueRoleSession(
      roleContext(new Date(Date.now() + 60_000)),
      secret,
    );

    expect(readRoleSession(issued.token, secret)).toEqual(issued.payload);
    expect(readRoleSession(`${issued.token}tampered`, secret)).toBeNull();
  });

  it("rejects a correctly signed session after its server expiry", () => {
    const expired = issueRoleSession(
      roleContext(new Date(Date.now() - 1_000)),
      secret,
    );

    expect(readRoleSession(expired.token, secret)).toBeNull();
  });

  it("accepts the restricted legacy v1 shape only through the upgrade fallback", () => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        sandboxId: "00000000-0000-4000-8000-000000000001",
        role: "staff",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toString("base64url");
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    const legacyToken = `${payload}.${signature}`;

    expect(readRoleSession(legacyToken, secret)).toBeNull();
    expect(readRoleSessionWithLegacyFallback(legacyToken, secret)).toEqual({
      version: 1,
      sandboxId: "00000000-0000-4000-8000-000000000001",
      role: "staff",
      expiresAt: expect.any(String),
    });
    expect(
      readRoleSessionWithLegacyFallback(`${legacyToken}tampered`, secret),
    ).toBeNull();
  });
});
