import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import type {
  ApiErrorResponse,
  ManagerPeopleScheduleResponse,
  RoleContextReadyResponse,
} from "@jingshu/contracts";
import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../../../packages/database/src/index.js";

import { createApp } from "./app.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const fixedTime = new Date("2026-08-10T11:47:23.000Z");
const publicOrigin = "https://arena.example";
const database = createPublicSandboxDatabase(databaseUrl, {
  wallClock: { now: () => fixedTime },
});
const sql = new Pool({ connectionString: databaseUrl });
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  secureCookies: true,
  sessionSecret: "ticket-23-manager-audit-export-secret",
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
      "Idempotency-Key": randomUUID(),
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

async function managerFixture() {
  const manager = await createRoleSession("manager");
  const peopleResponse = await app.request("/api/v1/manager/people-schedule", {
    headers: { Cookie: manager.cookie },
  });
  const people = (await peopleResponse.json()) as ManagerPeopleScheduleResponse;
  return { ...manager, storeId: people.store.storeId };
}

interface AuditResponse {
  readonly events: ReadonlyArray<{
    readonly action: string;
    readonly after: Record<string, unknown> | null;
    readonly before: Record<string, unknown> | null;
    readonly objectId: string | null;
    readonly reason: string | null;
    readonly result: "allowed" | "denied";
    readonly store: { readonly storeId: string };
  }>;
  readonly range: {
    readonly fromBusinessDay: string;
    readonly toBusinessDay: string;
  };
  readonly store: { readonly storeId: string };
  readonly totalCount: number;
}

interface ExportPreviewResponse {
  readonly columns: ReadonlyArray<string>;
  readonly dataType: string;
  readonly estimatedRowCount: number;
  readonly range: {
    readonly fromBusinessDay: string;
    readonly toBusinessDay: string;
  };
  readonly rows: ReadonlyArray<ReadonlyArray<string>>;
  readonly status: "ready";
  readonly store: { readonly storeId: string };
}

function commandHeaders(fixture: Awaited<ReturnType<typeof managerFixture>>) {
  return {
    "Content-Type": "application/json",
    Cookie: fixture.cookie,
    Origin: publicOrigin,
    "X-CSRF-Token": fixture.context.csrfToken,
  };
}

function csvLines(csv: string) {
  return csv
    .replace(/^\uFEFF/u, "")
    .trimEnd()
    .split("\r\n");
}

