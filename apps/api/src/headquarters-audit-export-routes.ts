import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import {
  HEADQUARTERS_FIXED_STORE_CODES,
  MANAGER_AUDIT_RESULTS,
  MANAGER_EXPORT_DATA_TYPES,
  MANAGER_EXPORT_SORT_FIELDS_BY_TYPE,
  MANAGER_EXPORT_STATUS_VALUES,
  PUBLIC_ROLES,
  type HeadquartersAuditResponse,
  type HeadquartersExportPreviewResponse,
  type HeadquartersExportRequest,
  type HeadquartersFixedStoreCode,
  type HeadquartersScopedStoreResponse,
  type ManagerAuditFilters,
  type ManagerAuditResult,
  type ManagerAuditSortField,
  type ManagerBusinessExportDataType,
  type ManagerExportDataType,
  type ManagerExportSortDirection,
  type PublicRole,
} from "@jingshu/contracts";
import type {
  DatabaseHeadquartersAudits,
  DatabaseManagerAudits,
  DatabaseManagerExport,
} from "@jingshu/database";
import { businessDayKey } from "@jingshu/domain";

import { authorizeRoleCapability } from "./role-authorization.js";
import { readRoleSession } from "./role-session.js";
import {
  SESSION_COOKIE,
  UUID_V4_PATTERN,
  csrfTokensMatch,
  errorBody,
  isPlainRecord,
  isRoleContextStale,
  isRoleContextUnavailable,
  recordRoleContextDenial,
  roleContextUnavailableBody,
  type AppEnvironment,
  type AppServices,
} from "./route-support.js";

const businessDayPattern = /^\d{4}-\d{2}-\d{2}$/u;
const auditResults = new Set<ManagerAuditResult>(MANAGER_AUDIT_RESULTS);
const dataTypes = new Set<ManagerExportDataType>(MANAGER_EXPORT_DATA_TYPES);
const publicRoles = new Set<PublicRole>(PUBLIC_ROLES);
const auditSortFields = new Set<ManagerAuditSortField>(
  MANAGER_EXPORT_SORT_FIELDS_BY_TYPE.audits,
);
const auditFilterKeys = new Set([
  "action",
  "objectType",
  "personaId",
  "result",
  "role",
]);
const businessFilterKeys = new Set(["search", "status"]);

function requestHeaders(context: Context) {
  const requestId = randomUUID();
  context.header("X-Request-Id", requestId);
  context.header("Cache-Control", "no-store");
  return requestId;
}

async function headquartersSession(
  context: Context,
  services: AppServices,
  requestId: string,
  feature: "audit" | "export",
) {
  const token = getCookie(context, SESSION_COOKIE);
  const session =
    token && services.sessionSecret
      ? readRoleSession(
          token,
          services.sessionSecret,
          services.wallClock.now().getTime(),
        )
      : null;
  if (!session) {
    return {
      response: context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      ),
      session: null,
    };
  }
  if (
    session.role !== "hq" ||
    !authorizeRoleCapability(session, {
      capability: feature === "audit" ? "audit:view" : "chain:compare",
      sandboxId: session.sandboxId,
      ...(feature === "audit" && session.storeIds[0]
        ? { storeId: session.storeIds[0] }
        : {}),
    })
  ) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "capability_denied",
    );
    return {
      response: context.json(
        errorBody(
          feature === "audit"
            ? "HEADQUARTERS_AUDIT_HQ_REQUIRED"
            : "HEADQUARTERS_EXPORT_HQ_REQUIRED",
          feature === "audit"
            ? "请切换到总部运营角色查看全部三店审计。"
            : "请切换到总部运营角色导出全部三店数据。",
          requestId,
        ),
        403,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

async function authorizePost(
  context: Context,
  services: AppServices,
  requestId: string,
  session: NonNullable<ReturnType<typeof readRoleSession>>,
) {
  if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "invalid_origin",
    );
    return context.json(
      errorBody(
        "HEADQUARTERS_EXPORT_ORIGIN_INVALID",
        "请求来源无法验证，没有生成导出文件。",
        requestId,
      ),
      403,
    );
  }
  if (!csrfTokensMatch(session.csrfToken, context.req.header("X-CSRF-Token"))) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "csrf_context_mismatch",
    );
    return context.json(
      errorBody(
        "HEADQUARTERS_EXPORT_CSRF_INVALID",
        "页面上下文已变化，没有生成导出文件。",
        requestId,
      ),
      403,
    );
  }
  return null;
}

