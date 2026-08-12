import { describe, expect, it, vi } from "vitest";

import type {
  DatabaseRoleContext,
  PublicSandboxDatabase,
} from "@jingshu/database";

import { createApp } from "./app.js";
import { issueRoleSession } from "./role-session.js";

const sessionSecret = "ticket-29-demo-story-route-secret-32-bytes";
const now = new Date("2026-08-12T11:30:00.000Z");
const sandboxId = "00000000-0000-4000-8000-000000000029";
const personaId = "00000000-0000-4000-8000-000000000030";

const demoStoryStepIds = [
  "reservation-created",
  "reservation-paid",
  "reservation-arrived",
  "reservation-in-use",
  "order-paid",
  "order-fulfilled",
  "business-time-advanced",
  "repair-created",
  "repair-resolved",
  "repair-verified",
  "headquarters-exported",
  "sandbox-reset",
] as const;

function roleContext(): DatabaseRoleContext {
  return {
    sandboxId,
    schemaVersion: "4",
    seedVersion: "2026-08-12.1",
    expiresAt: new Date("2026-08-13T11:30:00.000Z"),
    businessClock: {
      advanceLimitMilliseconds: 86_400_000,
      advancedMilliseconds: 0,
      currentTime: now,
      remainingAdvanceMilliseconds: 86_400_000,
      timeZone: "Asia/Shanghai",
    },
    contextVersion: 1,
    role: "customer",
    persona: {
      id: personaId,
      displayName: "林澈",
      protected: true,
      scope: "浏览三店 · 只管理自己的记录",
      storeId: null,
    },
    storeScope: {
      kind: "customer",
      stores: [],
    },
  };
}

describe("主演示清单 API", () => {
  it("returns one server-derived, sequential twelve-step story for the current role context", async () => {
    const readDemoStory = vi.fn(async () => ({
      resetAt: null,
      steps: demoStoryStepIds.map((id) => ({
        evidence: [],
        id,
        satisfied: false,
      })),
    }));
    const database = {
      readDemoStory,
    } as unknown as PublicSandboxDatabase;
    const app = createApp({
      sandboxDatabase: database,
      sessionSecret,
      wallClock: { now: () => now },
    });
    const session = issueRoleSession(roleContext(), sessionSecret);

    const response = await app.request("/api/v1/demo/story", {
      headers: { Cookie: `jingshu_session=${session.token}` },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      completedCount: 0,
      resetAt: null,
      status: "ready",
      steps: demoStoryStepIds.map((id, index) => ({
        evidence: [],
        id,
        state: index === 0 ? "current" : "blocked",
      })),
    });
    expect(readDemoStory).toHaveBeenCalledWith({
      contextVersion: 1,
      personaId,
      role: "customer",
      sandboxId,
    });
  });
});
