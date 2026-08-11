import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import {
  MANAGER_AUDIT_RESULTS,
  MANAGER_EXPORT_DATA_TYPES,
  MANAGER_EXPORT_SORT_FIELDS,
  PUBLIC_ROLES,
  type ManagerAuditFilters,
  type ManagerAuditResponse,
  type ManagerAuditResult,
  type ManagerExportDataType,
  type ManagerExportPreviewResponse,
  type ManagerExportRequest,
  type ManagerExportSortDirection,
  type ManagerExportSortField,
  type PublicRole,
} from "@jingshu/contracts";
import type {
  DatabaseManagerAudits,
  DatabaseManagerExport,
} from "@jingshu/database";

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
  type AppServices,
} from "./route-support.js";

const businessDayPattern = /^\d{4}-\d{2}-\d{2}$/u;
const auditResults = new Set<ManagerAuditResult>(MANAGER_AUDIT_RESULTS);
const dataTypes = new Set<ManagerExportDataType>(MANAGER_EXPORT_DATA_TYPES);
const publicRoles = new Set<PublicRole>(PUBLIC_ROLES);
const sortFields = new Set<ManagerExportSortField>(MANAGER_EXPORT_SORT_FIELDS);
const filterKeys = new Set([
  "action",
  "objectType",
  "personaId",
  "result",
  "role",
  "search",
  "status",
]);

function requestHeaders(context: Context) {
  const requestId = randomUUID();
  context.header("X-Request-Id", requestId);
  context.header("Cache-Control", "no-store");
  return requestId;
}

async function managerSession(
  context: Context,
  services: AppServices,
  requestId: string,
  feature: "audit" | "export",
) {
  const token = getCookie(context, SESSION_COOKIE);
  const session =
    token && services.sessionSecret
      ? readRoleSession(token, services.sessionSecret)
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
  if (session.role !== "manager") {
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
            ? "MANAGER_AUDIT_MANAGER_REQUIRED"
            : "MANAGER_EXPORT_MANAGER_REQUIRED",
          feature === "audit"
            ? "请切换到店长角色查看所属门店审计。"
            : "请切换到店长角色导出所属门店数据。",
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
        "MANAGER_EXPORT_ORIGIN_INVALID",
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
        "MANAGER_EXPORT_CSRF_INVALID",
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

function parseFilters(value: unknown): ManagerExportRequest["filters"] | null {
  if (!isPlainRecord(value)) return null;
  if (Object.keys(value).some((key) => !filterKeys.has(key))) return null;
  if (
    !validOptionalText(value.action) ||
    !validOptionalText(value.objectType) ||
    !validOptionalText(value.search) ||
    !validOptionalText(value.status) ||
    (value.personaId !== undefined &&
      (typeof value.personaId !== "string" ||
        !UUID_V4_PATTERN.test(value.personaId))) ||
    (value.result !== undefined &&
      !auditResults.has(value.result as ManagerAuditResult)) ||
    (value.role !== undefined && !publicRoles.has(value.role as PublicRole))
  ) {
    return null;
  }
  return value as ManagerExportRequest["filters"];
}

function parseExportBody(value: unknown): ManagerExportRequest | null {
  if (!isPlainRecord(value)) return null;
  const keys = Object.keys(value).sort();
  if (
    keys.join(",") !==
      "dataType,filters,fromBusinessDay,sort,storeId,toBusinessDay" ||
    !dataTypes.has(value.dataType as ManagerExportDataType) ||
    typeof value.storeId !== "string" ||
    !UUID_V4_PATTERN.test(value.storeId) ||
    typeof value.fromBusinessDay !== "string" ||
    !businessDayPattern.test(value.fromBusinessDay) ||
    typeof value.toBusinessDay !== "string" ||
    !businessDayPattern.test(value.toBusinessDay) ||
    !isPlainRecord(value.sort) ||
    Object.keys(value.sort).sort().join(",") !== "direction,field" ||
    (value.sort.direction !== "asc" && value.sort.direction !== "desc") ||
    !sortFields.has(value.sort.field as ManagerExportSortField)
  ) {
    return null;
  }
  const filters = parseFilters(value.filters);
  return filters
    ? ({ ...value, filters } as unknown as ManagerExportRequest)
    : null;
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
    !sortFields.has(sortField as ManagerExportSortField) ||
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
  const filters: ManagerAuditFilters = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.objectType ? { objectType: query.objectType } : {}),
    ...(query.personaId ? { personaId: query.personaId } : {}),
    ...(query.result ? { result: query.result as ManagerAuditResult } : {}),
    ...(query.role ? { role: query.role as PublicRole } : {}),
  };
  return {
    filters,
    ...(query.from ? { fromBusinessDay: query.from } : {}),
    sort: {
      direction: sortDirection as ManagerExportSortDirection,
      field: sortField as ManagerExportSortField,
    },
    storeId: query.storeId,
    ...(query.to ? { toBusinessDay: query.to } : {}),
  };
}

