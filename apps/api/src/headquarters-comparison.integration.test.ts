import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  HeadquartersAuditResponse as HeadquartersAuditContractResponse,
  ManagerDashboardResponse,
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
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  secureCookies: true,
  sessionSecret: "ticket-26-headquarters-comparison-secret",
  wallClock: { now: () => fixedTime },
});

beforeAll(async () => migrateEmptyDatabase(databaseUrl));
afterAll(async () => database.close());

function cookiePair(response: Response, name: string) {
  const pair = response.headers.get("set-cookie")?.split(";", 1)[0];
  if (!pair?.startsWith(`${name}=`)) throw new Error(`Expected ${name}.`);
  return pair;
}

async function createHeadquartersSession() {
  const visitor = await app.request("/api/v1/public/visitor");
  const visitorCookie = cookiePair(visitor, "jingshu_visitor");
  const created = await app.request("/api/v1/public/sandboxes", {
    body: JSON.stringify({ role: "hq" }),
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

interface HeadquartersComparisonResponse {
  readonly status: "ready";
  readonly stores: ReadonlyArray<{
    readonly drilldown: ManagerDashboardResponse["drilldown"];
    readonly store: {
      readonly code: string;
      readonly displayName: string;
      readonly storeId: string;
    };
    readonly summary: ManagerDashboardResponse["summary"];
  }>;
}

interface HeadquartersAuditResponse {
  readonly status: "ready";
  readonly events: HeadquartersAuditContractResponse["events"];
  readonly stores: ReadonlyArray<{
    readonly code: string;
    readonly displayName: string;
    readonly storeId: string;
  }>;
  readonly totalCount: number;
}

interface HeadquartersExportPreviewResponse {
  readonly status: "ready";
  readonly columns: ReadonlyArray<string>;
  readonly estimatedRowCount: number;
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly stores: ReadonlyArray<{ readonly storeId: string }>;
}

describe("headquarters comparison API", () => {
  it("records multi-store exports atomically when every store is valid", async () => {
    const world = await database.create({
      creationKey: crypto.randomUUID(),
      selectedRole: "hq",
      visitorKey: `ticket-26-${crypto.randomUUID()}`,
    });
    const context = {
      contextVersion: world.roleContext.contextVersion,
      personaId: world.roleContext.persona.id,
      role: "hq" as const,
      sandboxId: world.sandboxId,
    };
    const catalogs = await database.readHeadquartersCatalogs(context);

    await expect(
      database.recordHeadquartersExport({
        ...context,
        dataType: "reservations",
        filters: {},
        fromBusinessDay: "2026-08-11",
        requestId: crypto.randomUUID(),
        sort: { direction: "asc", field: "businessOccurredAt" },
        stores: [
          { rowCount: 1, storeId: catalogs.stores[0]!.storeId },
          { rowCount: 1, storeId: crypto.randomUUID() },
        ],
        toBusinessDay: "2026-08-11",
      }),
    ).rejects.toMatchObject({ code: "MANAGER_AUDIT_EXPORT_INVALID" });

    const audits = await database.readHeadquartersAudits({
      ...context,
      filters: { action: "export.csv" },
      selectedStoreIds: catalogs.stores.map((store) => store.storeId),
      sort: { direction: "asc", field: "recordedAt" },
    });
    expect(audits.events).toHaveLength(0);
  });

  it("compares exactly three stores with the same formula as the manager dashboard", async () => {
    const headquarters = await createHeadquartersSession();
    const comparisonResponse = await app.request(
      "/api/v1/hq/dashboard?from=2026-08-05&to=2026-08-11",
      { headers: { Cookie: headquarters.cookie } },
    );
    const comparison =
      (await comparisonResponse.json()) as HeadquartersComparisonResponse;

    expect(comparisonResponse.status).toBe(200);
    expect(comparison.status).toBe("ready");
    expect(comparison.stores.map((entry) => entry.store.code)).toEqual([
      "prism-flagship",
      "starbridge-standard",
      "apex-new",
    ]);
    expect(
      comparison.stores.every(
        (entry) =>
          entry.summary.revenue.totalCents ===
            entry.summary.revenue.reservationCents +
              entry.summary.revenue.orderCents &&
          entry.summary.seats.normalSeatMinutes ===
            entry.summary.seats.businessSeatMinutes -
              entry.summary.seats.maintenanceMinutes,
      ),
    ).toBe(true);

    const inventoryDrilldownResponse = await app.request(
      `/api/v1/hq/dashboard?storeId=${comparison.stores[0]!.store.storeId}&from=2026-08-05&to=2026-08-05&drilldown=inventory`,
      { headers: { Cookie: headquarters.cookie } },
    );
    const inventoryDrilldown =
      (await inventoryDrilldownResponse.json()) as HeadquartersComparisonResponse;
    expect(inventoryDrilldownResponse.status).toBe(200);
    expect(inventoryDrilldown.stores[0]!.drilldown).toMatchObject({
      fromBusinessDay: "2026-08-11",
      kind: "inventory",
      toBusinessDay: "2026-08-11",
    });
    expect(inventoryDrilldown.stores[0]!.drilldown!.rows).toHaveLength(
      inventoryDrilldown.stores[0]!.summary.inventory.lowStockCount,
    );

    const switched = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: headquarters.cookie,
        Origin: publicOrigin,
        "X-CSRF-Token": headquarters.context.csrfToken,
      },
      method: "POST",
    });
    const managerCookie = cookiePair(switched, "jingshu_session");
    const managerResponse = await app.request(
      "/api/v1/manager/dashboard?from=2026-08-05&to=2026-08-11",
      { headers: { Cookie: managerCookie } },
    );
    const manager = (await managerResponse.json()) as ManagerDashboardResponse;
    expect(managerResponse.status).toBe(200);
    expect(comparison.stores[0]?.summary).toEqual(manager.summary);
  });

  it("reads all three-store audit evidence and exports the exact filtered scope as BOM CSV", async () => {
    const headquarters = await createHeadquartersSession();
    const comparisonResponse = await app.request("/api/v1/hq/dashboard", {
      headers: { Cookie: headquarters.cookie },
    });
    const comparison =
      (await comparisonResponse.json()) as HeadquartersComparisonResponse;
    const storeIds = comparison.stores.map((entry) => entry.store.storeId);

    const createCatalogEvent = await app.request(
      "/api/v1/hq/catalogs/commands",
      {
        body: JSON.stringify({
          action: "create-product",
          availableStoreIds: storeIds,
          category: "drink",
          code: "ticket-26-audit-drink",
          description: "用于验证总部级审计范围的虚构饮品",
          displayName: "审计验证饮品",
        }),
        headers: {
          "Content-Type": "application/json",
          Cookie: headquarters.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": headquarters.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(createCatalogEvent.status).toBe(200);

    const auditsResponse = await app.request(
      "/api/v1/hq/audits?from=2026-07-29&to=2026-08-11&sort=recordedAt:asc",
      { headers: { Cookie: headquarters.cookie } },
    );
    const audits = (await auditsResponse.json()) as HeadquartersAuditResponse;
    expect(auditsResponse.status).toBe(200);
    expect(audits.stores.map((store) => store.storeId)).toEqual(storeIds);
    expect(audits.events).toHaveLength(audits.totalCount);
    expect(audits.events).toContainEqual(
      expect.objectContaining({
        action: "headquarters-catalog.create-product",
        role: "hq",
        store: null,
      }),
    );

    const exportRequest = {
      dataType: "reservations",
      filters: {},
      fromBusinessDay: "2026-07-29",
      sort: { direction: "asc", field: "businessOccurredAt" },
      storeIds,
      toBusinessDay: "2026-08-11",
    };
    const headers = {
      "Content-Type": "application/json",
      Cookie: headquarters.cookie,
      Origin: publicOrigin,
      "X-CSRF-Token": headquarters.context.csrfToken,
    };
    const previewResponse = await app.request("/api/v1/hq/exports/preview", {
      body: JSON.stringify(exportRequest),
      headers,
      method: "POST",
    });
    const preview =
      (await previewResponse.json()) as HeadquartersExportPreviewResponse;
    expect(previewResponse.status).toBe(200);
    expect(preview.stores.map((store) => store.storeId)).toEqual(storeIds);
    expect(preview.columns.slice(0, 2)).toEqual(["门店代码", "门店"]);
    expect(new Set(preview.columns).size).toBe(preview.columns.length);
    expect(preview.rows).toHaveLength(preview.estimatedRowCount);
    expect(preview.estimatedRowCount).toBeGreaterThan(0);

    const auditPreviewResponse = await app.request(
      "/api/v1/hq/exports/preview",
      {
        body: JSON.stringify({
          dataType: "audits",
          filters: {},
          fromBusinessDay: "2026-07-29",
          sort: { direction: "asc", field: "recordedAt" },
          storeIds,
          toBusinessDay: "2026-08-11",
        }),
        headers,
        method: "POST",
      },
    );
    const auditPreview =
      (await auditPreviewResponse.json()) as HeadquartersExportPreviewResponse;
    expect(auditPreviewResponse.status).toBe(200);
    expect(
      auditPreview.columns.filter((column) => column === "门店"),
    ).toHaveLength(1);
    expect(new Set(auditPreview.columns).size).toBe(
      auditPreview.columns.length,
    );
    expect(auditPreview.rows).toContainEqual(
      expect.arrayContaining([
        "chain",
        "连锁范围",
        expect.any(String),
        expect.any(String),
        expect.any(String),
        "沈微",
        "hq",
        "headquarters-catalog.create-product",
      ]),
    );

    const download = await app.request("/api/v1/hq/exports", {
      body: JSON.stringify(exportRequest),
      headers,
      method: "POST",
    });
    const bytes = new Uint8Array(await download.arrayBuffer());
    const csv = new TextDecoder().decode(bytes);
    expect(download.status).toBe(200);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.split("\r\n", 1)[0]).toMatch(/^门店代码,门店,/u);
    expect(Number(download.headers.get("X-Export-Row-Count"))).toBe(
      preview.estimatedRowCount,
    );

    const exportAuditsResponse = await app.request(
      "/api/v1/hq/audits?action=export.csv",
      { headers: { Cookie: headquarters.cookie } },
    );
    const exportAudits =
      (await exportAuditsResponse.json()) as HeadquartersAuditResponse;
    expect(exportAudits.events).toHaveLength(3);
    expect(
      exportAudits.events.every(
        (event) => event.action === "export.csv" && event.role === "hq",
      ),
    ).toBe(true);
  });

  it("rejects frontline commands, non-HQ access, and stores outside the current sandbox", async () => {
    const headquarters = await createHeadquartersSession();
    const otherSandbox = await createHeadquartersSession();
    const otherComparisonResponse = await app.request("/api/v1/hq/dashboard", {
      headers: { Cookie: otherSandbox.cookie },
    });
    const otherComparison =
      (await otherComparisonResponse.json()) as HeadquartersComparisonResponse;
    const otherStoreId = otherComparison.stores[0]!.store.storeId;

    const crossSandbox = await app.request(
      `/api/v1/hq/dashboard?storeId=${otherStoreId}`,
      { headers: { Cookie: headquarters.cookie } },
    );
    expect(crossSandbox.status).toBe(422);

    const frontlineCommand = await app.request(
      `/api/v1/staff/reservations/${crypto.randomUUID()}/commands`,
      {
        body: JSON.stringify({ action: "arrive" }),
        headers: {
          "Content-Type": "application/json",
          Cookie: headquarters.cookie,
          "Idempotency-Key": crypto.randomUUID(),
          Origin: publicOrigin,
          "X-CSRF-Token": headquarters.context.csrfToken,
        },
        method: "POST",
      },
    );
    expect(frontlineCommand.status).toBe(403);

    const switched = await app.request("/api/v1/demo/context/switch", {
      body: JSON.stringify({ targetRole: "manager" }),
      headers: {
        "Content-Type": "application/json",
        Cookie: headquarters.cookie,
        Origin: publicOrigin,
        "X-CSRF-Token": headquarters.context.csrfToken,
      },
      method: "POST",
    });
    const managerCookie = cookiePair(switched, "jingshu_session");
    const headquartersOnly = await app.request("/api/v1/hq/dashboard", {
      headers: { Cookie: managerCookie },
    });
    expect(headquartersOnly.status).toBe(403);
  });
});