function validOptionalText(value: unknown) {
  return (
    value === undefined ||
    (typeof value === "string" && value.length > 0 && value.length <= 200)
  );
}

function parseAuditFilters(value: unknown): ManagerAuditFilters | null {
  if (!isPlainRecord(value)) return null;
  if (Object.keys(value).some((key) => !auditFilterKeys.has(key))) return null;
  if (
    !validOptionalText(value.action) ||
    !validOptionalText(value.objectType) ||
    (value.personaId !== undefined &&
      (typeof value.personaId !== "string" ||
        !UUID_V4_PATTERN.test(value.personaId))) ||
    (value.result !== undefined &&
      !auditResults.has(value.result as ManagerAuditResult)) ||
    (value.role !== undefined && !publicRoles.has(value.role as PublicRole))
  ) {
    return null;
  }
  return value as ManagerAuditFilters;
}

function parseBusinessFilters(
  value: unknown,
  dataType: ManagerBusinessExportDataType,
) {
  if (!isPlainRecord(value)) return null;
  if (Object.keys(value).some((key) => !businessFilterKeys.has(key))) {
    return null;
  }
  if (!validOptionalText(value.search) || !validOptionalText(value.status)) {
    return null;
  }
  if (
    value.status !== undefined &&
    !(MANAGER_EXPORT_STATUS_VALUES[dataType] as ReadonlyArray<string>).includes(
      value.status as string,
    )
  ) {
    return null;
  }
  return value as { readonly search?: string; readonly status?: string };
}

function parseAuditQuery(context: Context) {
  const query = context.req.query();
  const allowed = new Set([
    "action",
    "from",
    "objectType",
    "personaId",
    "result",
    "role",
    "sort",
    "storeId",
    "to",
  ]);
  if (Object.keys(query).some((key) => !allowed.has(key))) return null;
  const [sortField = "businessOccurredAt", sortDirection = "desc", extra] = (
    query.sort ?? "businessOccurredAt:desc"
  ).split(":");
  if (
    extra !== undefined ||
    !auditSortFields.has(sortField as ManagerAuditSortField) ||
    (sortDirection !== "asc" && sortDirection !== "desc") ||
    (query.from !== undefined && !businessDayPattern.test(query.from)) ||
    (query.to !== undefined && !businessDayPattern.test(query.to)) ||
    Boolean(query.from) !== Boolean(query.to) ||
    (query.personaId !== undefined && !UUID_V4_PATTERN.test(query.personaId)) ||
    (query.storeId !== undefined && !UUID_V4_PATTERN.test(query.storeId)) ||
    (query.result !== undefined &&
      !auditResults.has(query.result as ManagerAuditResult)) ||
    (query.role !== undefined && !publicRoles.has(query.role as PublicRole)) ||
    !validOptionalText(query.action) ||
    !validOptionalText(query.objectType)
  ) {
    return null;
  }
  return {
    filters: {
      ...(query.action ? { action: query.action } : {}),
      ...(query.objectType ? { objectType: query.objectType } : {}),
      ...(query.personaId ? { personaId: query.personaId } : {}),
      ...(query.result ? { result: query.result as ManagerAuditResult } : {}),
      ...(query.role ? { role: query.role as PublicRole } : {}),
    } satisfies ManagerAuditFilters,
    ...(query.from ? { fromBusinessDay: query.from } : {}),
    sort: {
      direction: sortDirection as ManagerExportSortDirection,
      field: sortField as ManagerAuditSortField,
    },
    storeId: query.storeId,
    ...(query.to ? { toBusinessDay: query.to } : {}),
  };
}

