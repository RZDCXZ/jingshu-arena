import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import type {
  PublicRole,
  RoleCapability,
  RoleContextReadyResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";
import type { PublicSandboxDatabase } from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const { Client } = pg;
const database = createPublicSandboxDatabase(databaseUrl);
const publicOrigin = "https://arena.example";
const sessionSecret = "ticket-04-role-context-session-secret-32-bytes";
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  secureCookies: true,
  sessionSecret,
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

function cookiePair(response: Response, name: string): string {
  const cookie = response.headers.get("set-cookie");
  const pair = cookie?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`)) {
    throw new Error(`Expected ${name} cookie.`);
  }
  return pair;
}

function decodeSession(cookie: string): Record<string, unknown> {
  const value = cookie.slice(cookie.indexOf("=") + 1);
  const encodedPayload = value.split(".", 1)[0];
  if (!encodedPayload) throw new Error("Expected a signed session payload.");
  return JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
}

function issueLegacySession(payload: {
  expiresAt: string;
  role: PublicRole;
  sandboxId: string;
}) {
  const encoded = Buffer.from(
    JSON.stringify({ version: 1, ...payload }),
  ).toString("base64url");
  const signature = createHmac("sha256", sessionSecret)
    .update(encoded)
    .digest("base64url");
  return `jingshu_session=${encoded}.${signature}`;
}

let creationSequence = 100;

async function createRoleSession(role: PublicRole): Promise<{
  context: RoleContextReadyResponse;
  creationKey: string;
  csrfToken: string;
  sessionCookie: string;
  visitorCookie: string;
}> {
  creationSequence += 1;
  const creationKey = `00000000-0000-4000-8000-${creationSequence.toString().padStart(12, "0")}`;
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie = cookiePair(visitor, "jingshu_visitor");
  const creation = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie,
      "Idempotency-Key": creationKey,
      Origin: publicOrigin,
    },
    method: "POST",
  });
  expect(creation.status, JSON.stringify(await creation.clone().json())).toBe(
    201,
  );
  const sessionCookie = cookiePair(creation, "jingshu_session");
  const contextResponse = await app.request("/api/v1/demo/context", {
    headers: { Cookie: sessionCookie },
  });
  expect(contextResponse.status).toBe(200);
  const context = (await contextResponse.json()) as RoleContextReadyResponse;

  return {
    context,
    creationKey,
    csrfToken: context.csrfToken,
    sessionCookie,
    visitorCookie,
  };
}

async function accessCheck(
  session: Awaited<ReturnType<typeof createRoleSession>>,
  capability: RoleCapability,
  target: { id: string; kind: "persona" | "sandbox" | "store" },
) {
  return app.request("/api/v1/demo/context/access", {
    body: JSON.stringify({ capability, target }),
    headers: {
      "Content-Type": "application/json",
      Cookie: session.sessionCookie,
      Origin: publicOrigin,
      "X-CSRF-Token": session.csrfToken,
    },
    method: "POST",
  });
}

async function lockSandboxRow(sandboxId: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("begin");
  await client.query("select id from sandboxes where id = $1 for update", [
    sandboxId,
  ]);
  return client;
}

async function waitForWaitingSandboxTransactions(expected: number) {
  const monitor = new Client({ connectionString: databaseUrl });
  await monitor.connect();
  try {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const waiting = await monitor.query<{ count: string }>(
        `select count(*)::text as count
           from pg_stat_activity
          where datname = current_database()
            and pid <> pg_backend_pid()
            and wait_event_type = 'Lock'
            and query ilike '%sandboxes%for update%'`,
      );
      if (Number(waiting.rows[0]?.count ?? 0) >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    await monitor.end();
  }
  throw new Error(`Expected ${expected} role-context transaction(s) to wait.`);
}

describe("server-issued role context", () => {
  it("maps every public role to canonical persona, scope, and allowed capability families", async () => {
    const expected = {
      customer: {
        persona: "林澈",
        scopeKind: "customer",
        storeCount: 3,
        capabilities: ["customer:manage-own-records"],
      },
      staff: {
        persona: "周宁",
        scopeKind: "store",
        storeCount: 1,
        capabilities: ["store:perform-frontline"],
      },
      manager: {
        persona: "许知远",
        scopeKind: "store",
        storeCount: 1,
        capabilities: [
          "store:perform-frontline",
          "store:adjust-inventory",
          "store:configure",
          "store:manage-people",
          "audit:view",
        ],
      },
      hq: {
        persona: "沈微",
        scopeKind: "all-stores",
        storeCount: 3,
        capabilities: [
          "store:configure",
          "chain:compare",
          "chain:configure",
          "chain:maintain-catalogs",
          "audit:view",
        ],
      },
    } as const satisfies Record<
      PublicRole,
      {
        persona: string;
        scopeKind: RoleContextReadyResponse["storeScope"]["kind"];
        storeCount: number;
        capabilities: ReadonlyArray<RoleCapability>;
      }
    >;

    for (const role of ["customer", "staff", "manager", "hq"] as const) {
      const session = await createRoleSession(role);
      expect(session.context.role.id).toBe(role);
      expect(session.context.persona.displayName).toBe(expected[role].persona);
      expect(session.context.storeScope.kind).toBe(expected[role].scopeKind);
      expect(session.context.storeScope.stores).toHaveLength(
        expected[role].storeCount,
      );
      expect(session.context.capabilities).toEqual(expected[role].capabilities);

      const signedPayload = decodeSession(session.sessionCookie);
      expect(signedPayload).toMatchObject({
        version: 2,
        contextVersion: 1,
        role,
        sandboxId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        personaId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
        storeIds: expect.any(Array),
      });
      expect((signedPayload.storeIds as unknown[]).length).toBe(
        expected[role].storeCount,
      );
    }
  });

  it("switches to the server-mapped persona, rotates context and CSRF, and audits stale writes", async () => {
    const initial = await createRoleSession("customer");
    const switched = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "staff" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });

    expect(switched.status).toBe(200);
    const switchedBody = (await switched.json()) as RoleContextReadyResponse;
    const switchedCookie = cookiePair(switched, "jingshu_session");
    expect(switched.headers.get("set-cookie")).toMatch(
      /; HttpOnly; Secure; SameSite=Lax$/u,
    );
    expect(switchedCookie).not.toBe(initial.sessionCookie);
    expect(switchedBody).toMatchObject({
      contextVersion: 2,
      role: { id: "staff", label: "店员" },
      persona: { displayName: "周宁", protected: true },
      storeScope: {
        kind: "store",
        label: "棱镜旗舰店",
        stores: [{ code: "prism-flagship", displayName: "棱镜旗舰店" }],
      },
      capabilities: ["store:perform-frontline"],
    });
    expect(switchedBody.csrfToken).not.toBe(initial.csrfToken);

    const staleWrite = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: switchedCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });
    expect(staleWrite.status).toBe(409);
    await expect(staleWrite.json()).resolves.toMatchObject({
      error: {
        code: "ROLE_CONTEXT_STALE",
        message: "当前标签的旧角色上下文已失效，请刷新到当前角色。",
      },
    });

    const staleRead = await app.request("/api/v1/demo/context", {
      headers: { Cookie: initial.sessionCookie },
    });
    expect(staleRead.status).toBe(409);
    await expect(staleRead.json()).resolves.toMatchObject({
      error: { code: "ROLE_CONTEXT_STALE" },
    });

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const audit = await client.query<{
        action: string;
        reason: string | null;
        request_id: string;
        result: string;
        role: string;
      }>(
        `select action, reason, request_id, result, role
           from audit_events
          where request_id = any($1::uuid[])
          order by recorded_at`,
        [
          [
            switched.headers.get("x-request-id"),
            staleWrite.headers.get("x-request-id"),
          ],
        ],
      );
      expect(audit.rows).toEqual([
        {
          action: "role_context.switch",
          reason: null,
          request_id: switched.headers.get("x-request-id"),
          result: "allowed",
          role: "customer",
        },
        {
          action: "role_context.write",
          reason: "csrf_context_mismatch",
          request_id: staleWrite.headers.get("x-request-id"),
          result: "denied",
          role: "staff",
        },
      ]);
    } finally {
      await client.end();
    }
  });

  it("keeps one canonical role at each context version when the creation request is replayed", async () => {
    const initial = await createRoleSession("staff");
    const switched = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });
    expect(switched.status).toBe(200);
    const switchedCookie = cookiePair(switched, "jingshu_session");

    const replay = await app.request("/api/v1/public/sandboxes", {
      body: JSON.stringify({ role: "staff" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: `${initial.visitorCookie}; ${switchedCookie}`,
        "Idempotency-Key": initial.creationKey,
        Origin: publicOrigin,
      },
      method: "POST",
    });
    expect(replay.status).toBe(200);
    await expect(replay.clone().json()).resolves.toMatchObject({
      replayed: true,
      role: "staff",
      persona: { displayName: "周宁" },
    });
    expect(replay.headers.get("set-cookie")).toBeNull();

    const replayedContext = await app.request("/api/v1/demo/context", {
      headers: { Cookie: switchedCookie },
    });
    expect(replayedContext.status).toBe(200);
    await expect(replayedContext.json()).resolves.toMatchObject({
      contextVersion: 2,
      role: { id: "manager" },
      persona: { displayName: "许知远" },
    });

    const originalContext = await app.request("/api/v1/demo/context", {
      headers: { Cookie: initial.sessionCookie },
    });
    expect(originalContext.status).toBe(409);
  });

  it("does not let a delayed authenticated replay overwrite a concurrently switched session", async () => {
    let releaseReplay: (() => void) | undefined;
    let reportReplayRead: (() => void) | undefined;
    const replayReleased = new Promise<void>((resolve) => {
      releaseReplay = resolve;
    });
    const replayRead = new Promise<void>((resolve) => {
      reportReplayRead = resolve;
    });
    let pauseReplay = false;
    const wrappedDatabase: PublicSandboxDatabase = {
      close: async () => undefined,
      create: async (input) => {
        const result = await database.create(input);
        if (pauseReplay && result.replayed) {
          reportReplayRead?.();
          await replayReleased;
        }
        return result;
      },
      readCurrentRoleContext: (input) => database.readCurrentRoleContext(input),
      readRoleContext: (input) => database.readRoleContext(input),
      recordRoleContextDenial: (input) =>
        database.recordRoleContextDenial(input),
      switchRoleContext: (input) => database.switchRoleContext(input),
    };
    const concurrentApp = createApp({
      allowedOrigins: [publicOrigin],
      sandboxDatabase: wrappedDatabase,
      secureCookies: true,
      sessionSecret: "ticket-04-concurrent-replay-secret-32-bytes",
    });
    const creationKey = "00000000-0000-4000-8000-000000000890";
    const visitor = await concurrentApp.request("/api/v1/public/visitor");
    const visitorCookie = cookiePair(visitor, "jingshu_visitor");
    const created = await concurrentApp.request("/api/v1/public/sandboxes", {
      body: JSON.stringify({ role: "staff" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: visitorCookie,
        "Idempotency-Key": creationKey,
        Origin: publicOrigin,
      },
      method: "POST",
    });
    const initialCookie = cookiePair(created, "jingshu_session");
    const initialContextResponse = await concurrentApp.request(
      "/api/v1/demo/context",
      { headers: { Cookie: initialCookie } },
    );
    const initialContext =
      (await initialContextResponse.json()) as RoleContextReadyResponse;

    pauseReplay = true;
    const replayPromise = concurrentApp.request("/api/v1/public/sandboxes", {
      body: JSON.stringify({ role: "staff" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: `${visitorCookie}; ${initialCookie}`,
        "Idempotency-Key": creationKey,
        Origin: publicOrigin,
      },
      method: "POST",
    });
    await replayRead;

    const switched = await concurrentApp.request(
      "/api/v1/demo/context/switch",
      {
        body: JSON.stringify({ targetRole: "manager" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: initialCookie,
          Origin: publicOrigin,
          "X-CSRF-Token": initialContext.csrfToken,
        },
        method: "POST",
      },
    );
    expect(switched.status).toBe(200);
    const switchedCookie = cookiePair(switched, "jingshu_session");
    releaseReplay?.();

    const replay = await replayPromise;
    expect(replay.status).toBe(200);
    expect(replay.headers.get("set-cookie")).toBeNull();
    await expect(replay.json()).resolves.toMatchObject({
      replayed: true,
      role: "staff",
      persona: { displayName: "周宁" },
    });

    const current = await concurrentApp.request("/api/v1/demo/context", {
      headers: { Cookie: switchedCookie },
    });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      contextVersion: 2,
      role: { id: "manager" },
    });
  });

  it("recovers the canonical current session after a role-switch response is lost", async () => {
    const initial = await createRoleSession("staff");
    const switched = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });
    expect(switched.status).toBe(200);

    const stale = await app.request("/api/v1/demo/context", {
      headers: { Cookie: initial.sessionCookie },
    });
    expect(stale.status).toBe(409);

    const invalidOrigin = await app.request("/api/v1/demo/context/refresh", {
      body: JSON.stringify({ mode: "canonical" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: "https://attacker.example",
      },
      method: "POST",
    });
    expect(invalidOrigin.status).toBe(403);

    const recovered = await app.request("/api/v1/demo/context/refresh", {
      body: JSON.stringify({ mode: "canonical" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: publicOrigin,
      },
      method: "POST",
    });
    expect(recovered.status).toBe(200);
    const recoveredCookie = cookiePair(recovered, "jingshu_session");
    await expect(recovered.clone().json()).resolves.toMatchObject({
      contextVersion: 2,
      role: { id: "manager" },
      persona: { displayName: "许知远" },
    });
    expect(decodeSession(recoveredCookie)).toMatchObject({
      contextVersion: 2,
      role: "manager",
    });

    const current = await app.request("/api/v1/demo/context", {
      headers: { Cookie: recoveredCookie },
    });
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({
      contextVersion: 2,
      role: { id: "manager" },
    });
  });

  it("does not rotate a canonical shared-browser session during another tab's refresh", async () => {
    const initial = await createRoleSession("staff");
    const switched = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });
    const switchedCookie = cookiePair(switched, "jingshu_session");
    const switchedBody = (await switched
      .clone()
      .json()) as RoleContextReadyResponse;

    const refreshed = await app.request("/api/v1/demo/context/refresh", {
      body: JSON.stringify({
        mode: "canonical",
        pageContextVersion: initial.context.contextVersion,
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: switchedCookie,
        Origin: publicOrigin,
      },
      method: "POST",
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("set-cookie")).toBeNull();
    await expect(refreshed.json()).resolves.toMatchObject({
      contextVersion: switchedBody.contextVersion,
      csrfToken: switchedBody.csrfToken,
      role: { id: "manager" },
    });

    const stillWritable = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "hq" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: switchedCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": switchedBody.csrfToken,
      },
      method: "POST",
    });
    expect(stillWritable.status).toBe(200);
  });

  it("lets a queued recovery fence win before an already in-flight switch", async () => {
    const initial = await createRoleSession("staff");
    const initialSession = decodeSession(initial.sessionCookie);
    for (const suppliedCsrf of [
      undefined,
      "incorrect-csrf-token-value-00000000",
    ]) {
      const rejected = await app.request("/api/v1/demo/context/refresh", {
        body: JSON.stringify({
          mode: "switch-outcome-unknown",
          pageContextVersion: initial.context.contextVersion,
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: initial.sessionCookie,
          Origin: publicOrigin,
          ...(suppliedCsrf ? { "X-CSRF-Token": suppliedCsrf } : {}),
        },
        method: "POST",
      });
      expect(rejected.status).toBe(409);
      await expect(rejected.json()).resolves.toMatchObject({
        error: { code: "ROLE_CONTEXT_STALE" },
      });
    }

    const blocker = await lockSandboxRow(initialSession.sandboxId as string);
    let blockerReleased = false;
    const recoveredPromise = app.request("/api/v1/demo/context/refresh", {
      body: JSON.stringify({
        mode: "switch-outcome-unknown",
        pageContextVersion: initial.context.contextVersion,
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });
    let lateSwitchPromise: Promise<Response> | undefined;
    try {
      await waitForWaitingSandboxTransactions(1);
      lateSwitchPromise = app.request("/api/v1/demo/context/switch", {
        body: JSON.stringify({ targetRole: "manager" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: initial.sessionCookie,
          Origin: publicOrigin,
          "X-CSRF-Token": initial.csrfToken,
        },
        method: "POST",
      });
      await waitForWaitingSandboxTransactions(2);
      await blocker.query("commit");
      blockerReleased = true;

      const [recovered, lateSwitch] = await Promise.all([
        recoveredPromise,
        lateSwitchPromise,
      ]);
      expect(recovered.status).toBe(200);
      const recoveredCookie = cookiePair(recovered, "jingshu_session");
      await expect(recovered.clone().json()).resolves.toMatchObject({
        contextVersion: 2,
        role: { id: "staff" },
      });
      expect(lateSwitch.status).toBe(409);

      const current = await app.request("/api/v1/demo/context", {
        headers: { Cookie: recoveredCookie },
      });
      expect(current.status).toBe(200);
      await expect(current.json()).resolves.toMatchObject({
        contextVersion: 2,
        role: { id: "staff" },
      });
    } finally {
      if (!blockerReleased) await blocker.query("rollback");
      await blocker.end();
      await Promise.allSettled(
        lateSwitchPromise
          ? [recoveredPromise, lateSwitchPromise]
          : [recoveredPromise],
      );
    }
  });

  it("lets an in-flight switch win before a queued unknown-outcome recovery", async () => {
    const initial = await createRoleSession("staff");
    const initialSession = decodeSession(initial.sessionCookie);
    const blocker = await lockSandboxRow(initialSession.sandboxId as string);
    let blockerReleased = false;
    const switchedPromise = app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });
    let recoveredPromise: Promise<Response> | undefined;
    try {
      await waitForWaitingSandboxTransactions(1);
      recoveredPromise = app.request("/api/v1/demo/context/refresh", {
        body: JSON.stringify({
          mode: "switch-outcome-unknown",
          pageContextVersion: initial.context.contextVersion,
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: initial.sessionCookie,
          Origin: publicOrigin,
          "X-CSRF-Token": initial.csrfToken,
        },
        method: "POST",
      });
      await waitForWaitingSandboxTransactions(2);
      await blocker.query("commit");
      blockerReleased = true;

      const [switched, recovered] = await Promise.all([
        switchedPromise,
        recoveredPromise,
      ]);
      expect(switched.status).toBe(200);
      expect(recovered.status).toBe(200);
      const recoveredCookie = cookiePair(recovered, "jingshu_session");
      await expect(recovered.clone().json()).resolves.toMatchObject({
        contextVersion: 2,
        role: { id: "manager" },
      });
      const current = await app.request("/api/v1/demo/context", {
        headers: { Cookie: recoveredCookie },
      });
      expect(current.status).toBe(200);
      await expect(current.json()).resolves.toMatchObject({
        contextVersion: 2,
        role: { id: "manager" },
      });
    } finally {
      if (!blockerReleased) await blocker.query("rollback");
      await blocker.end();
      await Promise.allSettled(
        recoveredPromise
          ? [switchedPromise, recoveredPromise]
          : [switchedPromise],
      );
    }
  });

  it("upgrades a still-valid legacy v1 session and claims a rolling-writer role", async () => {
    const initial = await createRoleSession("staff");
    const payload = decodeSession(initial.sessionCookie);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        "update sandboxes set role_context_role = null where id = $1",
        [payload.sandboxId],
      );
    } finally {
      await client.end();
    }
    const legacyCookie = issueLegacySession({
      expiresAt: payload.expiresAt as string,
      role: "staff",
      sandboxId: payload.sandboxId as string,
    });

    const upgraded = await app.request("/api/v1/demo/context", {
      headers: { Cookie: legacyCookie },
    });
    expect(upgraded.status).toBe(200);
    const upgradedCookie = cookiePair(upgraded, "jingshu_session");
    expect(decodeSession(upgradedCookie)).toMatchObject({
      version: 2,
      contextVersion: 1,
      role: "staff",
    });
    await expect(upgraded.json()).resolves.toMatchObject({
      contextVersion: 1,
      role: { id: "staff" },
      persona: { displayName: "周宁" },
    });

    const claimed = new Client({ connectionString: databaseUrl });
    await claimed.connect();
    try {
      const role = await claimed.query<{ role_context_role: string | null }>(
        "select role_context_role from sandboxes where id = $1",
        [payload.sandboxId],
      );
      expect(role.rows).toEqual([{ role_context_role: "staff" }]);
    } finally {
      await claimed.end();
    }
  });

  it("maps a missing sandbox during role switching to an unavailable context", async () => {
    const initial = await createRoleSession("staff");
    const session = decodeSession(initial.sessionCookie);
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query("delete from sandboxes where id = $1", [
        session.sandboxId,
      ]);
    } finally {
      await client.end();
    }

    const response = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ROLE_CONTEXT_UNAVAILABLE" },
    });
  });

  it("enforces the allow and deny matrix through a real API and Postgres context", async () => {
    const customer = await createRoleSession("customer");
    const staff = await createRoleSession("staff");
    const manager = await createRoleSession("manager");
    const hq = await createRoleSession("hq");
    const customerPayload = decodeSession(customer.sessionCookie);
    const staffPayload = decodeSession(staff.sessionCookie);
    const managerPayload = decodeSession(manager.sessionCookie);
    const hqPayload = decodeSession(hq.sessionCookie);
    const hqStores = hqPayload.storeIds as string[];
    expect(customerPayload).toMatchObject({
      personaId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      sandboxId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
    });

    const ownRecordAccess = await accessCheck(
      customer,
      "customer:manage-own-records",
      {
        id: customerPayload.personaId as string,
        kind: "persona",
      },
    );
    expect(
      ownRecordAccess.status,
      JSON.stringify(await ownRecordAccess.clone().json()),
    ).toBe(200);
    const crossPersonaDenial = await accessCheck(
      customer,
      "customer:manage-own-records",
      {
        id: staffPayload.personaId as string,
        kind: "persona",
      },
    );
    expect(crossPersonaDenial.status).toBe(403);

    expect(
      (
        await accessCheck(staff, "store:perform-frontline", {
          id: (staffPayload.storeIds as string[])[0] as string,
          kind: "store",
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await accessCheck(staff, "store:perform-frontline", {
          id: hqStores[1] as string,
          kind: "store",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await accessCheck(staff, "store:adjust-inventory", {
          id: (staffPayload.storeIds as string[])[0] as string,
          kind: "store",
        })
      ).status,
    ).toBe(403);

    for (const capability of [
      "store:perform-frontline",
      "store:adjust-inventory",
      "store:configure",
      "store:manage-people",
      "audit:view",
    ] as const) {
      expect(
        (
          await accessCheck(manager, capability, {
            id: (managerPayload.storeIds as string[])[0] as string,
            kind: "store",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await accessCheck(manager, capability, {
            id: hqStores[2] as string,
            kind: "store",
          })
        ).status,
      ).toBe(403);
    }

    for (const storeId of hqStores) {
      for (const capability of ["store:configure", "audit:view"] as const) {
        expect(
          (
            await accessCheck(hq, capability, {
              id: storeId,
              kind: "store",
            })
          ).status,
        ).toBe(200);
      }
      for (const capability of [
        "store:perform-frontline",
        "store:adjust-inventory",
        "store:manage-people",
      ] as const) {
        expect(
          (
            await accessCheck(hq, capability, {
              id: storeId,
              kind: "store",
            })
          ).status,
        ).toBe(403);
      }
    }
    for (const capability of [
      "chain:compare",
      "chain:configure",
      "chain:maintain-catalogs",
    ] as const) {
      expect(
        (
          await accessCheck(hq, capability, {
            id: hqPayload.sandboxId as string,
            kind: "sandbox",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await accessCheck(hq, capability, {
            id: customerPayload.sandboxId as string,
            kind: "sandbox",
          })
        ).status,
      ).toBe(403);
    }

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const denialAudit = await client.query<{
        action: string;
        object_id: string | null;
        object_type: string;
        reason: string | null;
        result: string;
        store_id: string | null;
      }>(
        `select action, object_id, object_type, reason, result, store_id
           from audit_events where request_id = $1`,
        [crossPersonaDenial.headers.get("x-request-id")],
      );
      expect(denialAudit.rows).toEqual([
        {
          action: "role_capability.check",
          object_id: staffPayload.personaId,
          object_type: "demo_persona",
          reason: "capability_denied",
          result: "denied",
          store_id: null,
        },
      ]);
    } finally {
      await client.end();
    }
  });

  it("rejects invalid origins and forged role-scope fields without rotating context", async () => {
    const initial = await createRoleSession("staff");
    const invalidOrigin = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: "https://attacker.example",
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });
    expect(invalidOrigin.status).toBe(403);
    await expect(invalidOrigin.json()).resolves.toMatchObject({
      error: { code: "INVALID_REQUEST_ORIGIN" },
    });

    const forged = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({
        targetRole: "manager",
        personaId: "00000000-0000-4000-8000-000000000999",
        sandboxId: "00000000-0000-4000-8000-000000000998",
        storeId: "00000000-0000-4000-8000-000000000997",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: initial.sessionCookie,
        Origin: publicOrigin,
        "X-CSRF-Token": initial.csrfToken,
      },
      method: "POST",
    });
    expect(forged.status).toBe(400);
    await expect(forged.json()).resolves.toMatchObject({
      error: { code: "INVALID_ROLE_SWITCH_REQUEST" },
    });

    for (const invalidBody of ["null", "[]", "42"]) {
      const malformed = await app.request("/api/v1/demo/context/switch", {
        body: invalidBody,
        headers: {
          "Content-Type": "application/json",
          Cookie: initial.sessionCookie,
          Origin: publicOrigin,
          "X-CSRF-Token": initial.csrfToken,
        },
        method: "POST",
      });
      expect(malformed.status).toBe(400);
      await expect(malformed.json()).resolves.toMatchObject({
        error: { code: "INVALID_ROLE_SWITCH_REQUEST" },
      });
    }

    const unchanged = await app.request("/api/v1/demo/context", {
      headers: { Cookie: initial.sessionCookie },
    });
    expect(unchanged.status).toBe(200);
    await expect(unchanged.json()).resolves.toMatchObject({
      contextVersion: 1,
      role: { id: "staff" },
      persona: { displayName: "周宁" },
      storeScope: {
        stores: [{ code: "prism-flagship" }],
      },
    });
  });

  it("attributes headquarters denials to the chain rather than an arbitrary first store", async () => {
    const hq = await createRoleSession("hq");
    const denied = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "staff" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: hq.sessionCookie,
        Origin: "https://attacker.example",
        "X-CSRF-Token": hq.csrfToken,
      },
      method: "POST",
    });
    expect(denied.status).toBe(403);

    const client = new Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      const audit = await client.query<{ store_id: string | null }>(
        "select store_id from audit_events where request_id = $1",
        [denied.headers.get("x-request-id")],
      );
      expect(audit.rows).toEqual([{ store_id: null }]);
    } finally {
      await client.end();
    }
  });
});
