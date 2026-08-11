import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type {
  HandoverCommandResponse,
  ManagerHandoverExceptionsResponse,
  StaffHandover,
  StaffHandoverSnapshot,
  StaffHandoversResponse,
} from "@jingshu/contracts";
import type {
  DatabaseHandover,
  DatabaseHandoverSnapshot,
  HandoverConflictError,
  HandoverConflictReason,
} from "@jingshu/database";
import { normalizeHandoverNote } from "@jingshu/domain";

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

function snapshotResponse(
  snapshot: DatabaseHandoverSnapshot,
): StaffHandoverSnapshot {
  return {
    ...snapshot,
    capturedAt: snapshot.capturedAt.toISOString(),
    reservations: snapshot.reservations.map((reservation) => ({
      ...reservation,
      endsAt: reservation.endsAt.toISOString(),
      startsAt: reservation.startsAt.toISOString(),
    })),
  };
}

function handoverResponse(handover: DatabaseHandover): StaffHandover {
  return {
    ...handover,
    confirmed: handover.confirmed
      ? {
          ...handover.confirmed,
          businessOccurredAt:
            handover.confirmed.businessOccurredAt.toISOString(),
          recordedAt: handover.confirmed.recordedAt.toISOString(),
        }
      : null,
    snapshot: snapshotResponse(handover.snapshot),
    submittedAt: {
      businessOccurredAt: handover.submittedAt.businessOccurredAt.toISOString(),
      recordedAt: handover.submittedAt.recordedAt.toISOString(),
    },
  };
}

function isHandoverConflict(error: unknown): error is HandoverConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "HANDOVER_CONFLICT" &&
    "reason" in error
  );
}

function conflictResponse(error: HandoverConflictError, requestId: string) {
  const failures: Record<
    HandoverConflictReason,
    {
      readonly code: string;
      readonly message: string;
      readonly status: 404 | 409 | 422;
    }
  > = {
    "already-confirmed": {
      code: "HANDOVER_ALREADY_CONFIRMED",
      message: "该交接已经由接班员工确认，请刷新读取确认事实。",
      status: 409,
    },
    "already-submitted": {
      code: "HANDOVER_ALREADY_SUBMITTED",
      message: "该班次已经提交不可编辑交接，请刷新读取冻结快照。",
      status: 409,
    },
    "confirmation-not-eligible": {
      code: "HANDOVER_CONFIRMATION_NOT_ELIGIBLE",
      message: "只有另一名已签到的同店员工可以确认承接。",
      status: 409,
    },
    "handover-not-found": {
      code: "HANDOVER_NOT_FOUND",
      message: "没有找到当前门店可确认的交接。",
      status: 404,
    },
    "idempotency-conflict": {
      code: "HANDOVER_IDEMPOTENCY_CONFLICT",
      message: "原提交标识已用于另一项内容，请刷新后安全重试。",
      status: 409,
    },
    "note-invalid": {
      code: "HANDOVER_NOTE_INVALID",
      message: "补充说明最多 500 字，且不得包含现金盘点或真实支付对账。",
      status: 422,
    },
    "shift-not-eligible": {
      code: "HANDOVER_SHIFT_NOT_ELIGIBLE",
      message: "只有当前员工已签到且尚未交接的本人班次可以提交。",
      status: 409,
    },
  };
  const failure = failures[error.reason];
  return {
    body: errorBody(failure.code, failure.message, requestId),
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
      body: errorBody(
        "ROLE_CONTEXT_UNAVAILABLE",
        "当前演示角色或员工身份已失效，请返回公开入口重新选择。",
        requestId,
      ),
      status: 401 as const,
    };
  }
  if (isHandoverConflict(error)) return conflictResponse(error, requestId);
  return {
    body: errorBody(
      "HANDOVER_SERVICE_UNAVAILABLE",
      "交接班数据暂时不可用，当前状态没有被部分修改。",
      requestId,
    ),
    status: 503 as const,
  };
}