function parseExportBody(value: unknown): HeadquartersExportRequest | null {
  if (!isPlainRecord(value)) return null;
  if (
    Object.keys(value).sort().join(",") !==
      "dataType,filters,fromBusinessDay,sort,storeIds,toBusinessDay" ||
    !Array.isArray(value.storeIds) ||
    value.storeIds.length < 1 ||
    value.storeIds.length > 3 ||
    value.storeIds.some(
      (storeId) =>
        typeof storeId !== "string" || !UUID_V4_PATTERN.test(storeId),
    ) ||
    new Set(value.storeIds).size !== value.storeIds.length ||
    typeof value.fromBusinessDay !== "string" ||
    !businessDayPattern.test(value.fromBusinessDay) ||
    typeof value.toBusinessDay !== "string" ||
    !businessDayPattern.test(value.toBusinessDay) ||
    !isPlainRecord(value.sort) ||
    Object.keys(value.sort).sort().join(",") !== "direction,field" ||
    (value.sort.direction !== "asc" && value.sort.direction !== "desc") ||
    !dataTypes.has(value.dataType as ManagerExportDataType)
  ) {
    return null;
  }
  const dataType = value.dataType as ManagerExportDataType;
  if (
    !(
      MANAGER_EXPORT_SORT_FIELDS_BY_TYPE[dataType] as ReadonlyArray<string>
    ).includes(value.sort.field as string)
  ) {
    return null;
  }
  const filters =
    dataType === "audits"
      ? parseAuditFilters(value.filters)
      : parseBusinessFilters(value.filters, dataType);
  return filters
    ? ({ ...value, dataType, filters } as unknown as HeadquartersExportRequest)
    : null;
}

function failure(
  error: unknown,
  requestId: string,
  feature: "audit" | "export",
) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MANAGER_AUDIT_EXPORT_INVALID"
  ) {
    return {
      body: errorBody(
        feature === "audit"
          ? "HEADQUARTERS_AUDIT_FILTER_INVALID"
          : "HEADQUARTERS_EXPORT_FILTER_INVALID",
        "请选择最近 14 个已生成经营日内的完整筛选范围。",
        requestId,
      ),
      status: 422 as const,
    };
  }
  if (isRoleContextStale(error)) {
    return {
      body: errorBody(
        "ROLE_CONTEXT_STALE",
        "角色上下文已变化，请刷新后重试。",
        requestId,
      ),
      status: 409 as const,
    };
  }
  if (isRoleContextUnavailable(error)) {
    return {
      body: roleContextUnavailableBody(
        error,
        "当前沙箱已失效，请重新开始演示。",
        requestId,
      ),
      status: 410 as const,
    };
  }
  return {
    body: errorBody(
      feature === "audit"
        ? "HEADQUARTERS_AUDIT_SERVICE_UNAVAILABLE"
        : "HEADQUARTERS_EXPORT_SERVICE_UNAVAILABLE",
      feature === "audit"
        ? "三店审计暂时无法读取；页面不会展示伪造数据。"
        : "导出暂时失败；筛选保持不变，请使用相同范围重试。",
      requestId,
    ),
    status: 503 as const,
  };
}

function compareValues(
  left: Date | number | string,
  right: Date | number | string,
) {
  const leftValue = left instanceof Date ? left.getTime() : left;
  const rightValue = right instanceof Date ? right.getTime() : right;
  return typeof leftValue === "number" && typeof rightValue === "number"
    ? leftValue - rightValue
    : String(leftValue).localeCompare(String(rightValue), "zh-CN");
}

