import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  STAFF_ORDER_ACTIONS,
  STAFF_ORDER_STAGE_FILTERS,
  type StaffOrderAction,
  type StaffOrderCommandResponse,
  type StaffOrderDetailResponse,
  type StaffOrderQueueResponse,
  type StaffOrderStageFilter,
  type StaffOrderSummaryResponse,
} from "@jingshu/contracts";
import type {
  DatabaseStaffOrderSummary,
  StaffOrderConflictError,
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
  roleContextUnavailableBody,
  type AppEnvironment,
  type AppServices,
} from "./route-support.js";

const stages = new Set<string>(STAFF_ORDER_STAGE_FILTERS);
const actions = new Set<string>(STAFF_ORDER_ACTIONS);

function containsUnsafeReasonCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 || character === "<" || character === ">";
  });
}

function staffOrderConflict(error: unknown): error is StaffOrderConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "STAFF_ORDER_CONFLICT"
  );
}

function failure(error: unknown, requestId: string) {
  if (isRoleContextStale(error)) {
    return {
      body: errorBody(
        "ROLE_CONTEXT_STALE",
        "当前标签的旧角色上下文已失效，请刷新到当前角色。",
        requestId,
      ),
      status: 409 as const,
    };
  }
  if (isRoleContextUnavailable(error)) {
    return {
      body: roleContextUnavailableBody(
        error,
        "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
        requestId,
      ),
      status: 401 as const,
    };
  }
  if (staffOrderConflict(error)) {
    const response = {
      "cross-store": {
        code: "STAFF_ORDER_NOT_FOUND",
        message: "未找到当前门店可处理的商品订单。",
        status: 404 as const,
      },
      "idempotency-conflict": {
        code: "STAFF_ORDER_IDEMPOTENCY_CONFLICT",
        message: "本次办理标识已用于其他内容，请检查订单后重新操作。",
        status: 409 as const,
      },
      "illegal-transition": {
        code: "STAFF_ORDER_ILLEGAL_TRANSITION",
        message: "当前订单状态不允许此动作，请刷新详情并执行唯一下一步。",
        status: 409 as const,
      },
      "not-found": {
        code: "STAFF_ORDER_NOT_FOUND",
        message: "未找到当前门店可处理的商品订单。",
        status: 404 as const,
      },
    }[error.reason];
    return {
      body: {
        error: {
          ...errorBody(response.code, response.message, requestId).error,
          ...(error.currentStatus
            ? { currentStatus: error.currentStatus }
            : {}),
        },
      },
      status: response.status,
    };
  }
  return {
    body: errorBody(
      "STAFF_ORDER_SERVICE_UNAVAILABLE",
      "商品订单暂时无法处理，订单与库存没有被部分修改；请稍后安全重试。",
      requestId,
    ),
    status: 503 as const,
  };
}