async function denyForeignStore(
  services: AppServices,
  session: NonNullable<ReturnType<typeof readRoleSession>>,
  requestId: string,
  action: "audit.read" | "export.csv",
) {
  await services.sandboxDatabase?.recordRoleContextDenial({
    action,
    contextVersion: session.contextVersion,
    objectId: null,
    objectType: action === "audit.read" ? "audit" : "export",
    personaId: session.personaId,
    reason: "cross-store-or-not-found",
    requestId,
    role: session.role,
    sandboxId: session.sandboxId,
    storeId: session.storeIds[0] ?? null,
  });
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
    error.code === "MANAGER_AUDIT_EXPORT_INVALID" &&
    "reason" in error
  ) {
    if (error.reason === "store-not-found") {
      return {
        body: errorBody(
          feature === "audit"
            ? "MANAGER_AUDIT_NOT_FOUND"
            : "MANAGER_EXPORT_NOT_FOUND",
          "没有找到当前门店范围内可访问的数据。",
          requestId,
        ),
        status: 404 as const,
      };
    }
    return {
      body: errorBody(
        feature === "audit"
          ? "MANAGER_AUDIT_FILTER_INVALID"
          : "MANAGER_EXPORT_FILTER_INVALID",
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
      body: errorBody(
        "ROLE_CONTEXT_UNAVAILABLE",
        "当前沙箱已失效，请重新开始演示。",
        requestId,
      ),
      status: 410 as const,
    };
  }
  return {
    body: errorBody(
      feature === "audit"
        ? "MANAGER_AUDIT_SERVICE_UNAVAILABLE"
        : "MANAGER_EXPORT_SERVICE_UNAVAILABLE",
      feature === "audit"
        ? "审计数据暂时无法读取；页面不会展示伪造数据。"
        : "导出暂时失败；筛选保持不变，请使用相同范围重试。",
      requestId,
    ),
    status: 503 as const,
  };
}

function auditResponse(result: DatabaseManagerAudits): ManagerAuditResponse {
  return {
    ...result,
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
    range: {
      ...result.range,
      endsAt: result.range.endsAt.toISOString(),
      startsAt: result.range.startsAt.toISOString(),
    },
    status: "ready",
    store: { ...result.store, fixed: true },
  };
}

