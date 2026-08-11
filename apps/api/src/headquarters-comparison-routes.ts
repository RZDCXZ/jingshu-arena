import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  HEADQUARTERS_FIXED_STORE_CODES,
  type HeadquartersComparisonResponse,
  type HeadquartersComparisonStoreResponse,
  type HeadquartersFixedStoreCode,
  type ManagerDashboardDrilldownKind,
} from "@jingshu/contracts";
import type { DatabaseManagerDashboard } from "@jingshu/database";

import { authorizeRoleCapability } from "./role-authorization.js";
import { readRoleSession } from "./role-session.js";
import {
  SESSION_COOKIE,
  UUID_V4_PATTERN,
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

function serializeStore(
  result: DatabaseManagerDashboard,
  storeId: string,
): HeadquartersComparisonStoreResponse {
  return {
    days: result.days,
    drilldown: result.drilldown
      ? {
          ...result.drilldown,
          rows: result.drilldown.rows.map((row) => ({
            ...row,
            occurredAt: row.occurredAt.toISOString(),
          })),
        }
      : null,
    recentEvidence: result.recentEvidence.map((item) => ({
      ...item,
      occurredAt: item.occurredAt.toISOString(),
    })),
    store: {
      code: result.store.code as HeadquartersFixedStoreCode,
      displayName: result.store.displayName,
      storeId,
    },
    summary: result.summary,
    trend: result.trend,
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
        "HEADQUARTERS_COMPARISON_RANGE_INVALID",
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
      "HEADQUARTERS_COMPARISON_SERVICE_UNAVAILABLE",
      "连锁比较暂时无法读取；页面不会展示伪造数据。",
      requestId,
    ),
    status: 503 as const,
  };
}

export function registerHeadquartersComparisonRoutes(
  app: Hono,
  services: AppServices,
) {
  app.get("/api/v1/hq/dashboard", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const mapped = failure(null, requestId);
      return context.json(mapped.body, mapped.status);
    }
    const token = getCookie(context, SESSION_COOKIE);
    const session = token
      ? readRoleSession(
          token,
          services.sessionSecret,
          services.wallClock.now().getTime(),
        )
      : null;
    if (!session) {
      return context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      );
    }
    if (
      session.role !== "hq" ||
      !authorizeRoleCapability(session, {
        capability: "chain:compare",
        sandboxId: session.sandboxId,
      })
    ) {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "HEADQUARTERS_COMPARISON_HQ_REQUIRED",
          "请切换到总部运营角色查看固定三店比较。",
          requestId,
        ),
        403,
      );
    }

    const fromBusinessDay = context.req.query("from");
    const toBusinessDay = context.req.query("to");
    const drilldown = context.req.query("drilldown");
    const storeId = context.req.query("storeId");
    const allowedKeys = new Set(["drilldown", "from", "storeId", "to"]);
    const invalid =
      Object.keys(context.req.query()).some((key) => !allowedKeys.has(key)) ||
      Boolean(fromBusinessDay) !== Boolean(toBusinessDay) ||
      (fromBusinessDay !== undefined &&
        !businessDayPattern.test(fromBusinessDay)) ||
      (toBusinessDay !== undefined &&
        !businessDayPattern.test(toBusinessDay)) ||
      (drilldown !== undefined &&
        !drilldownKinds.has(drilldown as ManagerDashboardDrilldownKind)) ||
      (storeId !== undefined && !UUID_V4_PATTERN.test(storeId)) ||
      (drilldown !== undefined && storeId === undefined) ||
      (storeId !== undefined && !session.storeIds.includes(storeId));
    if (invalid) {
      return context.json(
        errorBody(
          "HEADQUARTERS_COMPARISON_FILTER_INVALID",
          "请选择当前沙箱固定三店和有效经营日范围。",
          requestId,
        ),
        422,
      );
    }

    const targetStoreIds = storeId ? [storeId] : session.storeIds;
    if (targetStoreIds.length !== (storeId ? 1 : 3)) {
      return context.json(
        errorBody(
          "HEADQUARTERS_COMPARISON_SCOPE_INVALID",
          "总部比较仅允许当前沙箱固定三店。",
          requestId,
        ),
        403,
      );
    }
    try {
      const results = await Promise.all(
        targetStoreIds.map((targetStoreId) =>
          services.sandboxDatabase!.readManagerDashboard({
            contextVersion: session.contextVersion,
            ...(drilldown
              ? { drilldown: drilldown as ManagerDashboardDrilldownKind }
              : {}),
            ...(fromBusinessDay && toBusinessDay
              ? { fromBusinessDay, toBusinessDay }
              : {}),
            personaId: session.personaId,
            role: "hq",
            sandboxId: session.sandboxId,
            storeId: targetStoreId,
          }),
        ),
      );
      const ordered = HEADQUARTERS_FIXED_STORE_CODES.flatMap((code) => {
        const index = results.findIndex((result) => result.store.code === code);
        return index < 0
          ? []
          : [serializeStore(results[index]!, targetStoreIds[index]!)];
      });
      const first = results[0]!;
      return context.json({
        availableBusinessDays: first.availableBusinessDays.map((day) => ({
          ...day,
          endsAt: day.endsAt.toISOString(),
          startsAt: day.startsAt.toISOString(),
        })),
        currentTime: first.currentTime.toISOString(),
        range: {
          ...first.range,
          endsAt: first.range.endsAt.toISOString(),
          startsAt: first.range.startsAt.toISOString(),
        },
        status: "ready",
        stores: ordered,
      } satisfies HeadquartersComparisonResponse);
    } catch (error) {
      const mapped = failure(error, requestId);
      return context.json(mapped.body, mapped.status);
    }
  });
}