async function staffSession(
  context: Context,
  services: AppServices,
  requestId: string,
) {
  const session = services.sessionSecret
    ? readRoleSession(
        getCookie(context, SESSION_COOKIE),
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
  if (session.role !== "staff" && session.role !== "manager") {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "capability_denied",
    );
    return {
      response: context.json(
        errorBody(
          "STAFF_ORDER_ROLE_REQUIRED",
          "请切换到店员或店长角色后处理门店商品订单。",
          requestId,
        ),
        403,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

function summaryResponse(
  summary: DatabaseStaffOrderSummary,
): StaffOrderSummaryResponse {
  return { ...summary, stageEnteredAt: summary.stageEnteredAt.toISOString() };
}

export function registerStaffOrderRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  app.get("/api/v1/staff/orders", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = failure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await staffSession(context, services, requestId);
    if (!auth.session) return auth.response;
    const stage = context.req.query("stage") ?? "all";
    if (!stages.has(stage)) {
      return context.json(
        errorBody(
          "STAFF_ORDER_FILTER_INVALID",
          "商品订单筛选无效，请清除后重试。",
          requestId,
        ),
        422,
      );
    }
    try {
      const result = await services.sandboxDatabase.readStaffOrderQueue({
        contextVersion: auth.session.contextVersion,
        personaId: auth.session.personaId,
        role: auth.session.role as "manager" | "staff",
        sandboxId: auth.session.sandboxId,
        stage: stage as StaffOrderStageFilter,
      });
      return context.json({
        counts: result.counts,
        currentTime: result.currentTime.toISOString(),
        rows: result.rows.map(summaryResponse),
        stage: result.stage,
        status: "ready",
        store: result.store,
      } satisfies StaffOrderQueueResponse);
    } catch (error) {
      const mapped = failure(error, requestId);
      return context.json(mapped.body, mapped.status);
    }
  });

  app.get("/api/v1/staff/orders/:orderId", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = failure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await staffSession(context, services, requestId);
    if (!auth.session) return auth.response;
    const orderId = context.req.param("orderId");
    if (!UUID_V4_PATTERN.test(orderId)) {
      return context.json(
        errorBody(
          "STAFF_ORDER_ID_INVALID",
          "订单标识无效，请从队列重新打开。",
          requestId,
        ),
        422,
      );
    }
    try {
      const detail = await services.sandboxDatabase.readStaffOrderDetail({
        contextVersion: auth.session.contextVersion,
        orderId,
        personaId: auth.session.personaId,
        role: auth.session.role as "manager" | "staff",
        sandboxId: auth.session.sandboxId,
      });
      return context.json({
        actions: detail.actions,
        coupon: detail.coupon,
        currentTime: detail.currentTime.toISOString(),
        growth: detail.growth,
        inventory: detail.inventory,
        order: summaryResponse(detail.order),
        refund: detail.refund
          ? {
              ...detail.refund,
              occurredAt: detail.refund.occurredAt.toISOString(),
            }
          : null,
        snapshot: detail.snapshot,
        timeline: detail.events.map((event) => ({
          ...event,
          occurredAt: event.occurredAt.toISOString(),
        })),
      } satisfies StaffOrderDetailResponse);
    } catch (error) {
      const mapped = failure(error, requestId);
      return context.json(mapped.body, mapped.status);
    }
  });

  app.post("/api/v1/staff/orders/:orderId/commands", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = failure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await staffSession(context, services, requestId);
    if (!auth.session) return auth.response;
    if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
      await recordRoleContextDenial(
        services,
        auth.session,
        requestId,
        "invalid_origin",
      );
      return context.json(
        errorBody(
          "STAFF_ORDER_ORIGIN_INVALID",
          "请求来源无法验证，订单状态没有改变。",
          requestId,
        ),
        403,
      );
    }
    if (
      !csrfTokensMatch(
        auth.session.csrfToken,
        context.req.header("X-CSRF-Token"),
      )
    ) {
      await recordRoleContextDenial(
        services,
        auth.session,
        requestId,
        "csrf_context_mismatch",
      );
      return context.json(
        errorBody(
          "STAFF_ORDER_CSRF_INVALID",
          "角色上下文已经变化，请刷新后重新确认。",
          requestId,
        ),
        409,
      );
    }
    const orderId = context.req.param("orderId");
    const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    const action = typeof body?.action === "string" ? body.action : "";
    const suppliedReason =
      typeof body?.reason === "string" ? body.reason : null;
    const reason = suppliedReason?.trim() ?? null;
    if (
      !UUID_V4_PATTERN.test(orderId) ||
      !UUID_V4_PATTERN.test(idempotencyKey) ||
      !actions.has(action) ||
      !body ||
      Object.keys(body).some((key) => key !== "action" && key !== "reason") ||
      (action === "cancel" &&
        (!reason ||
          reason.length > 200 ||
          containsUnsafeReasonCharacter(reason))) ||
      (action !== "cancel" && body.reason !== undefined)
    ) {
      return context.json(
        errorBody(
          "STAFF_ORDER_COMMAND_INVALID",
          "请确认动作；取消订单时需填写 1–200 字纯文本原因。",
          requestId,
        ),
        422,
      );
    }
    try {
      const result = await services.sandboxDatabase.executeStaffOrderCommand({
        action: action as StaffOrderAction,
        contextVersion: auth.session.contextVersion,
        idempotencyKey,
        orderId,
        personaId: auth.session.personaId,
        reason,
        requestId,
        role: auth.session.role as "manager" | "staff",
        sandboxId: auth.session.sandboxId,
      });
      return context.json({
        action: result.action,
        couponRestored: result.couponRestored,
        growthPoints: result.growthPoints,
        inventoryEffect: result.inventoryEffect,
        occurredAt: result.occurredAt.toISOString(),
        orderId: result.orderId,
        replayed: result.replayed,
        simulatedRefundCents: result.simulatedRefundCents,
        status: result.status,
      } satisfies StaffOrderCommandResponse);
    } catch (error) {
      const mapped = failure(error, requestId);
      return context.json(mapped.body, mapped.status);
    }
  });
}
