import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type {
  HeadquartersCatalogCommandResponse,
  HeadquartersCatalogsResponse,
  RoleContextReadyResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const publicOrigin = "https://arena.example";
const fixedTime = new Date("2026-08-11T11:30:00.000Z");
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => fixedTime },
});
const sql = new Pool({ connectionString: databaseUrl });
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  secureCookies: true,
  sessionSecret: "ticket-24-headquarters-catalog-secret",
  wallClock: { now: () => fixedTime },
});

beforeAll(async () => migrateEmptyDatabase(databaseUrl));
afterAll(async () => {
  await database.close();
  await sql.end();
});

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`)) throw new Error(`Expected ${name}.`);
  return pair;
}

async function createRoleSession(role: "hq" | "manager" | "staff") {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie = cookiePair(visitor, "jingshu_visitor");
  const created = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role }),
    headers: {
      "Content-Type": "application/json",
      Cookie: visitorCookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: publicOrigin,
    },
    method: "POST",
  });
  const cookie = cookiePair(created, "jingshu_session");
  const contextResponse = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  return {
    context: (await contextResponse.json()) as RoleContextReadyResponse,
    cookie,
  };
}

async function command(
  session: Awaited<ReturnType<typeof createRoleSession>>,
  body: Record<string, unknown>,
) {
  return app.request("/api/v1/hq/catalogs/commands", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Cookie: session.cookie,
      "Idempotency-Key": crypto.randomUUID(),
      Origin: publicOrigin,
      "X-CSRF-Token": session.context.csrfToken,
    },
    method: "POST",
  });
}

describe("headquarters catalog API", () => {
  it("returns WEB-H03 and WEB-H04 data and accepts catalog-specific commands", async () => {
    const hq = await createRoleSession("hq");
    const read = await app.request("/api/v1/hq/catalogs", {
      headers: { Cookie: hq.cookie },
    });
    const catalogs = (await read.json()) as HeadquartersCatalogsResponse;
    expect(read.status).toBe(200);
    expect(catalogs.status).toBe("ready");
    expect(catalogs.products).toHaveLength(12);
    expect(catalogs.machineProfiles.map((profile) => profile.code)).toEqual([
      "standard",
      "competitive",
      "flagship",
    ]);

    const createdResponse = await command(hq, {
      action: "create-product",
      availableStoreIds: catalogs.stores
        .slice(0, 2)
        .map((store) => store.storeId),
      category: "snack",
      code: "starlight-crisp",
      description: "轻脆咸味零食 · 独立包装",
      displayName: "星光脆片",
    });
    const created =
      (await createdResponse.json()) as HeadquartersCatalogCommandResponse;
    expect(createdResponse.status).toBe(200);
    expect(created).toMatchObject({
      action: "create-product",
      replayed: false,
      status: "ready",
      version: 1,
    });

    const machine = catalogs.machineProfiles[0]!;
    const archivedResponse = await command(hq, {
      action: "archive-machine-profile",
      expectedVersion: machine.version,
      machineProfileId: machine.machineProfileId,
    });
    expect(archivedResponse.status).toBe(200);
    expect(await archivedResponse.json()).toMatchObject({
      action: "archive-machine-profile",
      version: 2,
    });
  });

  it("denies non-HQ roles and rejects store-operation-shaped commands", async () => {
    const manager = await createRoleSession("manager");
    const staff = await createRoleSession("staff");
    for (const session of [manager, staff]) {
      const read = await app.request("/api/v1/hq/catalogs", {
        headers: { Cookie: session.cookie },
      });
      expect(read.status).toBe(403);
      const denied = await command(session, {
        action: "create-machine-profile",
        code: "forbidden",
        displayName: "不可用",
        experienceDescription: "不可用",
      });
      expect(denied.status).toBe(403);
    }

    const hq = await createRoleSession("hq");
    const rejected = await command(hq, {
      action: "set-store-price",
      storeId: crypto.randomUUID(),
      unitPriceCents: 100,
    });
    expect(rejected.status).toBe(422);
    const deniedAudits = await sql.query<{ count: number }>(
      `select count(*)::integer as count from audit_events
        where result = 'denied' and reason = 'capability_denied'`,
    );
    expect(deniedAudits.rows[0]!.count).toBeGreaterThanOrEqual(4);
  });
});
