import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { ManagerDashboardResponse } from "@jingshu/contracts";
import type {
  DatabaseManagerDashboard,
  ManagerDashboardDrilldownKind,
} from "@jingshu/database";

import { readRoleSession } from "./role-session.js";
import {
  SESSION_COOKIE,
  errorBody,
  isRoleContextStale,
  isRoleContextUnavailable,
  recordRoleContextDenial,
  type AppServices,
} from "./route-support.js";

const businessDayPattern = /^\d{4}-\d{2}-\d{2}$/u;
const drilldownKinds = new Set<ManagerDashboardDrilldownKind>([
  "attendance",
  "evidence",
  "handover",
  "inventory",
  "orders",
  "repairs",
  "revenue",
  "seats",
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
          "MANAGER_DASHBOARD_MANAGER_REQUIRED",
          "请切换到店长角色后查看单店经营看板。",
          requestId,
        ),
        403,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

function dashboardResponse(
  result: DatabaseManagerDashboard,
): ManagerDashboardResponse {
  return {
    ...result,
    availableBusinessDays: result.availableBusinessDays.map((day) => ({
      ...day,
      endsAt: day.endsAt.toISOString(),
      startsAt: day.startsAt.toISOString(),
    })),
    currentTime: result.currentTime.toISOString(),
    drilldown: result.drilldown
      ? {
          ...result.drilldown,
          rows: result.drilldown.rows.map((row) => ({
            ...row,
            occurredAt: row.occurredAt.toISOString(),
          })),
        }
      : null,
    range: {
      ...result.range,
      endsAt: result.range.endsAt.toISOString(),
      startsAt: result.range.startsAt.toISOString(),
    },
    recentEvidence: result.recentEvidence.map((item) => ({
      ...item,
      occurredAt: item.occurredAt.toISOString(),
    })),
    status: "ready",
  };
}

function failure(error: unknown, requestId: string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MANAGER_DASHBOARD_RANGE_INVALID"
  ) {
    return {
      body: errorBody(
        "MANAGER_DASHBOARD_RANGE_INVALID",
        "请选择最近 14 个已生成经营日内的完整起止日期。",
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
      "MANAGER_DASHBOARD_SERVICE_UNAVAILABLE",
      "经营看板暂时无法读取；请稍后重试，页面不会展示伪造数据。",
      requestId,
    ),
    status: 503 as const,
  };
}

export function registerManagerDashboardRoutes(
  app: Hono,
  services: AppServices,
) {
  app.get("/api/v1/manager/dashboard", async (context) => {
    const requestId = requestHeaders(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = failure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await managerSession(context, services, requestId);
    if (!auth.session) return auth.response;

    const fromBusinessDay = context.req.query("from");
    const toBusinessDay = context.req.query("to");
    const drilldown = context.req.query("drilldown");
    const invalidRange =
      Boolean(fromBusinessDay) !== Boolean(toBusinessDay) ||
      (fromBusinessDay !== undefined &&
        !businessDayPattern.test(fromBusinessDay)) ||
      (toBusinessDay !== undefined && !businessDayPattern.test(toBusinessDay));
    const invalidDrilldown =
      drilldown !== undefined &&
      !drilldownKinds.has(drilldown as ManagerDashboardDrilldownKind);
    if (invalidRange || invalidDrilldown) {
      const mapped = failure(
        { code: "MANAGER_DASHBOARD_RANGE_INVALID" },
        requestId,
      );
      return context.json(mapped.body, mapped.status);
    }

    try {
      const result = await services.sandboxDatabase.readManagerDashboard({
        contextVersion: auth.session.contextVersion,
        ...(drilldown
          ? { drilldown: drilldown as ManagerDashboardDrilldownKind }
          : {}),
        ...(fromBusinessDay && toBusinessDay
          ? { fromBusinessDay, toBusinessDay }
          : {}),
        personaId: auth.session.personaId,
        role: "manager",
        sandboxId: auth.session.sandboxId,
      });
      return context.json(dashboardResponse(result));
    } catch (error) {
      const mapped = failure(error, requestId);
      return context.json(mapped.body, mapped.status);
    }
  });
}
