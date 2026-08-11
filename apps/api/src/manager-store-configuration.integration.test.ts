import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type {
  ManagerPricePlanOverlapPreviewResponse,
  ManagerStoreConfigurationResponse,
  RoleContextReadyResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
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
const sql = new Pool({ connectionString: databaseUrl });
const publicOrigin = "https://arena.example";
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  sessionSecret: "ticket-19-manager-store-config-secret-32-bytes",
  secureCookies: true,
});

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
  await sql.end();
});

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`))
    throw new Error(`Expected ${name} cookie.`);
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

describe("manager store configuration API", () => {
  it("returns the manager's authoritative fixed-store configuration", async () => {
    const manager = await createRoleSession("manager");

    const response = await app.request("/api/v1/manager/store-configuration", {
      headers: { Cookie: manager.cookie },
    });
    const payload =
      (await response.json()) as ManagerStoreConfigurationResponse;

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: "ready",
      store: {
        code: "prism-flagship",
        displayName: "棱镜旗舰店",
        fictitiousCity: "栖光市（虚构）",
        fixed: true,
      },
    });
    expect(payload.areas).toHaveLength(4);
    expect(payload.seats).toHaveLength(96);
    expect(payload.pricePlans.length).toBeGreaterThan(0);
    expect(payload.products).toHaveLength(12);
  });

  it("previews price overlap with the server-authoritative domain rule", async () => {
    const manager = await createRoleSession("manager");
    const configurationResponse = await app.request(
      "/api/v1/manager/store-configuration",
      { headers: { Cookie: manager.cookie } },
    );
    const configuration =
      (await configurationResponse.json()) as ManagerStoreConfigurationResponse;
    const current = configuration.pricePlans.find(
      (plan) => plan.status === "current",
    )!;
    const preview = (body: Record<string, unknown>) =>
      app.request("/api/v1/manager/store-configuration/price-overlap-preview", {
        body: JSON.stringify(body),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      });
    const candidate = {
      areaId: current.area.areaId,
      effectiveFrom: "2026-08-10T12:30:00.000Z",
      endsAt: current.endsAt,
      endsNextDay: current.endsNextDay,
      machineProfileId: current.machineProfile.machineProfileId,
      startsAt: current.startsAt,
    };

    const exactResponse = await preview(candidate);
    expect(exactResponse.status).toBe(200);
    await expect(exactResponse.json()).resolves.toEqual({
      overlap: null,
      status: "ready",
    } satisfies ManagerPricePlanOverlapPreviewResponse);

    const conflictResponse = await preview({
      ...candidate,
      endsAt: "06:00",
      endsNextDay: true,
      startsAt: "06:00",
    });
    expect(conflictResponse.status).toBe(200);
    await expect(conflictResponse.json()).resolves.toMatchObject({
      overlap: {
        pricePlanId: current.pricePlanId,
        status: "current",
        version: current.version,
      },
      status: "ready",
    } satisfies ManagerPricePlanOverlapPreviewResponse);
  });

  it("accepts dedicated price and store-product commands while keeping the manager store authoritative", async () => {
    const manager = await createRoleSession("manager");
    const beforeResponse = await app.request(
      "/api/v1/manager/store-configuration",
      { headers: { Cookie: manager.cookie } },
    );
    const before =
      (await beforeResponse.json()) as ManagerStoreConfigurationResponse;
    const plan = before.pricePlans[0]!;
    const effectiveFrom = "2026-08-10T12:30:00.000Z";
    const priceResponse = await app.request(
      "/api/v1/manager/store-configuration/commands",
      {
        body: JSON.stringify({
          action: "create-price-plan",
          areaId: plan.area.areaId,
          effectiveFrom,
          endsAt: plan.endsAt,
          endsNextDay: plan.endsNextDay,
          expectedVersion: before.store.version,
          machineProfileId: plan.machineProfile.machineProfileId,
          startsAt: plan.startsAt,
          storeId: before.store.storeId,
          weekdayHalfHourCents: 980,
          weekendHalfHourCents: 1_180,
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(priceResponse.status).toBe(200);

    const afterPriceResponse = await app.request(
      "/api/v1/manager/store-configuration",
      { headers: { Cookie: manager.cookie } },
    );
    const afterPrice =
      (await afterPriceResponse.json()) as ManagerStoreConfigurationResponse;
    expect(afterPrice.pricePlans).toContainEqual(
      expect.objectContaining({
        effectiveFrom,
        status: "scheduled",
        weekdayHalfHourCents: 980,
      }),
    );
    const product = afterPrice.products.find((candidate) => candidate.listed)!;
    const productResponse = await app.request(
      "/api/v1/manager/store-configuration/commands",
      {
        body: JSON.stringify({
          action: "update-store-product",
          expectedVersion: product.version,
          listed: false,
          lowStockThreshold: product.lowStockThreshold + 1,
          storeId: afterPrice.store.storeId,
          storeProductId: product.storeProductId,
          unitPriceCents: product.unitPriceCents + 100,
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(productResponse.status).toBe(200);
  });

  it("accepts dedicated manager commands, safely replays them, and reads the confirmed result", async () => {
    const manager = await createRoleSession("manager");
    const beforeResponse = await app.request(
      "/api/v1/manager/store-configuration",
      { headers: { Cookie: manager.cookie } },
    );
    const before =
      (await beforeResponse.json()) as ManagerStoreConfigurationResponse;
    const idempotencyKey = crypto.randomUUID();
    const submit = () =>
      app.request("/api/v1/manager/store-configuration/commands", {
        body: JSON.stringify({
          action: "update-store-profile",
          displayName: "棱镜旗舰演示门店",
          expectedVersion: before.store.version,
          fictitiousCity: "栖光市（虚构）",
          introduction: "服务端确认后才展示成功的固定虚构演示门店。",
          storeId: before.store.storeId,
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          "Idempotency-Key": idempotencyKey,
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      });

    const saved = await submit();
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({ replayed: false });
    const replayed = await submit();
    await expect(replayed.json()).resolves.toMatchObject({ replayed: true });
    const confirmedResponse = await app.request(
      "/api/v1/manager/store-configuration",
      { headers: { Cookie: manager.cookie } },
    );
    await expect(confirmedResponse.json()).resolves.toMatchObject({
      store: { displayName: "棱镜旗舰演示门店" },
    });
  });

  it("denies staff and headquarters roles and rejects generic configuration commands", async () => {
    for (const role of ["staff", "hq"] as const) {
      const session = await createRoleSession(role);
      const response = await app.request(
        "/api/v1/manager/store-configuration",
        { headers: { Cookie: session.cookie } },
      );
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "STORE_CONFIGURATION_MANAGER_REQUIRED" },
      });
    }

    const manager = await createRoleSession("manager");
    const response = await app.request(
      "/api/v1/manager/store-configuration/commands",
      {
        body: JSON.stringify({
          action: "create-store",
          command: "disable another store",
          status: "disabled",
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(response.status).toBe(422);
    const payload = (await response.json()) as {
      error: { code: string; requestId: string };
    };
    expect(payload).toMatchObject({
      error: { code: "STORE_CONFIGURATION_COMMAND_INVALID" },
    });
    const denied = await sql.query<{
      action: string;
      after_data: unknown;
      reason: string;
      result: string;
    }>(
      `select action, after_data, reason, result from audit_events
        where request_id = $1`,
      [payload.error.requestId],
    );
    expect(denied.rows).toEqual([
      {
        action: "role_capability.check",
        after_data: null,
        reason: "capability_denied",
        result: "denied",
      },
    ]);

    const missingIdempotency = await app.request(
      "/api/v1/manager/store-configuration/commands",
      {
        body: JSON.stringify({ action: "delete-store" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(missingIdempotency.status).toBe(422);
    const missingIdempotencyPayload = (await missingIdempotency.json()) as {
      error: { code: string; requestId: string };
    };
    expect(missingIdempotencyPayload).toMatchObject({
      error: { code: "STORE_CONFIGURATION_IDEMPOTENCY_REQUIRED" },
    });
    const deniedWithoutIdempotency = await sql.query<{
      action: string;
      reason: string;
      result: string;
    }>(
      `select action, reason, result from audit_events
        where request_id = $1`,
      [missingIdempotencyPayload.error.requestId],
    );
    expect(deniedWithoutIdempotency.rows).toEqual([
      {
        action: "role_capability.check",
        reason: "capability_denied",
        result: "denied",
      },
    ]);
  });

  it("returns dependency details instead of deactivating a busy seat", async () => {
    const manager = await createRoleSession("manager");
    const configurationResponse = await app.request(
      "/api/v1/manager/store-configuration",
      { headers: { Cookie: manager.cookie } },
    );
    const configuration =
      (await configurationResponse.json()) as ManagerStoreConfigurationResponse;
    const blocked = configuration.seats.find(
      (seat) =>
        seat.dependencies.activeReservations > 0 ||
        seat.dependencies.openRepairs > 0,
    )!;
    const response = await app.request(
      "/api/v1/manager/store-configuration/commands",
      {
        body: JSON.stringify({
          action: "update-seat",
          areaId: blocked.area.areaId,
          code: blocked.code,
          expectedVersion: blocked.version,
          lifecycleStatus: "inactive",
          machineProfileId: blocked.machineProfile.machineProfileId,
          seatId: blocked.seatId,
          sortOrder: blocked.sortOrder,
          storeId: configuration.store.storeId,
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STORE_SEAT_DEPENDENCIES" },
    });
  });

  it("rejects oversized configuration payloads before they can reach persistent audit", async () => {
    const manager = await createRoleSession("manager");
    const response = await app.request(
      "/api/v1/manager/store-configuration/commands",
      {
        body: JSON.stringify({
          action: "update-store-profile",
          displayName: "超大负载",
          expectedVersion: 1,
          fictitiousCity: "栖光市（虚构）",
          introduction: "x".repeat(8 * 1024),
          storeId: "00000000-0000-4000-8000-000000000001",
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: manager.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": manager.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "STORE_CONFIGURATION_BODY_TOO_LARGE" },
    });
  });
});