function headquartersAuditExport(result: DatabaseHeadquartersAudits) {
  const columns = [
    "门店代码",
    "门店",
    "经营日",
    "业务发生时间",
    "服务器记录时间",
    "演示人物",
    "角色",
    "动作",
    "对象类型",
    "对象ID",
    "结果",
    "原因",
    "请求关联ID",
    "变更前",
    "变更后",
  ] as const;
  const rows = result.events.map((event) =>
    [
      event.store?.code ?? "chain",
      event.store?.displayName ?? "连锁范围",
      businessDayKey(event.businessOccurredAt),
      formatDateTime(event.businessOccurredAt),
      formatDateTime(event.recordedAt),
      event.actor.displayName,
      event.role,
      event.action,
      event.objectType,
      event.objectId ?? "",
      event.result,
      event.reason ?? "",
      event.requestId,
      event.before ? JSON.stringify(event.before) : "",
      event.after ? JSON.stringify(event.after) : "",
    ].map(safeSpreadsheetText),
  );
  return {
    columns,
    rows,
    stores: result.stores
      .filter((store) => result.selectedStoreIds.includes(store.storeId))
      .map((store) => ({
        code: store.code as HeadquartersFixedStoreCode,
        displayName: store.displayName,
        storeId: store.storeId,
      })),
  };
}

function orderedStores(
  results: ReadonlyArray<{ readonly store: DatabaseManagerAudits["store"] }>,
) {
  return HEADQUARTERS_FIXED_STORE_CODES.flatMap((code) => {
    const match = results.find((result) => result.store.code === code);
    return match
      ? [
          {
            code: match.store.code as HeadquartersFixedStoreCode,
            displayName: match.store.displayName,
            storeId: match.store.storeId,
          } satisfies HeadquartersScopedStoreResponse,
        ]
      : [];
  });
}

const shanghaiFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  hour: "2-digit",
  hour12: false,
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Shanghai",
  year: "numeric",
});

function formatDateTime(value: Date) {
  const parts = Object.fromEntries(
    shanghaiFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second} +08:00`;
}

function safeSpreadsheetText(value: string) {
  const normalized = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || code >= 32;
    })
    .join("");
  return /^[=+\-@]/u.test(normalized) ? `'${normalized}` : normalized;
}

