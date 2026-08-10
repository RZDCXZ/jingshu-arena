import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  RoleContextReadyResponse,
  StoreInventoryResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  ManagerInventoryConflictError,
  migrateEmptyDatabase,
  type PublicSandboxDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => fixedTime },
});
const publicOrigin = "https://arena.example";
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  sessionSecret: "ticket-13-manager-inventory-secret-32-bytes",
  secureCookies: true,
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`)) {
    throw new Error(`Expected ${name} cookie.`);
  }
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
  expect(created.status).toBe(201);
  const cookie = cookiePair(created, "jingshu_session");
  const contextResponse = await app.request("/api/v1/demo/context", {
    headers: { Cookie: cookie },
  });
  expect(contextResponse.status).toBe(200);
  return {
    context: (await contextResponse.json()) as RoleContextReadyResponse,
    cookie,
  };
}

describe("store inventory API", () => {
  it("returns the same store-scoped ledger to staff and manager roles", async () => {
    for (const role of ["staff", "manager"] as const) {
      const session = await createRoleSession(role);
      const response = await app.request("/api/v1/store/inventory", {
        headers: { Cookie: session.cookie },
      });
      expect(response.status).toBe(200);
      const inventory = (await response.json()) as StoreInventoryResponse;
      expect(inventory).toMatchObject({
        status: "ready",
        store: { code: "prism-flagship", displayName: "棱镜旗舰店" },
        summary: {
          alertCount: 3,
          itemCount: 20,
          productCount: 12,
          spareCount: 8,
        },
      });
      expect(inventory.items).toHaveLength(20);
    }
  });

  it("accepts only a manager's specialized command and safely replays it", async () => {
    const manager = await createRoleSession("manager");
    const inventoryResponse = await app.request("/api/v1/store/inventory", {
      headers: { Cookie: manager.cookie },
    });
    const inventory =
      (await inventoryResponse.json()) as StoreInventoryResponse;
    const item = inventory.items.find((candidate) => candidate.alerting)!;
    const quantity = item.lowStockThreshold + 1 - item.availableQuantity;
    const idempotencyKey = crypto.randomUUID();
    const submit = (session: typeof manager, key = idempotencyKey) =>
      app.request("/api/v1/store/inventory/commands", {
        body: JSON.stringify({
          action: "receipt",
          inventoryItemId: item.inventoryItemId,
          quantity,
          reason: "门店补货到货，店长已复核数量。",
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookie,
          "Idempotency-Key": key,
          Origin: publicOrigin,
          "X-CSRF-Token": session.context.csrfToken,
        },
        method: "POST",
      });

    const first = await submit(manager);
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      action: "receipt",
      alertTransition: "resolved",
      replayed: false,
    });
    const replay = await submit(manager);
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ replayed: true });

    const staff = await createRoleSession("staff");
    const denied = await submit(staff, crypto.randomUUID());
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: "INVENTORY_MANAGER_REQUIRED" },
    });
    const hq = await createRoleSession("hq");
    const hqDenied = await submit(hq, crypto.randomUUID());
    expect(hqDenied.status).toBe(403);
  });

  it("rejects generic or unsafe inventory command bodies before persistence", async () => {
    const session = await createRoleSession("manager");
    const inventoryResponse = await app.request("/api/v1/store/inventory", {
      headers: { Cookie: session.cookie },
    });
    const inventory =
      (await inventoryResponse.json()) as StoreInventoryResponse;
    const item = inventory.items[0]!;
    const response = await app.request("/api/v1/store/inventory/commands", {
      body: JSON.stringify({
        action: "receipt",
        command: "set stock to 999",
        inventoryItemId: item.inventoryItemId,
        quantity: 1,
        reason: "<script>",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: session.cookie,
        "Idempotency-Key": crypto.randomUUID(),
        Origin: publicOrigin,
        "X-CSRF-Token": session.context.csrfToken,
      },
      method: "POST",
    });

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVENTORY_COMMAND_INVALID" },
    });
  });

  it("does not reveal whether a denied inventory item exists in another store", async () => {
    const session = await createRoleSession("manager");
    const inventoryResponse = await app.request("/api/v1/store/inventory", {
      headers: { Cookie: session.cookie },
    });
    const inventory =
      (await inventoryResponse.json()) as StoreInventoryResponse;
    const requestAgainst = async (reason: "cross-store" | "not-found") => {
      const mappingApp = createApp({
        allowedOrigins: [publicOrigin],
        sandboxDatabase: {
          executeManagerInventoryCommand: async () => {
            throw new ManagerInventoryConflictError(reason);
          },
        } as unknown as PublicSandboxDatabase,
        sessionSecret: "ticket-13-manager-inventory-secret-32-bytes",
        secureCookies: true,
      });
      return mappingApp.request("/api/v1/store/inventory/commands", {
        body: JSON.stringify({
          action: "receipt",
          inventoryItemId: inventory.items[0]!.inventoryItemId,
          quantity: 1,
          reason: "测试门店范围拒绝时的对外错误映射。",
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: session.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": session.context.csrfToken,
        },
        method: "POST",
      });
    };

    const crossStore = await requestAgainst("cross-store");
    const missing = await requestAgainst("not-found");
    const crossStoreBody = (await crossStore.json()) as {
      error: { code: string; message: string };
    };
    const missingBody = (await missing.json()) as {
      error: { code: string; message: string };
    };
    expect(crossStore.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(crossStoreBody.error.code).toBe(missingBody.error.code);
    expect(crossStoreBody.error.message).toBe(missingBody.error.message);
  });
});
