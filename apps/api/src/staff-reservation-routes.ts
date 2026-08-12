import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  CUSTOMER_MACHINE_PROFILE_CODES,
  CUSTOMER_RESERVATION_STATUSES,
  FRONTLINE_RESERVATION_ACTIONS,
  STAFF_RESERVATION_ANOMALY_FILTERS,
  STAFF_RESERVATION_TIME_FILTERS,
  type CustomerPendingReservationResponse,
  type FrontlineReservationAction,
  type StaffReservationCommandResponse,
  type StaffReservationDetailResponse,
  type StaffReservationListResponse,
  type StaffReservationSummary,
  type StaffReservationWorkbenchResponse,
} from "@jingshu/contracts";
import type {
  DatabaseStaffReservationDetail,
  DatabaseStaffReservationSummary,
  FrontlineReservationConflictError,
  FrontlineReservationConflictReason,
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

const statuses = new Set<string>(CUSTOMER_RESERVATION_STATUSES);
const machineProfiles = new Set<string>(CUSTOMER_MACHINE_PROFILE_CODES);
const timeFilters = new Set<string>(STAFF_RESERVATION_TIME_FILTERS);
const anomalyFilters = new Set<string>(STAFF_RESERVATION_ANOMALY_FILTERS);
const actions = new Set<string>(FRONTLINE_RESERVATION_ACTIONS);
const safeCodePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function containsUnsafeReasonCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127 || character === "<" || character === ">";
  });
}

function summaryResponse(
  summary: DatabaseStaffReservationSummary,
): StaffReservationSummary {
  return {
    ...summary,
    arrivalWindow: {
      closesAt: summary.arrivalWindow.closesAt.toISOString(),
      opensAt: summary.arrivalWindow.opensAt.toISOString(),
    },
    window: {
      endsAt: summary.window.endsAt.toISOString(),
      startsAt: summary.window.startsAt.toISOString(),
    },
  };
}

function snapshotResponse(
  snapshot: DatabaseStaffReservationDetail["snapshot"],
): CustomerPendingReservationResponse["snapshot"] {
  return {
    ...snapshot,
    price: {
      ...snapshot.price,
      segments: snapshot.price.segments.map((segment) => ({
        ...segment,
        endsAt: segment.endsAt.toISOString(),
        startsAt: segment.startsAt.toISOString(),
      })),
    },
    window: {
      endsAt: snapshot.window.endsAt.toISOString(),
      startsAt: snapshot.window.startsAt.toISOString(),
    },
  };
}

function detailResponse(
  detail: DatabaseStaffReservationDetail,
): StaffReservationDetailResponse {
  return {
    actions: detail.actions,
    arrivedAt: detail.arrivedAt?.toISOString() ?? null,
    auditAvailable: detail.auditAvailable,
    cancelledAt: detail.cancelledAt?.toISOString() ?? null,
    completedAt: detail.completedAt?.toISOString() ?? null,
    currentTime: detail.currentTime.toISOString(),
    refund: detail.refund
      ? { ...detail.refund, occurredAt: detail.refund.occurredAt.toISOString() }
      : null,
    related: detail.related,
    reservation: summaryResponse(detail.reservation),
    snapshot: snapshotResponse(detail.snapshot),
    startedAt: detail.startedAt?.toISOString() ?? null,
    terminalReason: detail.terminalReason,
    timeline: detail.events.map((event) => ({
      data: event.data,
      occurredAt: event.occurredAt.toISOString(),
      type: event.type,
    })),
  };
}

function isFrontlineConflict(
  error: unknown,
): error is FrontlineReservationConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "FRONTLINE_RESERVATION_CONFLICT" &&
    "reason" in error
  );
}

function conflictResponse(
  error: FrontlineReservationConflictError,
  requestId: string,
) {
  const failures: Record<
    FrontlineReservationConflictReason,
    { code: string; message: string; status: 403 | 404 | 409 }
  > = {
    "arrival-window-closed": {
      code: "STAFF_RESERVATION_ARRIVAL_WINDOW_CLOSED",
      message: "到店窗口已关闭，预约可能已经进入爽约处理；请刷新详情。",
      status: 409,
    },
    "arrival-window-not-open": {
      code: "STAFF_RESERVATION_ARRIVAL_WINDOW_NOT_OPEN",
      message: "只能在计划开始前 30 分钟起办理到店。",
      status: 409,
    },
    "cross-store": {
      code: "STAFF_RESERVATION_STORE_SCOPE_DENIED",
      message: "当前角色只能处理所属门店的预约。",
      status: 403,
    },
    "hold-expired": {
      code: "STAFF_RESERVATION_HOLD_EXPIRED",
      message: "待确认预约已经过期，请刷新列表。",
      status: 409,
    },
    "idempotency-conflict": {
      code: "STAFF_RESERVATION_IDEMPOTENCY_CONFLICT",
      message: "原提交标识已用于另一项内容，请刷新后重新确认。",
      status: 409,
    },
    "illegal-transition": {
      code: "STAFF_RESERVATION_ILLEGAL_TRANSITION",
      message: "当前预约状态不允许执行该动作，请刷新详情。",
      status: 409,
    },
    "not-found": {
      code: "STAFF_RESERVATION_NOT_FOUND",
      message: "没有找到当前门店可处理的预约。",
      status: 404,
    },
    "reservation-ended": {
      code: "STAFF_RESERVATION_ALREADY_ENDED",
      message: "预约已到计划结束时间，请刷新以读取自动完成结果。",
      status: 409,
    },
    "reservation-not-started": {
      code: "STAFF_RESERVATION_NOT_STARTED",
      message: "只能在计划开始后进入使用中。",
      status: 409,
    },
  };
  const failure = failures[error.reason];
  return {
    body: {
      error: {
        ...errorBody(failure.code, failure.message, requestId).error,
        ...(error.currentStatus ? { currentStatus: error.currentStatus } : {}),
      },
    },
    status: failure.status,
  } as const;
}