describe("manager audit and CSV export API", () => {
  it("filters only the manager store, strips non-whitelisted differences, and keeps ordinary reads quiet", async () => {
    const manager = await managerFixture();
    const scope = await sql.query<{
      persona_id: string;
      sandbox_id: string;
    }>(
      `select persona.id as persona_id, persona.sandbox_id
         from demo_personas persona
        where persona.store_id = $1 and persona.role = 'manager'`,
      [manager.storeId],
    );
    const actor = scope.rows[0]!;
    await sql.query(
      `insert into audit_events (
         id, sandbox_id, store_id, persona_id, role, action, object_type,
         object_id, result, reason, request_id, before_data, after_data,
         business_occurred_at, recorded_at
       ) values ($1, $2, $3, $4, 'manager', 'test.safe-filter', 'repair',
         $5, 'denied', 'illegal-transition', $6, $7::jsonb, $8::jsonb, $9, $10)`,
      [
        randomUUID(),
        actor.sandbox_id,
        manager.storeId,
        actor.persona_id,
        randomUUID(),
        randomUUID(),
        JSON.stringify({
          cookie: "session=must-not-leak",
          requestBody: "full request body",
          secret: "must-not-leak",
          status: "processing",
        }),
        JSON.stringify({
          imageContent: "base64-must-not-leak",
          sql: "select secret from users",
          status: "verification",
          token: "must-not-leak",
        }),
        "2026-08-10T11:00:00.000Z",
        "2026-08-10T11:00:01.000Z",
      ],
    );

    const response = await app.request(
      `/api/v1/manager/audits?from=2026-08-10&to=2026-08-10&result=denied&storeId=${manager.storeId}&sort=recordedAt:asc`,
      { headers: { Cookie: manager.cookie } },
    );
    const payload = (await response.json()) as AuditResponse;
    const event = payload.events.find(
      (candidate) => candidate.action === "test.safe-filter",
    );
    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      range: {
        fromBusinessDay: "2026-08-10",
        toBusinessDay: "2026-08-10",
      },
      store: { storeId: manager.storeId },
    });
    expect(payload.events.length).toBe(payload.totalCount);
    expect(
      payload.events.every((item) => item.store.storeId === manager.storeId),
    ).toBe(true);
    expect(event).toMatchObject({
      action: "test.safe-filter",
      after: { status: "verification" },
      before: { status: "processing" },
      reason: "illegal-transition",
      result: "denied",
    });

    const foreignStore = await sql.query<{ id: string }>(
      `select id from stores where sandbox_id = $1 and id <> $2 order by code limit 1`,
      [actor.sandbox_id, manager.storeId],
    );
    const denied = await app.request(
      `/api/v1/manager/audits?storeId=${foreignStore.rows[0]!.id}`,
      { headers: { Cookie: manager.cookie } },
    );
    const missing = await app.request(
      `/api/v1/manager/audits?storeId=${randomUUID()}`,
      { headers: { Cookie: manager.cookie } },
    );
    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    await expect(denied.json()).resolves.toMatchObject({
      error: { code: "MANAGER_AUDIT_NOT_FOUND" },
    } satisfies Partial<ApiErrorResponse>);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "MANAGER_AUDIT_NOT_FOUND" },
    } satisfies Partial<ApiErrorResponse>);

    const countBefore = await sql.query<{ count: number }>(
      `select count(*)::integer as count from audit_events where sandbox_id = $1`,
      [actor.sandbox_id],
    );
    const quietRead = await app.request("/api/v1/manager/audits", {
      headers: { Cookie: manager.cookie },
    });
    expect(quietRead.status).toBe(200);
    const countAfter = await sql.query<{ count: number }>(
      `select count(*)::integer as count from audit_events where sandbox_id = $1`,
      [actor.sandbox_id],
    );
    expect(countAfter.rows[0]!.count).toBe(countBefore.rows[0]!.count);
  });

  it("previews and retries the exact audit filter as a UTF-8 BOM CSV", async () => {
    const manager = await managerFixture();
    const deniedRead = await app.request(
      `/api/v1/manager/audits?storeId=${randomUUID()}`,
      { headers: { Cookie: manager.cookie } },
    );
    expect(deniedRead.status).toBe(404);
    const request = {
      dataType: "audits",
      filters: { result: "denied" },
      fromBusinessDay: "2026-07-28",
      sort: { direction: "asc", field: "businessOccurredAt" },
      storeId: manager.storeId,
      toBusinessDay: "2026-08-10",
    };
    const previewResponse = await app.request(
      "/api/v1/manager/exports/preview",
      {
        body: JSON.stringify(request),
        headers: commandHeaders(manager),
        method: "POST",
      },
    );
    const preview = (await previewResponse.json()) as ExportPreviewResponse;
    expect(previewResponse.status).toBe(200);
    expect(preview).toMatchObject({
      dataType: "audits",
      range: {
        fromBusinessDay: "2026-07-28",
        toBusinessDay: "2026-08-10",
      },
      status: "ready",
      store: { storeId: manager.storeId },
    });
    expect(preview.columns.slice(0, 4)).toEqual([
      "经营日",
      "业务发生时间",
      "服务器记录时间",
      "演示人物",
    ]);
    expect(preview.estimatedRowCount).toBeGreaterThan(0);
    expect(preview.rows).toHaveLength(preview.estimatedRowCount);

    const download = () =>
      app.request("/api/v1/manager/exports", {
        body: JSON.stringify(request),
        headers: commandHeaders(manager),
        method: "POST",
      });
    const first = await download();
    const firstBytes = new Uint8Array(await first.arrayBuffer());
    const firstCsv = new TextDecoder().decode(firstBytes);
    expect(first.status).toBe(200);
    expect([...firstBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(first.headers.get("Content-Type")).toContain("text/csv");
    expect(first.headers.get("Content-Disposition")).toContain(".csv");
    expect(Number(first.headers.get("X-Export-Row-Count"))).toBe(
      preview.estimatedRowCount,
    );
    expect(csvLines(firstCsv)).toHaveLength(preview.estimatedRowCount + 1);
    expect(csvLines(firstCsv)[0]).toBe(
      "经营日,业务发生时间,服务器记录时间,演示人物,角色,门店,动作,对象类型,对象ID,结果,原因,请求关联ID,变更前,变更后",
    );
    expect(firstCsv).not.toMatch(
      /session=|full request body|base64-|select secret|must-not-leak/iu,
    );

    const retried = await download();
    expect(retried.status).toBe(200);
    expect(Number(retried.headers.get("X-Export-Row-Count"))).toBe(
      preview.estimatedRowCount,
    );
  });

  it("exports six separately defined store datasets with full timestamps and decimal money", async () => {
    const manager = await managerFixture();
    const expectedHeaders = {
      reservations:
        "经营日,预约ID,顾客,座位,状态,开始时间,结束时间,模拟金额（元）",
      orders: "经营日,订单ID,顾客,状态,关联预约ID,创建时间,模拟金额（元）",
      inventoryMovements:
        "经营日,流水ID,库存项目,流水类型,数量变化,变动后账面库存,业务发生时间,服务器记录时间,关联对象",
      repairs: "经营日,报修ID,座位,机型档案,状态,优先级,创建时间,关闭时间",
      shifts: "经营日,班次ID,员工编号,员工,角色,开始时间,结束时间,状态",
      audits:
        "经营日,业务发生时间,服务器记录时间,演示人物,角色,门店,动作,对象类型,对象ID,结果,原因,请求关联ID,变更前,变更后",
    } as const;

    for (const [dataType, expectedHeader] of Object.entries(expectedHeaders)) {
      const request = {
        dataType,
        filters: {},
        fromBusinessDay: "2026-07-28",
        sort: { direction: "asc", field: "businessOccurredAt" },
        storeId: manager.storeId,
        toBusinessDay: "2026-08-10",
      };
      const previewResponse = await app.request(
        "/api/v1/manager/exports/preview",
        {
          body: JSON.stringify(request),
          headers: commandHeaders(manager),
          method: "POST",
        },
      );
      const preview = (await previewResponse.json()) as ExportPreviewResponse;
      const response = await app.request("/api/v1/manager/exports", {
        body: JSON.stringify(request),
        headers: commandHeaders(manager),
        method: "POST",
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      const csv = new TextDecoder().decode(bytes);
      expect(response.status, dataType).toBe(200);
      expect([...bytes.slice(0, 3)], dataType).toEqual([0xef, 0xbb, 0xbf]);
      expect(csvLines(csv)[0], dataType).toBe(expectedHeader);
      expect(csvLines(csv).length, dataType).toBeGreaterThan(1);
      expect(previewResponse.status, dataType).toBe(200);
      expect(preview.columns.join(","), dataType).toBe(expectedHeader);
      expect(preview.rows, dataType).toHaveLength(preview.estimatedRowCount);
      expect(preview.estimatedRowCount, dataType).toBe(
        Number(response.headers.get("X-Export-Row-Count")),
      );
      expect(csv, dataType).toMatch(
        /2026-\d{2}-\d{2} \d{2}:\d{2}:\d{2} \+08:00/u,
      );
      if (dataType === "orders" || dataType === "reservations") {
        expect(csv, dataType).toMatch(/,\d+\.\d{2}(?:\r\n|,)/u);
      }
    }
  });

  it("rejects sort fields that do not belong to the selected dataset", async () => {
    const manager = await managerFixture();
    for (const [dataType, field] of [
      ["repairs", "amountCents"],
      ["audits", "status"],
    ] as const) {
      const response = await app.request("/api/v1/manager/exports/preview", {
        body: JSON.stringify({
          dataType,
          filters: {},
          fromBusinessDay: "2026-08-10",
          sort: { direction: "asc", field },
          storeId: manager.storeId,
          toBusinessDay: "2026-08-10",
        }),
        headers: commandHeaders(manager),
        method: "POST",
      });
      expect(response.status, `${dataType}:${field}`).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "MANAGER_EXPORT_FILTER_INVALID" },
      } satisfies Partial<ApiErrorResponse>);
    }
  });

  it("rejects non-manager export attempts without leaking store data", async () => {
    const staff = await createRoleSession("staff");
    const response = await app.request("/api/v1/manager/exports", {
      body: JSON.stringify({
        dataType: "audits",
        filters: {},
        fromBusinessDay: "2026-08-10",
        sort: { direction: "desc", field: "businessOccurredAt" },
        storeId: randomUUID(),
        toBusinessDay: "2026-08-10",
      }),
      headers: {
        "Content-Type": "application/json",
        Cookie: staff.cookie,
        Origin: publicOrigin,
        "X-CSRF-Token": staff.context.csrfToken,
      },
      method: "POST",
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "MANAGER_EXPORT_MANAGER_REQUIRED" },
    } satisfies Partial<ApiErrorResponse>);
  });
});
