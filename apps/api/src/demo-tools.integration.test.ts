import { createHash } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
  type DemoTimeDueHandlerRegistry,
} from "../../../packages/database/src/index.js";
import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const { Client } = pg;
const publicOrigin = "https://arena.example";
const wallTime = new Date("2026-08-09T12:00:00.000Z");
const handlerOrder = [
  "pending-reservation-expiration",
  "pending-order-expiration",
  "reservation-no-show",
  "reservation-auto-completion",
  "attendance-absence",
  "handover-exception",
] as const;
let failOrderExpiration = false;

const dueHandlers = Object.fromEntries(
  handlerOrder.map((kind) => [
    kind,
    {
      nextDueAt: async ({ currentBusinessTime }) =>
        new Date(currentBusinessTime.getTime() + 15 * 60_000),
      previewDue: async () => 1,
      processDue: async ({ client, sandboxId }) => {
        await client.query(
          `insert into demo_due_handler_test_log (sandbox_id, handler_kind)
           values ($1, $2)`,
          [sandboxId, kind],
        );
        if (kind === "pending-order-expiration" && failOrderExpiration) {
          throw new Error("forced due-handler failure");
        }
        return 1;
      },
    },
  ]),
) as DemoTimeDueHandlerRegistry;

const database = createPublicSandboxDatabase(databaseUrl, {
  dueHandlers,
  wallClock: { now: () => new Date(wallTime) },
});
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  sessionSecret: "ticket-05-integration-session-secret-32-bytes",
  secureCookies: true,
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      create table demo_due_handler_test_log (
        sequence bigint generated always as identity primary key,
        sandbox_id uuid not null,
        handler_kind text not null
      )
    `);
    await client.query(
      "grant insert, select on demo_due_handler_test_log to jingshu_runtime",
    );
    await client.query(
      "grant usage, select on sequence demo_due_handler_test_log_sequence_seq to jingshu_runtime",
    );
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  await database.close();
});

async function createStaffSandbox(
  creationKey = "00000000-0000-4000-8000-000000000501",
) {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie = visitor.headers.get("set-cookie")?.split(";", 1)[0];
  const created = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role: "staff" }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie ?? "",
      "Idempotency-Key": creationKey,
      Origin: publicOrigin,
    },
    method: "POST",
  });
  const sessionCookie = created.headers.get("set-cookie")?.split(";", 1)[0];
  const context = await app.request("/api/v1/demo/context", {
    headers: { Cookie: sessionCookie ?? "" },
  });

  return {
    context: await context.json(),
    sessionCookie: sessionCookie ?? "",
    visitorCookie: visitorCookie ?? "",
  };
}

describe("sandbox demo time", () => {
  it("advances the shared clock in fixed due-handler order and replays the command without changing wall-clock TTL", async () => {
    const sandbox = await createStaffSandbox();
    expect(sandbox.context).toMatchObject({
      csrfToken: expect.any(String),
      sandbox: {
        businessClock: {
          advancedMilliseconds: 0,
          currentTime: "2026-08-09T12:00:00.000Z",
          timeZone: "Asia/Shanghai",
        },
        expiresAt: "2026-08-10T12:00:00.000Z",
      },
    });

    const preview = await app.request("/api/v1/demo/time", {
      headers: { Cookie: sandbox.sessionCookie },
    });
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toMatchObject({
      clock: {
        advancedMilliseconds: 0,
        currentTime: "2026-08-09T12:00:00.000Z",
        remainingAdvanceMilliseconds: 86_400_000,
      },
      halfHour: {
        afterTime: "2026-08-09T12:30:00.000Z",
      },
      nextEvent: {
        afterTime: "2026-08-09T12:15:00.000Z",
      },
      status: "ready",
    });

    const idempotencyKey = "00000000-0000-4000-8000-000000000502";
    const advance = () =>
      app.request("/api/v1/demo/time/advance", {
        body: JSON.stringify({ mode: "half-hour" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: sandbox.sessionCookie,
          "Idempotency-Key": idempotencyKey,
          Origin: publicOrigin,
          "X-CSRF-Token": sandbox.context.csrfToken,
        },
        method: "POST",
      });

    const first = await advance();
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody).toEqual({
      afterTime: "2026-08-09T12:30:00.000Z",
      beforeTime: "2026-08-09T12:00:00.000Z",
      clock: {
        advanceLimitMilliseconds: 86_400_000,
        advancedMilliseconds: 1_800_000,
        remainingAdvanceMilliseconds: 84_600_000,
        timeZone: "Asia/Shanghai",
      },
      impacts: handlerOrder.map((kind) => ({ count: 1, kind })),
      mode: "half-hour",
      replayed: false,
      status: "advanced",
    });

    const replay = await advance();
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual({
      ...firstBody,
      replayed: true,
    });

    const afterContext = await app.request("/api/v1/demo/context", {
      headers: { Cookie: sandbox.sessionCookie },
    });
    expect(afterContext.status).toBe(200);
    await expect(afterContext.json()).resolves.toMatchObject({
      sandbox: {
        businessClock: {
          advancedMilliseconds: 1_800_000,
          currentTime: "2026-08-09T12:30:00.000Z",
        },
        expiresAt: "2026-08-10T12:00:00.000Z",
      },
    });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const log = await client.query<{ handler_kind: string }>(
        `select handler_kind from demo_due_handler_test_log order by sequence`,
      );
      expect(log.rows.map((row) => row.handler_kind)).toEqual(handlerOrder);

      const audit = await client.query<{
        business_occurred_at: Date;
        recorded_at: Date;
      }>(
        `select business_occurred_at, recorded_at
           from audit_events where action = 'demo_time.advance'`,
      );
      expect(audit.rows).toEqual([
        {
          business_occurred_at: new Date("2026-08-09T12:30:00.000Z"),
          recorded_at: wallTime,
        },
      ]);

      const command = await client.query<{ created_at: Date }>(
        `select created_at from sandbox_command_requests
          where command_type = 'demo_time.advance'
            and idempotency_key_hash = $1`,
        [createHash("sha256").update(idempotencyKey).digest("hex")],
      );
      expect(command.rows).toEqual([{ created_at: wallTime }]);
    } finally {
      await client.end();
    }
  });

  it("rolls back the clock, handler effects, audit, and idempotency reservation when any due handler fails", async () => {
    const sandbox = await createStaffSandbox(
      "00000000-0000-4000-8000-000000000503",
    );
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const before = await client.query<{ count: string }>(
      "select count(*)::text as count from demo_due_handler_test_log",
    );

    failOrderExpiration = true;
    const failed = await app.request("/api/v1/demo/time/advance", {
      body: JSON.stringify({ mode: "half-hour" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: sandbox.sessionCookie,
        "Idempotency-Key": "00000000-0000-4000-8000-000000000504",
        Origin: publicOrigin,
        "X-CSRF-Token": sandbox.context.csrfToken,
      },
      method: "POST",
    });
    failOrderExpiration = false;

    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: "DEMO_TIME_ADVANCE_FAILED" },
    });

    const afterFailureClock = await app.request("/api/v1/demo/time", {
      headers: { Cookie: sandbox.sessionCookie },
    });
    await expect(afterFailureClock.json()).resolves.toMatchObject({
      clock: {
        advancedMilliseconds: 0,
        currentTime: "2026-08-09T12:00:00.000Z",
      },
    });
    const after = await client.query<{ count: string }>(
      "select count(*)::text as count from demo_due_handler_test_log",
    );
    expect(after.rows).toEqual(before.rows);

    const retry = await app.request("/api/v1/demo/time/advance", {
      body: JSON.stringify({ mode: "half-hour" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: sandbox.sessionCookie,
        "Idempotency-Key": "00000000-0000-4000-8000-000000000504",
        Origin: publicOrigin,
        "X-CSRF-Token": sandbox.context.csrfToken,
      },
      method: "POST",
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({
      replayed: false,
      status: "advanced",
    });
    await client.end();
  });

  it("accepts exactly 24 hours of explicit advance and rejects any command beyond the cap", async () => {
    const sandbox = await createStaffSandbox(
      "00000000-0000-4000-8000-000000000505",
    );
    for (let index = 0; index < 48; index += 1) {
      const key = `00000000-0000-4000-8000-${String(506 + index).padStart(12, "0")}`;
      const response = await app.request("/api/v1/demo/time/advance", {
        body: JSON.stringify({ mode: "half-hour" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: sandbox.sessionCookie,
          "Idempotency-Key": key,
          Origin: publicOrigin,
          "X-CSRF-Token": sandbox.context.csrfToken,
        },
        method: "POST",
      });
      expect(response.status).toBe(200);
    }

    const atLimit = await app.request("/api/v1/demo/time", {
      headers: { Cookie: sandbox.sessionCookie },
    });
    await expect(atLimit.json()).resolves.toMatchObject({
      clock: {
        advancedMilliseconds: 86_400_000,
        remainingAdvanceMilliseconds: 0,
      },
      halfHour: { afterTime: null },
      nextEvent: null,
    });

    const exceeded = await app.request("/api/v1/demo/time/advance", {
      body: JSON.stringify({ mode: "half-hour" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: sandbox.sessionCookie,
        "Idempotency-Key": "00000000-0000-4000-8000-000000000554",
        Origin: publicOrigin,
        "X-CSRF-Token": sandbox.context.csrfToken,
      },
      method: "POST",
    });
    expect(exceeded.status).toBe(409);
    await expect(exceeded.json()).resolves.toMatchObject({
      error: { code: "DEMO_TIME_ADVANCE_LIMIT_REACHED" },
    });
  });
});

describe("sandbox reset", () => {
  it("rotates to one latest customer seed, blocks the old sandbox, and safely replays from either session outcome", async () => {
    const sandbox = await createStaffSandbox(
      "00000000-0000-4000-8000-000000000560",
    );
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    const before = await client.query<{ count: string }>(
      "select count(*)::text as count from sandboxes",
    );
    const resetKey = "00000000-0000-4000-8000-000000000561";

    const reset = await app.request("/api/v1/demo/reset", {
      body: JSON.stringify({ confirm: true }),
      headers: {
        "Content-Type": "application/json",
        Cookie: sandbox.sessionCookie,
        "Idempotency-Key": resetKey,
        Origin: publicOrigin,
        "X-CSRF-Token": sandbox.context.csrfToken,
      },
      method: "POST",
    });
    expect(reset.status).toBe(201);
    const body = await reset.json();
    expect(body).toMatchObject({
      context: {
        role: { id: "customer", label: "顾客" },
        sandbox: {
          businessClock: {
            advancedMilliseconds: 0,
            currentTime: "2026-08-09T12:00:00.000Z",
          },
          expiresAt: "2026-08-10T12:00:00.000Z",
          schemaVersion: "9",
          seedVersion: "2026-08-10.4",
        },
      },
      previousSandboxInvalidated: true,
      result: {
        targetRole: "customer",
        persona: { displayName: "林澈" },
        sandbox: {
          businessClock: {
            advancedMilliseconds: 0,
            currentTime: "2026-08-09T12:00:00.000Z",
          },
          expiresAt: "2026-08-10T12:00:00.000Z",
          schemaVersion: "9",
          seedVersion: "2026-08-10.4",
        },
      },
      replayed: false,
      status: "ready",
    });
    const replacementCookie =
      reset.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    expect(replacementCookie).not.toBe(sandbox.sessionCookie);

    const oldTab = await app.request("/api/v1/demo/context", {
      headers: { Cookie: sandbox.sessionCookie },
    });
    expect(oldTab.status).toBe(401);
    await expect(oldTab.json()).resolves.toMatchObject({
      error: { code: "ROLE_CONTEXT_UNAVAILABLE" },
    });

    const replayAfterCookieRotation = await app.request("/api/v1/demo/reset", {
      body: JSON.stringify({ confirm: true }),
      headers: {
        "Content-Type": "application/json",
        Cookie: replacementCookie,
        "Idempotency-Key": resetKey,
        Origin: publicOrigin,
        "X-CSRF-Token": body.context.csrfToken,
      },
      method: "POST",
    });
    expect(replayAfterCookieRotation.status).toBe(200);
    const replayAfterCookieRotationBody =
      await replayAfterCookieRotation.json();
    expect(replayAfterCookieRotationBody).toMatchObject({
      context: { role: { id: "customer" } },
      result: body.result,
      replayed: true,
      status: "ready",
    });

    const switched = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "staff" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: replacementCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": body.context.csrfToken,
      },
      method: "POST",
    });
    expect(switched.status).toBe(200);
    const switchedBody = await switched.json();
    expect(switchedBody).toMatchObject({ role: { id: "staff" } });
    const switchedCookie =
      switched.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

    const replayAfterRoleChange = await app.request("/api/v1/demo/reset", {
      body: JSON.stringify({ confirm: true }),
      headers: {
        "Content-Type": "application/json",
        Cookie: switchedCookie,
        "Idempotency-Key": resetKey,
        Origin: publicOrigin,
        "X-CSRF-Token": switchedBody.csrfToken,
      },
      method: "POST",
    });
    expect(replayAfterRoleChange.status).toBe(200);
    await expect(replayAfterRoleChange.json()).resolves.toMatchObject({
      context: { role: { id: "staff" } },
      result: body.result,
      replayed: true,
      status: "ready",
    });

    const after = await client.query<{ count: string }>(
      "select count(*)::text as count from sandboxes",
    );
    expect(Number(after.rows[0]?.count)).toBe(
      Number(before.rows[0]?.count) + 1,
    );
    const audit = await client.query<{
      action: string;
      object_id: string;
      sandbox_id: string;
      source_sandbox_id: string | null;
    }>(
      `select action, object_id, sandbox_id,
              after_data ->> 'sourceSandboxId' as source_sandbox_id
         from audit_events
        where action in ('sandbox.reset', 'sandbox.reset.source')
        order by action`,
    );
    expect(audit.rows).toHaveLength(2);
    const resetAudit = audit.rows.find((row) => row.action === "sandbox.reset");
    const sourceAudit = audit.rows.find(
      (row) => row.action === "sandbox.reset.source",
    );
    expect(resetAudit).toMatchObject({
      object_id: resetAudit?.sandbox_id,
      source_sandbox_id: null,
    });
    expect(sourceAudit).toMatchObject({
      object_id: resetAudit?.sandbox_id,
      source_sandbox_id: resetAudit?.sandbox_id,
    });
    expect(sourceAudit?.sandbox_id).not.toBe(resetAudit?.sandbox_id);
    await client.end();
  });

  it("keeps the current sandbox active when replacement seed materialization fails and allows the same key to retry", async () => {
    const sandbox = await createStaffSandbox(
      "00000000-0000-4000-8000-000000000562",
    );
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`
      create function fail_reset_store_seed() returns trigger
      language plpgsql as $$
      begin
        if new.code = 'apex-new' then
          raise exception 'forced reset seed failure';
        end if;
        return new;
      end
      $$
    `);
    await client.query(`
      create trigger fail_reset_store_seed
      before insert on stores
      for each row execute function fail_reset_store_seed()
    `);

    const resetKey = "00000000-0000-4000-8000-000000000563";
    const requestReset = () =>
      app.request("/api/v1/demo/reset", {
        body: JSON.stringify({ confirm: true }),
        headers: {
          "Content-Type": "application/json",
          Cookie: sandbox.sessionCookie,
          "Idempotency-Key": resetKey,
          Origin: publicOrigin,
          "X-CSRF-Token": sandbox.context.csrfToken,
        },
        method: "POST",
      });

    const failed = await requestReset();
    expect(failed.status).toBe(503);
    await expect(failed.json()).resolves.toMatchObject({
      error: { code: "SANDBOX_RESET_FAILED" },
    });
    const retained = await app.request("/api/v1/demo/context", {
      headers: { Cookie: sandbox.sessionCookie },
    });
    expect(retained.status).toBe(200);
    await expect(retained.json()).resolves.toMatchObject({
      role: { id: "staff" },
      sandbox: { businessClock: { advancedMilliseconds: 0 } },
    });

    await client.query("drop trigger fail_reset_store_seed on stores");
    await client.query("drop function fail_reset_store_seed()");
    const retry = await requestReset();
    expect(retry.status).toBe(201);
    await expect(retry.json()).resolves.toMatchObject({
      context: { role: { id: "customer" } },
      replayed: false,
      status: "ready",
    });
    await client.end();
  });
});