export function registerStaffHandoverRoutes(app: Hono, services: AppServices) {
  const readSession = (context: Parameters<typeof getCookie>[0]) =>
    services.sessionSecret
      ? readRoleSession(
          getCookie(context, SESSION_COOKIE),
          services.sessionSecret,
          services.wallClock.now().getTime(),
        )
      : null;

  const requireEmployeeSession = async (
    context: Parameters<typeof getCookie>[0],
    requestId: string,
  ) => {
    const session = readSession(context);
    if (!session)
      return {
        response: context.json(
          errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
          401,
        ),
      } as const;
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
            "HANDOVER_EMPLOYEE_ROLE_REQUIRED",
            "总部运营不执行门店交接，请切换到店员或店长角色。",
            requestId,
          ),
          403,
        ),
      } as const;
    }
    return { session } as const;
  };

  const validateWrite = async (
    context: Parameters<typeof getCookie>[0],
    session: NonNullable<ReturnType<typeof readSession>>,
    requestId: string,
  ) => {
    if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "invalid_origin",
      );
      return context.json(
        errorBody(
          "HANDOVER_ORIGIN_INVALID",
          "请求来源无法验证，交接状态没有改变。",
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
          "HANDOVER_CSRF_INVALID",
          "角色上下文已经变化，请刷新后重新确认。",
          requestId,
        ),
        409,
      );
    }
    return null;
  };

  app.get("/api/v1/staff/handovers", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "HANDOVER_SERVICE_UNAVAILABLE",
          "交接班数据暂时不可用，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
    const auth = await requireEmployeeSession(context, requestId);
    if ("response" in auth) return auth.response;
    try {
      const result = await services.sandboxDatabase.readOwnHandovers({
        contextVersion: auth.session.contextVersion,
        personaId: auth.session.personaId,
        role: auth.session.role as "manager" | "staff",
        sandboxId: auth.session.sandboxId,
      });
      return context.json({
        currentTime: result.currentTime.toISOString(),
        employee: result.employee,
        incoming: result.incoming.map((incoming) => ({
          canConfirm: incoming.canConfirm,
          handover: handoverResponse(incoming.handover),
        })),
        outgoing: result.outgoing
          ? {
              ...result.outgoing,
              handover: result.outgoing.handover
                ? handoverResponse(result.outgoing.handover)
                : null,
              snapshotPreview: snapshotResponse(
                result.outgoing.snapshotPreview,
              ),
              window: {
                endsAt: result.outgoing.window.endsAt.toISOString(),
                startsAt: result.outgoing.window.startsAt.toISOString(),
              },
            }
          : null,
        status: "ready",
        store: result.store,
      } satisfies StaffHandoversResponse);
    } catch (error) {
      const failure = contextFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post("/api/v1/staff/handovers", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "HANDOVER_SERVICE_UNAVAILABLE",
          "交接提交暂时不可用，当前状态没有被部分修改。",
          requestId,
        ),
        503,
      );
    }
    const auth = await requireEmployeeSession(context, requestId);
    if ("response" in auth) return auth.response;
    const writeFailure = await validateWrite(context, auth.session, requestId);
    if (writeFailure) return writeFailure;
    const body = await context.req.json().catch(() => null);
    const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
    if (
      !isPlainRecord(body) ||
      Object.keys(body).toSorted().join(",") !== "note,shiftId" ||
      typeof body.note !== "string" ||
      normalizeHandoverNote(body.note) === null ||
      typeof body.shiftId !== "string" ||
      !UUID_V4_PATTERN.test(body.shiftId) ||
      !UUID_V4_PATTERN.test(idempotencyKey)
    ) {
      return context.json(
        errorBody(
          "HANDOVER_COMMAND_INVALID",
          "只可提交本人班次和最多 500 字的经营补充说明。",
          requestId,
        ),
        422,
      );
    }
    try {
      const result = await services.sandboxDatabase.submitOwnHandover({
        contextVersion: auth.session.contextVersion,
        idempotencyKey,
        note: body.note,
        personaId: auth.session.personaId,
        requestId,
        role: auth.session.role as "manager" | "staff",
        sandboxId: auth.session.sandboxId,
        shiftId: body.shiftId,
      });
      return context.json({
        ...handoverResponse(result),
        replayed: result.replayed,
      } satisfies HandoverCommandResponse);
    } catch (error) {
      const failure = contextFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post(
    "/api/v1/staff/handovers/:handoverId/confirmation",
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (!services.sandboxDatabase || !services.sessionSecret) {
        return context.json(
          errorBody(
            "HANDOVER_SERVICE_UNAVAILABLE",
            "接班确认暂时不可用，当前状态没有被部分修改。",
            requestId,
          ),
          503,
        );
      }
      const auth = await requireEmployeeSession(context, requestId);
      if ("response" in auth) return auth.response;
      const writeFailure = await validateWrite(
        context,
        auth.session,
        requestId,
      );
      if (writeFailure) return writeFailure;
      const body = await context.req.json().catch(() => null);
      const handoverId = context.req.param("handoverId");
      const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
      if (
        !isPlainRecord(body) ||
        Object.keys(body).length !== 0 ||
        !UUID_V4_PATTERN.test(handoverId) ||
        !UUID_V4_PATTERN.test(idempotencyKey)
      ) {
        return context.json(
          errorBody(
            "HANDOVER_CONFIRMATION_INVALID",
            "请从当前门店待确认交接中选择一项承接。",
            requestId,
          ),
          422,
        );
      }
      try {
        const result = await services.sandboxDatabase.confirmHandover({
          contextVersion: auth.session.contextVersion,
          handoverId,
          idempotencyKey,
          personaId: auth.session.personaId,
          requestId,
          role: auth.session.role as "manager" | "staff",
          sandboxId: auth.session.sandboxId,
        });
        return context.json({
          ...handoverResponse(result),
          replayed: result.replayed,
        } satisfies HandoverCommandResponse);
      } catch (error) {
        const failure = contextFailure(error, requestId);
        return context.json(failure.body, failure.status);
      }
    },
  );

  app.get("/api/v1/manager/handover-exceptions", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "HANDOVER_SERVICE_UNAVAILABLE",
          "交接异常暂时不可用，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
    const session = readSession(context);
    if (!session) {
      return context.json(
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", requestId),
        401,
      );
    }
    if (session.role !== "manager") {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "HANDOVER_MANAGER_ROLE_REQUIRED",
          "只有所属门店店长可以查看交接异常。",
          requestId,
        ),
        403,
      );
    }
    try {
      const result =
        await services.sandboxDatabase.readManagerHandoverExceptions({
          contextVersion: session.contextVersion,
          personaId: session.personaId,
          role: "manager",
          sandboxId: session.sandboxId,
        });
      return context.json({
        currentTime: result.currentTime.toISOString(),
        exceptions: result.exceptions.map((exception) => ({
          ...exception,
          businessOccurredAt: exception.businessOccurredAt.toISOString(),
          handover: exception.handover
            ? handoverResponse(exception.handover)
            : null,
          recordedAt: exception.recordedAt.toISOString(),
          window: {
            endsAt: exception.window.endsAt.toISOString(),
            startsAt: exception.window.startsAt.toISOString(),
          },
        })),
        status: "ready",
        store: result.store,
      } satisfies ManagerHandoverExceptionsResponse);
    } catch (error) {
      const failure = contextFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });
}
