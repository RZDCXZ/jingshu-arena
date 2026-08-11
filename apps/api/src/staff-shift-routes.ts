import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  STAFF_ATTENDANCE_ACTIONS,
  type StaffAttendanceAction,
  type StaffAttendanceCommandResponse,
  type StaffShiftAttendanceResponse,
  type StaffShiftAttendanceSummary,
} from "@jingshu/contracts";
import type {
  AttendanceConflictError,
  AttendanceConflictReason,
  DatabaseStaffShift,
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

const actions = new Set<string>(STAFF_ATTENDANCE_ACTIONS);

function shiftResponse(shift: DatabaseStaffShift): StaffShiftAttendanceSummary {
  return {
    attendance: shift.attendance
      ? {
          absence: shift.attendance.absence
            ? {
                businessOccurredAt:
                  shift.attendance.absence.businessOccurredAt.toISOString(),
                recordedAt: shift.attendance.absence.recordedAt.toISOString(),
              }
            : null,
          checkIn: shift.attendance.checkIn
            ? {
                ...shift.attendance.checkIn,
                businessOccurredAt:
                  shift.attendance.checkIn.businessOccurredAt.toISOString(),
                recordedAt: shift.attendance.checkIn.recordedAt.toISOString(),
              }
            : null,
          checkOut: shift.attendance.checkOut
            ? {
                ...shift.attendance.checkOut,
                businessOccurredAt:
                  shift.attendance.checkOut.businessOccurredAt.toISOString(),
                recordedAt: shift.attendance.checkOut.recordedAt.toISOString(),
              }
            : null,
          status: shift.attendance.status,
        }
      : null,
    canManageSchedule: shift.canManageSchedule,
    facts: shift.facts.map((fact) => ({
      ...fact,
      businessOccurredAt: fact.businessOccurredAt.toISOString(),
      recordedAt: fact.recordedAt.toISOString(),
    })),
    nextAction: shift.nextAction,
    shiftId: shift.shiftId,
    signInWindow: {
      closesAt: shift.signInWindow.closesAt.toISOString(),
      opensAt: shift.signInWindow.opensAt.toISOString(),
    },
    window: {
      endsAt: shift.window.endsAt.toISOString(),
      startsAt: shift.window.startsAt.toISOString(),
    },
  };
}

function isAttendanceConflict(
  error: unknown,
): error is AttendanceConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ATTENDANCE_CONFLICT" &&
    "reason" in error
  );
}

function conflictResponse(error: AttendanceConflictError, requestId: string) {
  const failures: Record<
    AttendanceConflictReason,
    {
      readonly code: string;
      readonly message: string;
      readonly status: 404 | 409;
    }
  > = {
    "already-checked-in": {
      code: "ATTENDANCE_ALREADY_CHECKED_IN",
      message: "该班次已完成签到；请刷新读取当前考勤事实。",
      status: 409,
    },
    "attendance-finalized": {
      code: "ATTENDANCE_ALREADY_FINALIZED",
      message: "该班次考勤已经结束，不能再次修改。",
      status: 409,
    },
    "employee-already-checked-in": {
      code: "ATTENDANCE_PREVIOUS_SHIFT_OPEN",
      message: "请先手动签退上一班次，再为其他班次签到。",
      status: 409,
    },
    "idempotency-conflict": {
      code: "ATTENDANCE_IDEMPOTENCY_CONFLICT",
      message: "原提交标识已用于另一项内容，请刷新后安全重试。",
      status: 409,
    },
    "not-checked-in": {
      code: "ATTENDANCE_NOT_CHECKED_IN",
      message: "当前班次尚未签到，不能签退。",
      status: 409,
    },
    "not-due": {
      code: "ATTENDANCE_ABSENCE_NOT_DUE",
      message: "班次尚未结束，不能记录缺勤。",
      status: 409,
    },
    "not-own-shift": {
      code: "ATTENDANCE_SHIFT_NOT_FOUND",
      message: "没有找到当前员工可操作的班次。",
      status: 404,
    },
    "shift-ended": {
      code: "ATTENDANCE_SHIFT_ENDED",
      message: "该班次已结束，系统将按业务时钟记录缺勤。",
      status: 409,
    },
    "sign-in-window-not-open": {
      code: "ATTENDANCE_SIGN_IN_WINDOW_NOT_OPEN",
      message: "只能在班次开始前 30 分钟起模拟签到。",
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
      body: errorBody(
        "ROLE_CONTEXT_UNAVAILABLE",
        "当前演示角色或员工身份已失效，请返回公开入口重新选择。",
        requestId,
      ),
      status: 401 as const,
    };
  }
  if (isAttendanceConflict(error)) {
    return conflictResponse(error, requestId);
  }
  return {
    body: errorBody(
      "ATTENDANCE_SERVICE_UNAVAILABLE",
      "班次与考勤数据暂时不可用，请稍后安全重试。",
      requestId,
    ),
    status: 503 as const,
  };
}

