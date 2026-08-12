import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";
import { createApp } from "./app.js";
import { runSandboxLifecycleCleanup } from "./sandbox-lifecycle-cleanup.js";
import { MemoryRepairImageStorage } from "./repair-image-storage.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const publicOrigin = "https://arena.example";
const wallTime = new Date("2026-08-12T00:00:00.000Z");
const wallClock = { now: () => new Date(wallTime) };

class FlakyMemoryRepairImageStorage extends MemoryRepairImageStorage {
  failNextSandboxDeletion = false;

  override async deleteSandbox(sandboxId: string) {
    if (this.failNextSandboxDeletion) {
      this.failNextSandboxDeletion = false;
      throw new Error("forced private blob deletion failure");
    }
    await super.deleteSandbox(sandboxId);
  }
}

const repairImageStorage = new FlakyMemoryRepairImageStorage();
const database = createPublicSandboxDatabase(databaseUrl, {
  admissionLimits: {
    activeSandboxLimit: 1,
    createPerIp: { perDay: 20, perHour: 1 },
    createPerVisitor: { perDay: 20, perHour: 1 },
    resetPerIp: { perDay: 20, perHour: 10 },
    resetPerVisitor: { perDay: 20, perHour: 1 },
  },
  wallClock,
});
const app = createApp({
  allowedOrigins: [publicOrigin],
  repairImageStorage,
  sandboxDatabase: database,
  secureCookies: true,
  sessionSecret: "ticket-28-integration-session-secret-32-bytes",
  wallClock,
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

async function issueVisitorCookie() {
  const visitor = await app.request("/api/v1/public/visitor");
  expect(visitor.status).toBe(204);
  return visitor.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
}

async function createSandbox(input: {
  readonly creationKey: string;
  readonly clientIp: string;
  readonly visitorCookie: string;
}) {
  return app.fetch(
    new Request("http://localhost/api/v1/public/sandboxes", {
      body: JSON.stringify({ role: "staff" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: input.visitorCookie,
        "Idempotency-Key": input.creationKey,
        Origin: publicOrigin,
        // The HTTP core must ignore this untrusted identity; clientIp below is
        // supplied by the transport adapter as the authoritative peer address.
        "X-Forwarded-For": "198.51.100.254",
      },
      method: "POST",
    }),
    { clientIp: input.clientIp },
  );
}

describe("sandbox capacity, expiry, and deferred cleanup", () => {
  it("keeps expired and reset sandboxes inaccessible while cleanup retries, then permits a fresh creation without retaining business data", async () => {
    const firstVisitor = await issueVisitorCookie();
    const firstCreationKey = "00000000-0000-4000-8000-000000002801";
    const firstRequest = {
      creationKey: firstCreationKey,
      clientIp: "203.0.113.28",
      visitorCookie: firstVisitor,
    };
    const capacityVisitor = await issueVisitorCookie();
    const capacityCreationKey = "00000000-0000-4000-8000-000000002802";
    const capacityRequest = {
      creationKey: capacityCreationKey,
      clientIp: "203.0.113.29",
      visitorCookie: capacityVisitor,
    };
    const competing = await Promise.all([
      createSandbox(firstRequest),
      createSandbox(capacityRequest),
    ]);
    const createdIndex = competing.findIndex(
      (response) => response.status === 201,
    );
    expect(createdIndex).toBeGreaterThanOrEqual(0);
    expect(
      competing.filter((response) => response.status === 201),
    ).toHaveLength(1);
    const first = competing[createdIndex]!;
    const capacityFull = competing[createdIndex === 0 ? 1 : 0]!;
    expect(first.status).toBe(201);
    const firstSession =
      first.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

    expect(capacityFull.status).toBe(503);
    expect(capacityFull.headers.get("retry-after")).toBeTruthy();
    await expect(capacityFull.json()).resolves.toMatchObject({
      error: { code: "PUBLIC_SANDBOX_CAPACITY_EXHAUSTED" },
    });

    wallTime.setTime(wallTime.getTime() + 24 * 60 * 60 * 1_000);
    const expiredContext = await app.request("/api/v1/demo/context", {
      headers: { Cookie: firstSession },
    });
    expect(expiredContext.status).toBe(401);
    const expiredBody = await expiredContext.json();
    expect(expiredBody).toMatchObject({
      error: {
        code: "ROLE_CONTEXT_REQUIRED",
        sandboxEndReason: "expired",
      },
    });

    await runSandboxLifecycleCleanup({
      database,
      repairImageStorage,
      wallClock,
    });
    const expiredDuringCleanup = await app.request("/api/v1/demo/context", {
      headers: { Cookie: firstSession },
    });
    expect(expiredDuringCleanup.status).toBe(401);
    await expect(expiredDuringCleanup.json()).resolves.toMatchObject({
      error: {
        code: "ROLE_CONTEXT_REQUIRED",
        sandboxEndReason: "expired",
      },
    });
    await runSandboxLifecycleCleanup({
      database,
      repairImageStorage,
      wallClock,
    });

    const recoveryVisitor = await issueVisitorCookie();
    const recoveryRequest = {
      creationKey: "00000000-0000-4000-8000-000000002803",
      clientIp: "203.0.113.30",
      visitorCookie: recoveryVisitor,
    };
    const recovered = await createSandbox(recoveryRequest);
    expect(recovered.status).toBe(201);
    const recoveredSession =
      recovered.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const recoveredContext = await app.request("/api/v1/demo/context", {
      headers: { Cookie: recoveredSession },
    });
    const recoveredBody = await recoveredContext.json();
    expect(recoveredContext.status).toBe(200);
    expect(recoveredBody).toMatchObject({
      csrfToken: expect.any(String),
      sandbox: { expiresAt: expect.any(String) },
      freshness: { observedAt: wallClock.now().toISOString() },
    });

    const rateLimited = await createSandbox({
      creationKey: "00000000-0000-4000-8000-000000002804",
      clientIp: recoveryRequest.clientIp,
      visitorCookie: await issueVisitorCookie(),
    });
    expect(rateLimited.status).toBe(429);
    expect(rateLimited.headers.get("retry-after")).toBeTruthy();
    await expect(rateLimited.json()).resolves.toMatchObject({
      error: { code: "PUBLIC_SANDBOX_RATE_LIMITED" },
    });

    const sandboxId = recoveredBody.sandbox.fingerprint;
    const rawSandboxId = await (async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      await client.connect();
      try {
        const sandbox = await client.query<{ id: string }>(
          `select id
             from sandboxes
            where expires_at > $1 and invalidated_at is null
            order by created_at desc
            limit 1`,
          [wallClock.now()],
        );
        return sandbox.rows[0]?.id ?? "";
      } finally {
        await client.end();
      }
    })();
    expect(rawSandboxId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(sandboxId).not.toBe(rawSandboxId);

    await repairImageStorage.put(
      `quarantine/${rawSandboxId}/00000000-0000-4000-8000-000000002805`,
      new Uint8Array([1, 2, 3]),
    );
    await repairImageStorage.put(
      `finished/${rawSandboxId}/00000000-0000-4000-8000-000000002806.png`,
      new Uint8Array([4, 5, 6]),
    );

    const reset = await app.fetch(
      new Request("http://localhost/api/v1/demo/reset", {
        body: JSON.stringify({ confirm: true }),
        headers: {
          "Content-Type": "application/json",
          Cookie: `${recoveredSession}; ${recoveryRequest.visitorCookie}`,
          "Idempotency-Key": "00000000-0000-4000-8000-000000002807",
          Origin: publicOrigin,
          "X-CSRF-Token": recoveredBody.csrfToken,
          "X-Forwarded-For": "198.51.100.254",
        },
        method: "POST",
      }),
      { clientIp: recoveryRequest.clientIp },
    );
    expect(reset.status).toBe(201);
    const resetBody = await reset.clone().json();
    expect(repairImageStorage.keys()).toEqual([
      `finished/${rawSandboxId}/00000000-0000-4000-8000-000000002806.png`,
      `quarantine/${rawSandboxId}/00000000-0000-4000-8000-000000002805`,
    ]);

    const staleTab = await app.request("/api/v1/demo/context", {
      headers: { Cookie: recoveredSession },
    });
    expect(staleTab.status).toBe(401);
    await expect(staleTab.json()).resolves.toMatchObject({
      error: {
        code: "ROLE_CONTEXT_UNAVAILABLE",
        sandboxEndReason: "reset",
      },
    });

    repairImageStorage.failNextSandboxDeletion = true;
    await runSandboxLifecycleCleanup({
      database,
      repairImageStorage,
      wallClock,
    });
    expect(repairImageStorage.keys()).toHaveLength(2);

    wallTime.setTime(wallTime.getTime() + 31_000);
    for (let index = 0; index < 80; index += 1) {
      await runSandboxLifecycleCleanup({
        database,
        repairImageStorage,
        wallClock,
      });
    }
    expect(repairImageStorage.keys()).toEqual([]);

    const resetRateLimited = await app.fetch(
      new Request("http://localhost/api/v1/demo/reset", {
        body: JSON.stringify({ confirm: true }),
        headers: {
          "Content-Type": "application/json",
          Cookie: `${reset.headers.get("set-cookie")?.split(";", 1)[0] ?? ""}; ${recoveryRequest.visitorCookie}`,
          "Idempotency-Key": "00000000-0000-4000-8000-000000002808",
          Origin: publicOrigin,
          "X-CSRF-Token": resetBody.context.csrfToken,
          "X-Forwarded-For": "198.51.100.254",
        },
        method: "POST",
      }),
      { clientIp: recoveryRequest.clientIp },
    );
    expect(resetRateLimited.status).toBe(429);
    await expect(resetRateLimited.json()).resolves.toMatchObject({
      error: { code: "SANDBOX_RESET_RATE_LIMITED" },
    });

    const receiptClient = new pg.Client({ connectionString: databaseUrl });
    await receiptClient.connect();
    try {
      const receipt = await receiptClient.query<{
        completed_at: Date;
        reason: string;
      }>(
        `select reason, completed_at
           from sandbox_deletion_receipts
          order by completed_at`,
      );
      expect(receipt.rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            completed_at: expect.any(Date),
            reason: expect.stringMatching(/^(expired|reset)$/u),
          }),
        ]),
      );
      const receiptColumns = await receiptClient.query<{ column_name: string }>(
        `select column_name
           from information_schema.columns
          where table_schema = 'public'
            and table_name = 'sandbox_deletion_receipts'`,
      );
      expect(receiptColumns.rows.map((row) => row.column_name)).not.toEqual(
        expect.arrayContaining([
          "sandbox_id",
          "object_key",
          "person_name",
          "reason_detail",
        ]),
      );
      const oldRows = await receiptClient.query<{ count: string }>(
        "select count(*)::text as count from sandboxes where id = $1",
        [rawSandboxId],
      );
      expect(oldRows.rows).toEqual([{ count: "0" }]);
    } finally {
      await receiptClient.end();
    }
  });
});