function contextFailure(error: unknown, requestId: string) {
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
  if (isFrontlineConflict(error)) return conflictResponse(error, requestId);
  return {
    body: errorBody(
      "STAFF_RESERVATION_SERVICE_UNAVAILABLE",
      "预约现场数据暂时不可用，请稍后安全重试。",
      requestId,
    ),
    status: 503 as const,
  };
}

export function registerStaffReservationRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  const readSession = (context: Parameters<typeof getCookie>[0]) =>
    services.sessionSecret
      ? readRoleSession(
          getCookie(context, SESSION_COOKIE),
          services.sessionSecret,
          services.wallClock.now().getTime(),
        )
      : null;

  app.get("/api/v1/staff/workbench", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    const session = readSession(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "STAFF_RESERVATION_SERVICE_UNAVAILABLE",
          "预约现场数据暂时不可用，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
    if (!session) {
      return context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      );
    }
    if (session.role !== "staff" && session.role !== "manager") {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "STAFF_RESERVATION_ROLE_REQUIRED",
          "请切换到店员或店长角色后查看门店预约。",
          requestId,
        ),
        403,
      );
    }
    try {
      const result =
        await services.sandboxDatabase.readStaffReservationWorkbench({
          contextVersion: session.contextVersion,
          personaId: session.personaId,
          role: session.role,
          sandboxId: session.sandboxId,
        });
      return context.json({
        businessDay: {
          endsAt: result.businessDay.endsAt.toISOString(),
          key: result.businessDay.key,
          startsAt: result.businessDay.startsAt.toISOString(),
        },
        currentTime: result.currentTime.toISOString(),
        queues: {
          anomalies: result.queues.anomalies.map(summaryResponse),
          arrivalWindow: result.queues.arrivalWindow.map(summaryResponse),
          arrived: result.queues.arrived.map(summaryResponse),
          inUse: result.queues.inUse.map(summaryResponse),
        },
        status: "ready",
        store: result.store,
      } satisfies StaffReservationWorkbenchResponse);
    } catch (error) {
      const failure = contextFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.get("/api/v1/staff/reservations", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    const session = readSession(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "STAFF_RESERVATION_SERVICE_UNAVAILABLE",
          "预约列表暂时不可用，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
    if (!session) {
      return context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      );
    }
    if (session.role !== "staff" && session.role !== "manager") {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "STAFF_RESERVATION_ROLE_REQUIRED",
          "请切换到店员或店长角色后查看门店预约。",
          requestId,
        ),
        403,
      );
    }
    const status = context.req.query("status") ?? "all";
    const time = context.req.query("time") ?? "all";
    const anomaly = context.req.query("anomaly") ?? "all";
    const area = context.req.query("area") ?? "all";
    const machine = context.req.query("machine") ?? "all";
    const search = context.req.query("search") ?? "";
    if (
      (status !== "all" && !statuses.has(status)) ||
      !timeFilters.has(time) ||
      !anomalyFilters.has(anomaly) ||
      (area !== "all" && !safeCodePattern.test(area)) ||
      (machine !== "all" && !machineProfiles.has(machine)) ||
      search.length > 100 ||
      containsUnsafeReasonCharacter(search)
    ) {
      return context.json(
        errorBody(
          "STAFF_RESERVATION_FILTER_INVALID",
          "预约筛选条件无效，请清除后重试。",
          requestId,
        ),
        422,
      );
    }
    try {
      const result = await services.sandboxDatabase.readStaffReservationList({
        anomaly: anomaly as (typeof STAFF_RESERVATION_ANOMALY_FILTERS)[number],
        areaCode: area === "all" ? null : area,
        contextVersion: session.contextVersion,
        machineProfileCode:
          machine === "all"
            ? null
            : (machine as (typeof CUSTOMER_MACHINE_PROFILE_CODES)[number]),
        personaId: session.personaId,
        role: session.role,
        sandboxId: session.sandboxId,
        search,
        status:
          status === "all"
            ? null
            : (status as (typeof CUSTOMER_RESERVATION_STATUSES)[number]),
        time: time as (typeof STAFF_RESERVATION_TIME_FILTERS)[number],
      });
      return context.json({
        businessDay: {
          endsAt: result.businessDay.endsAt.toISOString(),
          key: result.businessDay.key,
          startsAt: result.businessDay.startsAt.toISOString(),
        },
        currentTime: result.currentTime.toISOString(),
        filterOptions: result.filterOptions,
        rows: result.rows.map(summaryResponse),
        status: "ready",
        store: result.store,
      } satisfies StaffReservationListResponse);
    } catch (error) {
      const failure = contextFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.get("/api/v1/staff/reservations/:reservationId", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    const session = readSession(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "STAFF_RESERVATION_SERVICE_UNAVAILABLE",
          "预约详情暂时不可用，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
    if (!session) {
      return context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      );
    }
    if (session.role !== "staff" && session.role !== "manager") {
      return context.json(
        errorBody(
          "STAFF_RESERVATION_ROLE_REQUIRED",
          "请切换到店员或店长角色后查看门店预约。",
          requestId,
        ),
        403,
      );
    }
    const reservationId = context.req.param("reservationId");
    if (!UUID_V4_PATTERN.test(reservationId)) {
      return context.json(
        errorBody(
          "STAFF_RESERVATION_ID_INVALID",
          "预约标识无效，请从列表重新打开。",
          requestId,
        ),
        422,
      );
    }
    try {
      const detail = await services.sandboxDatabase.readStaffReservationDetail({
        contextVersion: session.contextVersion,
        personaId: session.personaId,
        reservationId,
        role: session.role,
        sandboxId: session.sandboxId,
      });
      return context.json(detailResponse(detail));
    } catch (error) {
      const failure = contextFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post(
    "/api/v1/staff/reservations/:reservationId/commands",
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      const session = readSession(context);
      if (!services.sandboxDatabase || !services.sessionSecret) {
        return context.json(
          errorBody(
            "STAFF_RESERVATION_SERVICE_UNAVAILABLE",
            "预约动作暂时不可用，当前状态没有被部分修改。",
            requestId,
          ),
          503,
        );
      }
      if (!session) {
        return context.json(
          errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
          401,
        );
      }
      if (session.role !== "staff" && session.role !== "manager") {
        await recordRoleContextDenial(
          services,
          session,
          requestId,
          "capability_denied",
        );
        return context.json(
          errorBody(
            "STAFF_RESERVATION_ROLE_REQUIRED",
            "请切换到店员或店长角色后执行门店预约动作。",
            requestId,
          ),
          403,
        );
      }
      if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
        await recordRoleContextDenial(
          services,
          session,
          requestId,
          "invalid_origin",
        );
        return context.json(
          errorBody(
            "STAFF_RESERVATION_ORIGIN_INVALID",
            "请求来源无法验证，预约状态没有改变。",
            requestId,
          ),
          403,
        );
      }
      if (
        !csrfTokensMatch(session.csrfToken, context.req.header("X-CSRF-Token"))
      ) {
        await recordRoleContextDenial(
          services,
          session,
          requestId,
          "csrf_context_mismatch",
        );
        return context.json(
          errorBody(
            "STAFF_RESERVATION_CSRF_INVALID",
            "角色上下文已经变化，请刷新后重新确认。",
            requestId,
          ),
          409,
        );
      }
      const reservationId = context.req.param("reservationId");
      const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
      const body = await context.req.json().catch(() => null);
      const action = isPlainRecord(body) ? body.action : null;
      const suppliedReason = isPlainRecord(body) ? body.reason : undefined;
      const reason =
        typeof suppliedReason === "string" ? suppliedReason.trim() : null;
      const needsReason = action === "cancel" || action === "complete-early";
      if (
        !UUID_V4_PATTERN.test(reservationId) ||
        !UUID_V4_PATTERN.test(idempotencyKey) ||
        typeof action !== "string" ||
        !actions.has(action) ||
        (needsReason &&
          (!reason ||
            reason.length > 200 ||
            containsUnsafeReasonCharacter(reason))) ||
        (!needsReason &&
          suppliedReason !== undefined &&
          suppliedReason !== null)
      ) {
        return context.json(
          errorBody(
            "STAFF_RESERVATION_COMMAND_INVALID",
            "请确认动作，并为提前结束或取消填写 1–200 字纯文本原因。",
            requestId,
          ),
          422,
        );
      }
      try {
        const result =
          await services.sandboxDatabase.executeStaffReservationCommand({
            action: action as FrontlineReservationAction,
            contextVersion: session.contextVersion,
            idempotencyKey,
            personaId: session.personaId,
            reason,
            requestId,
            reservationId,
            role: session.role,
            sandboxId: session.sandboxId,
          });
        return context.json({
          action: result.action,
          occurredAt: result.occurredAt.toISOString(),
          replayed: result.replayed,
          reservationId: result.reservationId,
          status: result.status,
        } satisfies StaffReservationCommandResponse);
      } catch (error) {
        const failure = contextFailure(error, requestId);
        return context.json(failure.body, failure.status);
      }
    },
  );
}