export function registerStaffShiftRoutes(app: Hono, services: AppServices) {
  const readSession = (context: Parameters<typeof getCookie>[0]) =>
    services.sessionSecret
      ? readRoleSession(
          getCookie(context, SESSION_COOKIE),
          services.sessionSecret,
          services.wallClock.now().getTime(),
        )
      : null;

  app.get("/api/v1/staff/shifts", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "ATTENDANCE_SERVICE_UNAVAILABLE",
          "班次与考勤数据暂时不可用，请稍后安全重试。",
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
    if (session.role !== "staff" && session.role !== "manager") {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "ATTENDANCE_EMPLOYEE_ROLE_REQUIRED",
          "请切换到店员或店长角色后查看本人班次。",
          requestId,
        ),
        403,
      );
    }
    try {
      const result = await services.sandboxDatabase.readOwnShiftAttendance({
        contextVersion: session.contextVersion,
        personaId: session.personaId,
        role: session.role,
        sandboxId: session.sandboxId,
      });
      return context.json({
        currentTime: result.currentTime.toISOString(),
        employee: result.employee,
        shifts: {
          current: result.shifts.current
            ? shiftResponse(result.shifts.current)
            : null,
          future: result.shifts.future.map(shiftResponse),
          recent: result.shifts.recent.map(shiftResponse),
        },
        status: "ready",
        store: result.store,
      } satisfies StaffShiftAttendanceResponse);
    } catch (error) {
      const failure = contextFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post("/api/v1/staff/shifts/:shiftId/attendance", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "ATTENDANCE_SERVICE_UNAVAILABLE",
          "考勤动作暂时不可用，当前状态没有被部分修改。",
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
    if (session.role !== "staff" && session.role !== "manager") {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "ATTENDANCE_EMPLOYEE_ROLE_REQUIRED",
          "请切换到店员或店长角色后操作本人考勤。",
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
          "ATTENDANCE_ORIGIN_INVALID",
          "请求来源无法验证，考勤状态没有改变。",
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
          "ATTENDANCE_CSRF_INVALID",
          "角色上下文已经变化，请刷新后重新确认。",
          requestId,
        ),
        409,
      );
    }
    const shiftId = context.req.param("shiftId");
    const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
    const body = await context.req.json().catch(() => null);
    const action = isPlainRecord(body) ? body.action : null;
    if (
      !UUID_V4_PATTERN.test(shiftId) ||
      !UUID_V4_PATTERN.test(idempotencyKey) ||
      !isPlainRecord(body) ||
      Object.keys(body).length !== 1 ||
      typeof action !== "string" ||
      !actions.has(action)
    ) {
      return context.json(
        errorBody(
          "ATTENDANCE_COMMAND_INVALID",
          "请从当前班次选择可用的签到或签退动作。",
          requestId,
        ),
        422,
      );
    }
    try {
      const result = await services.sandboxDatabase.executeOwnAttendanceCommand(
        {
          action: action as StaffAttendanceAction,
          contextVersion: session.contextVersion,
          idempotencyKey,
          personaId: session.personaId,
          requestId,
          role: session.role,
          sandboxId: session.sandboxId,
          shiftId,
        },
      );
      return context.json({
        action: result.action,
        occurredAt: result.occurredAt.toISOString(),
        outcome: result.outcome,
        replayed: result.replayed,
        shiftId: result.shiftId,
        status: result.status,
      } satisfies StaffAttendanceCommandResponse);
    } catch (error) {
      const failure = contextFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });
}