function csvCell(value: string) {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function exportSortIndex(dataType: ManagerExportDataType, field: string) {
  const indexes: Record<ManagerExportDataType, Record<string, number>> = {
    audits: {
      action: 6,
      businessOccurredAt: 1,
      objectType: 7,
      persona: 3,
      recordedAt: 2,
      result: 9,
      role: 4,
    },
    inventoryMovements: { businessOccurredAt: 6, status: 3 },
    orders: { amountCents: 6, businessOccurredAt: 5, status: 3 },
    repairs: { businessOccurredAt: 6, status: 4 },
    reservations: { amountCents: 7, businessOccurredAt: 5, status: 4 },
    shifts: { businessOccurredAt: 5, status: 7 },
  };
  return indexes[dataType][field] ?? 0;
}

function combinedExport(
  results: ReadonlyArray<DatabaseManagerExport>,
  request: HeadquartersExportRequest,
) {
  const columnIndex = exportSortIndex(request.dataType, request.sort.field);
  const direction = request.sort.direction === "asc" ? 1 : -1;
  const exportedColumnIndexes = results[0]!.columns.flatMap((column, index) =>
    request.dataType === "audits" && column.header === "门店" ? [] : [index],
  );
  const entries = results
    .flatMap((result) => result.rows.map((row) => ({ result, row })))
    .sort((left, right) => {
      const leftValue = left.row[columnIndex];
      const rightValue = right.row[columnIndex];
      if (leftValue === undefined && rightValue === undefined) return 0;
      if (leftValue === undefined) return -direction;
      if (rightValue === undefined) return direction;
      if (leftValue === null && rightValue === null) return 0;
      if (leftValue === null) return -direction;
      if (rightValue === null) return direction;
      return compareValues(leftValue, rightValue) * direction;
    });
  const rows = entries.map(({ result, row }) => [
    safeSpreadsheetText(result.store.code),
    safeSpreadsheetText(result.store.displayName),
    ...exportedColumnIndexes.map((index) => {
      const cell = row[index];
      if (cell === null) return "";
      const kind = result.columns[index]?.kind ?? "text";
      const value =
        kind === "datetime" && cell instanceof Date
          ? formatDateTime(cell)
          : kind === "money" && typeof cell === "number"
            ? (cell / 100).toFixed(2)
            : String(cell);
      return safeSpreadsheetText(value);
    }),
  ]);
  return {
    columns: [
      "门店代码",
      "门店",
      ...exportedColumnIndexes.map(
        (index) => results[0]!.columns[index]!.header,
      ),
    ],
    rows,
    stores: orderedStores(results),
  };
}

function csvResponse(
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
) {
  return `\uFEFF${[
    columns.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ].join("\r\n")}\r\n`;
}

export function registerHeadquartersAuditExportRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  app.get("/api/v1/hq/audits", async (context) => {
    const requestId = requestHeaders(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const mapped = failure(null, requestId, "audit");
      return context.json(mapped.body, mapped.status);
    }
    const auth = await headquartersSession(
      context,
      services,
      requestId,
      "audit",
    );
    if (!auth.session) return auth.response;
    const query = parseAuditQuery(context);
    if (!query) {
      return context.json(
        errorBody(
          "HEADQUARTERS_AUDIT_FILTER_INVALID",
          "请使用有效经营日、人物、角色、门店、动作、对象类型和结果筛选。",
          requestId,
        ),
        422,
      );
    }
    if (query.storeId && !auth.session.storeIds.includes(query.storeId)) {
      await recordRoleContextDenial(
        services,
        auth.session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "HEADQUARTERS_AUDIT_SCOPE_INVALID",
          "审计范围只能使用当前沙箱固定三店。",
          requestId,
        ),
        403,
      );
    }
    const targetStoreIds = query.storeId
      ? [query.storeId]
      : auth.session.storeIds;
    try {
      const result = await services.sandboxDatabase.readHeadquartersAudits({
        contextVersion: auth.session.contextVersion,
        filters: query.filters,
        ...(query.fromBusinessDay
          ? { fromBusinessDay: query.fromBusinessDay }
          : {}),
        personaId: auth.session.personaId,
        role: "hq",
        sandboxId: auth.session.sandboxId,
        selectedStoreIds: targetStoreIds,
        sort: query.sort,
        ...(query.toBusinessDay ? { toBusinessDay: query.toBusinessDay } : {}),
      });
      return context.json({
        availableBusinessDays: result.availableBusinessDays.map((day) => ({
          ...day,
          endsAt: day.endsAt.toISOString(),
          startsAt: day.startsAt.toISOString(),
        })),
        currentTime: result.currentTime.toISOString(),
        events: result.events.map((event) => ({
          ...event,
          businessOccurredAt: event.businessOccurredAt.toISOString(),
          recordedAt: event.recordedAt.toISOString(),
        })),
        filterOptions: result.filterOptions,
        range: {
          ...result.range,
          endsAt: result.range.endsAt.toISOString(),
          startsAt: result.range.startsAt.toISOString(),
        },
        selectedStoreIds: targetStoreIds,
        sort: query.sort,
        status: "ready",
        stores: result.stores.map((store) => ({
          ...store,
          code: store.code as HeadquartersFixedStoreCode,
        })),
        totalCount: result.totalCount,
      } satisfies HeadquartersAuditResponse);
    } catch (error) {
      const mapped = failure(error, requestId, "audit");
      return context.json(mapped.body, mapped.status);
    }
  });

  const postLimit = bodyLimit({
    maxSize: 8 * 1024,
    onError: (context) =>
      context.json(
        errorBody(
          "HEADQUARTERS_EXPORT_BODY_TOO_LARGE",
          "导出筛选超过允许大小，没有生成文件。",
          requestHeaders(context),
        ),
        413,
      ),
  });

  async function handleExportPost(context: Context, preview: boolean) {
    const requestId = requestHeaders(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const mapped = failure(null, requestId, "export");
      return context.json(mapped.body, mapped.status);
    }
    const auth = await headquartersSession(
      context,
      services,
      requestId,
      "export",
    );
    if (!auth.session) return auth.response;
    const denied = await authorizePost(
      context,
      services,
      requestId,
      auth.session,
    );
    if (denied) return denied;
    const body = parseExportBody(await context.req.json().catch(() => null));
    if (!body) {
      return context.json(
        errorBody(
          "HEADQUARTERS_EXPORT_FILTER_INVALID",
          "请提交有效数据类型、固定三店范围、经营日范围、筛选与排序。",
          requestId,
        ),
        422,
      );
    }
    if (
      body.storeIds.some((storeId) => !auth.session!.storeIds.includes(storeId))
    ) {
      await recordRoleContextDenial(
        services,
        auth.session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "HEADQUARTERS_EXPORT_SCOPE_INVALID",
          "导出范围只能使用当前沙箱固定三店。",
          requestId,
        ),
        403,
      );
    }
    const { storeIds, ...managerRequest } = body;
    const requests = storeIds.map((storeId) => {
      return {
        ...managerRequest,
        contextVersion: auth.session!.contextVersion,
        personaId: auth.session!.personaId,
        role: "hq" as const,
        sandboxId: auth.session!.sandboxId,
        storeId,
      };
    });
    try {
      const auditResult =
        body.dataType === "audits"
          ? await services.sandboxDatabase.readHeadquartersAudits({
              contextVersion: auth.session.contextVersion,
              filters: body.filters,
              fromBusinessDay: body.fromBusinessDay,
              personaId: auth.session.personaId,
              role: "hq",
              sandboxId: auth.session.sandboxId,
              selectedStoreIds: storeIds,
              sort: body.sort,
              toBusinessDay: body.toBusinessDay,
            })
          : null;
      const results = auditResult
        ? []
        : await Promise.all(
            requests.map((request) =>
              services.sandboxDatabase!.prepareManagerExport(request),
            ),
          );
      const combined = auditResult
        ? headquartersAuditExport(auditResult)
        : combinedExport(results, body);
      const range = auditResult?.range ?? results[0]!.range;
      if (preview) {
        return context.json({
          columns: combined.columns,
          dataType: body.dataType,
          estimatedRowCount: combined.rows.length,
          range: {
            ...range,
            endsAt: range.endsAt.toISOString(),
            startsAt: range.startsAt.toISOString(),
          },
          rows: combined.rows,
          status: "ready",
          stores: combined.stores,
        } satisfies HeadquartersExportPreviewResponse);
      }
      await services.sandboxDatabase.recordHeadquartersExport({
        contextVersion: auth.session.contextVersion,
        dataType: body.dataType,
        filters: body.filters,
        fromBusinessDay: body.fromBusinessDay,
        personaId: auth.session.personaId,
        requestId,
        role: "hq",
        sandboxId: auth.session.sandboxId,
        sort: body.sort,
        stores: storeIds.map((storeId) => ({
          rowCount: auditResult
            ? auditResult.events.filter(
                (event) => event.store?.storeId === storeId,
              ).length
            : (results.find((result) => result.store.storeId === storeId)?.rows
                .length ?? 0),
          storeId,
        })),
        toBusinessDay: body.toBusinessDay,
      });
      const filename = `jingshu-hq-${body.dataType}-${range.fromBusinessDay}-${range.toBusinessDay}.csv`;
      context.header("Content-Type", "text/csv; charset=utf-8");
      context.header(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      context.header("X-Export-Row-Count", String(combined.rows.length));
      return context.body(csvResponse(combined.columns, combined.rows));
    } catch (error) {
      const mapped = failure(error, requestId, "export");
      return context.json(mapped.body, mapped.status);
    }
  }

  app.post("/api/v1/hq/exports/preview", postLimit, (context) =>
    handleExportPost(context, true),
  );
  app.post("/api/v1/hq/exports", postLimit, (context) =>
    handleExportPost(context, false),
  );
}