function previewResponse(
  result: DatabaseManagerExport,
): ManagerExportPreviewResponse {
  return {
    dataType: result.dataType,
    estimatedRowCount: result.rows.length,
    range: {
      ...result.range,
      endsAt: result.range.endsAt.toISOString(),
      startsAt: result.range.startsAt.toISOString(),
    },
    status: "ready",
    store: result.store,
  };
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

function csvResponse(result: DatabaseManagerExport) {
  const header = result.columns
    .map((column) => csvCell(column.header))
    .join(",");
  const rows = result.rows.map((row) =>
    row
      .map((cell, index) => {
        if (cell === null) return "";
        const kind = result.columns[index]?.kind ?? "text";
        const value =
          kind === "datetime" && cell instanceof Date
            ? formatDateTime(cell)
            : kind === "money" && typeof cell === "number"
              ? (cell / 100).toFixed(2)
              : String(cell);
        return csvCell(safeSpreadsheetText(value));
      })
      .join(","),
  );
  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
}

export function registerManagerAuditExportRoutes(
  app: Hono,
  services: AppServices,
) {
  app.get("/api/v1/manager/audits", async (context) => {
    const requestId = requestHeaders(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const mapped = failure(null, requestId, "audit");
      return context.json(mapped.body, mapped.status);
    }
    const auth = await managerSession(context, services, requestId, "audit");
    if (!auth.session) return auth.response;
    const query = parseAuditQuery(context);
    if (!query) {
      return context.json(
        errorBody(
          "MANAGER_AUDIT_FILTER_INVALID",
          "请使用有效经营日、人物、角色、动作、对象类型和结果筛选。",
          requestId,
        ),
        422,
      );
    }
    const storeId = query.storeId ?? auth.session.storeIds[0];
    if (!storeId || storeId !== auth.session.storeIds[0]) {
      await denyForeignStore(services, auth.session, requestId, "audit.read");
      return context.json(
        errorBody(
          "MANAGER_AUDIT_NOT_FOUND",
          "没有找到当前门店范围内可访问的数据。",
          requestId,
        ),
        404,
      );
    }
    try {
      const result = await services.sandboxDatabase.readManagerAudits({
        contextVersion: auth.session.contextVersion,
        filters: query.filters,
        ...(query.fromBusinessDay
          ? { fromBusinessDay: query.fromBusinessDay }
          : {}),
        personaId: auth.session.personaId,
        role: "manager",
        sandboxId: auth.session.sandboxId,
        sort: query.sort,
        storeId,
        ...(query.toBusinessDay ? { toBusinessDay: query.toBusinessDay } : {}),
      });
      return context.json(auditResponse(result));
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
          "MANAGER_EXPORT_BODY_TOO_LARGE",
          "导出筛选超过允许大小，没有生成文件。",
          requestHeaders(context),
        ),
        413,
      ),
  });

  async function handleExportPost(
    context: Context,
    preview: boolean,
  ): Promise<Response> {
    const requestId = requestHeaders(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const mapped = failure(null, requestId, "export");
      return context.json(mapped.body, mapped.status);
    }
    const auth = await managerSession(context, services, requestId, "export");
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
          "MANAGER_EXPORT_FILTER_INVALID",
          "请提交有效数据类型、经营日范围、筛选与排序。",
          requestId,
        ),
        422,
      );
    }
    if (body.storeId !== auth.session.storeIds[0]) {
      await denyForeignStore(services, auth.session, requestId, "export.csv");
      return context.json(
        errorBody(
          "MANAGER_EXPORT_NOT_FOUND",
          "没有找到当前门店范围内可导出的数据。",
          requestId,
        ),
        404,
      );
    }
    const input = {
      ...body,
      contextVersion: auth.session.contextVersion,
      personaId: auth.session.personaId,
      role: "manager" as const,
      sandboxId: auth.session.sandboxId,
    };
    try {
      const result = preview
        ? await services.sandboxDatabase.prepareManagerExport(input)
        : await services.sandboxDatabase.createManagerExport({
            ...input,
            requestId,
          });
      if (preview) return context.json(previewResponse(result));
      const filename = `jingshu-${result.dataType}-${result.range.fromBusinessDay}-${result.range.toBusinessDay}.csv`;
      context.header("Content-Type", "text/csv; charset=utf-8");
      context.header(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      context.header("X-Export-Row-Count", String(result.rows.length));
      return context.body(csvResponse(result));
    } catch (error) {
      const mapped = failure(error, requestId, "export");
      return context.json(mapped.body, mapped.status);
    }
  }

  app.post("/api/v1/manager/exports/preview", postLimit, (context) =>
    handleExportPost(context, true),
  );
  app.post("/api/v1/manager/exports", postLimit, (context) =>
    handleExportPost(context, false),
  );
}
