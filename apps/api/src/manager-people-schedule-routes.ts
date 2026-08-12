import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import type {
  HeadquartersPeopleScheduleResponse,
  ManagerPeopleCommandRequest,
  ManagerPeopleCommandResponse,
  ManagerPeopleScheduleResponse,
  ManagerShiftCoveragePreviewRequest,
  ManagerShiftCoveragePreviewResponse,
} from "@jingshu/contracts";
import type {
  DatabaseManagerPeopleSchedule,
  ExecuteManagerPeopleCommandInput,
  ManagerPeopleConflictReason,
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

const commandActions = new Set<ManagerPeopleCommandRequest["action"]>([
  "cancel-shift",
  "correct-attendance",
  "create-employee",
  "create-shift",
  "deactivate-employee",
  "update-employee",
  "update-shift",
]);

function stringValue(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function integerValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function exactKeys(body: Record<string, unknown>, keys: ReadonlyArray<string>) {
  const actual = Object.keys(body).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function validDate(value: unknown): value is string {
  return stringValue(value) && !Number.isNaN(new Date(value).getTime());
}

function validUuid(value: unknown): value is string {
  return stringValue(value) && UUID_V4_PATTERN.test(value);
}

function parsePreview(
  body: unknown,
): ManagerShiftCoveragePreviewRequest | null {
  if (!isPlainRecord(body)) return null;
  const keys = Object.hasOwn(body, "shiftId")
    ? ["employeeId", "endsAt", "shiftId", "startsAt", "storeId"]
    : ["employeeId", "endsAt", "startsAt", "storeId"];
  return exactKeys(body, keys) &&
    validUuid(body.employeeId) &&
    validUuid(body.storeId) &&
    validDate(body.startsAt) &&
    validDate(body.endsAt) &&
    (!Object.hasOwn(body, "shiftId") || validUuid(body.shiftId))
    ? (body as unknown as ManagerShiftCoveragePreviewRequest)
    : null;
}

function parseCommand(body: unknown): ManagerPeopleCommandRequest | null {
  if (
    !isPlainRecord(body) ||
    !stringValue(body.action) ||
    !commandActions.has(body.action as ManagerPeopleCommandRequest["action"]) ||
    !validUuid(body.storeId)
  ) {
    return null;
  }
  switch (body.action) {
    case "create-employee":
      return exactKeys(body, [
        "action",
        "displayName",
        "employeeCode",
        "employeeRole",
        "storeId",
      ]) &&
        stringValue(body.displayName) &&
        stringValue(body.employeeCode) &&
        (body.employeeRole === "staff" || body.employeeRole === "manager")
        ? (body as unknown as ManagerPeopleCommandRequest)
        : null;
    case "update-employee":
      return exactKeys(body, [
        "action",
        "displayName",
        "employeeCode",
        "employeeId",
        "expectedVersion",
        "storeId",
      ]) &&
        stringValue(body.displayName) &&
        stringValue(body.employeeCode) &&
        validUuid(body.employeeId) &&
        integerValue(body.expectedVersion)
        ? (body as unknown as ManagerPeopleCommandRequest)
        : null;
    case "deactivate-employee":
      return exactKeys(body, [
        "action",
        "employeeId",
        "expectedVersion",
        "storeId",
      ]) &&
        validUuid(body.employeeId) &&
        integerValue(body.expectedVersion)
        ? (body as unknown as ManagerPeopleCommandRequest)
        : null;
    case "create-shift":
      return exactKeys(body, [
        "action",
        "employeeId",
        "endsAt",
        "startsAt",
        "storeId",
      ]) &&
        validUuid(body.employeeId) &&
        validDate(body.startsAt) &&
        validDate(body.endsAt)
        ? (body as unknown as ManagerPeopleCommandRequest)
        : null;
    case "update-shift":
      return exactKeys(body, [
        "action",
        "endsAt",
        "shiftId",
        "startsAt",
        "storeId",
      ]) &&
        validUuid(body.shiftId) &&
        validDate(body.startsAt) &&
        validDate(body.endsAt)
        ? (body as unknown as ManagerPeopleCommandRequest)
        : null;
    case "cancel-shift":
      return exactKeys(body, ["action", "shiftId", "storeId"]) &&
        validUuid(body.shiftId)
        ? (body as unknown as ManagerPeopleCommandRequest)
        : null;
    case "correct-attendance":
      return exactKeys(body, [
        "action",
        "attendanceRecordId",
        "correctedBusinessAt",
        "correctionKind",
        "reason",
        "storeId",
      ]) &&
        validUuid(body.attendanceRecordId) &&
        validDate(body.correctedBusinessAt) &&
        (body.correctionKind === "absence" ||
          body.correctionKind === "check-out" ||
          body.correctionKind === "late") &&
        stringValue(body.reason)
        ? (body as unknown as ManagerPeopleCommandRequest)
        : null;
    default:
      return null;
  }
}

function warningResponse(warning: {
  actualStaff: number;
  endsAt: Date;
  minimumStaff: number;
  startsAt: Date;
}) {
  return {
    actualStaff: warning.actualStaff,
    endsAt: warning.endsAt.toISOString(),
    minimumStaff: warning.minimumStaff,
    startsAt: warning.startsAt.toISOString(),
  };
}

function managerResponse(
  result: DatabaseManagerPeopleSchedule,
): ManagerPeopleScheduleResponse {
  return {
    ...result,
    attendance: result.attendance.map((record) => ({
      ...record,
      corrections: record.corrections.map((correction) => ({
        ...correction,
        businessOccurredAt: correction.businessOccurredAt.toISOString(),
        correctedBusinessAt: correction.correctedBusinessAt.toISOString(),
        recordedAt: correction.recordedAt.toISOString(),
      })),
      original: {
        ...record.original,
        absenceBusinessAt:
          record.original.absenceBusinessAt?.toISOString() ?? null,
        checkInBusinessAt:
          record.original.checkInBusinessAt?.toISOString() ?? null,
        checkOutBusinessAt:
          record.original.checkOutBusinessAt?.toISOString() ?? null,
      },
      window: {
        endsAt: record.window.endsAt.toISOString(),
        startsAt: record.window.startsAt.toISOString(),
      },
    })),
    coverageWarnings: result.coverageWarnings.map(warningResponse),
    currentTime: result.currentTime.toISOString(),
    shifts: result.shifts.map((shift) => ({
      ...shift,
      endsAt: shift.endsAt.toISOString(),
      startsAt: shift.startsAt.toISOString(),
    })),
    status: "ready",
  };
}

function failure(error: unknown, requestId: string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MANAGER_PEOPLE_CONFLICT" &&
    "reason" in error
  ) {
    const reasons: Record<
      ManagerPeopleConflictReason,
      { code: string; message: string; status: 404 | 409 | 422 }
    > = {
      "cross-store": {
        code: "MANAGER_PEOPLE_NOT_FOUND",
        message: "没有找到当前门店可维护的人员或排班。",
        status: 404,
      },
      "duplicate-employee-code": {
        code: "EMPLOYEE_CODE_CONFLICT",
        message: "员工编号在当前门店内必须唯一。",
        status: 409,
      },
      "employee-dependencies": {
        code: "EMPLOYEE_DEPENDENCIES",
        message: "请先处理当前或未来排班及未关闭维修，再停用员工。",
        status: 409,
      },
      "employee-not-found": {
        code: "MANAGER_PEOPLE_NOT_FOUND",
        message: "没有找到当前门店可维护的员工。",
        status: 404,
      },
      "idempotency-conflict": {
        code: "MANAGER_PEOPLE_IDEMPOTENCY_CONFLICT",
        message: "原提交标识已用于另一项操作，请刷新后重试。",
        status: 409,
      },
      "inactive-employee": {
        code: "EMPLOYEE_INACTIVE",
        message: "停用员工不能继续编辑或排班。",
        status: 409,
      },
      "invalid-attendance-correction": {
        code: "ATTENDANCE_CORRECTION_INVALID",
        message: "考勤更正必须关联已有事实并填写 1–200 字安全原因。",
        status: 422,
      },
      "invalid-employee": {
        code: "EMPLOYEE_INVALID",
        message: "请检查员工姓名和门店内唯一编号。",
        status: 422,
      },
      "invalid-shift": {
        code: "SHIFT_INVALID",
        message: "排班须按半小时对齐，时长为 4–12 小时。",
        status: 422,
      },
      "protected-employee": {
        code: "EMPLOYEE_PROTECTED",
        message: "公开演示固定员工不可编辑或停用。",
        status: 409,
      },
      "shift-attended": {
        code: "SHIFT_ATTENDED",
        message: "已有考勤事实的排班不可编辑或取消。",
        status: 409,
      },
      "shift-not-found": {
        code: "MANAGER_PEOPLE_NOT_FOUND",
        message: "没有找到当前门店可维护的排班。",
        status: 404,
      },
      "shift-not-future": {
        code: "SHIFT_NOT_FUTURE",
        message: "只有未来且未发生考勤的排班可以维护。",
        status: 409,
      },
      "shift-overlap": {
        code: "SHIFT_OVERLAP",
        message: "同一员工的排班时间不能重叠。",
        status: 409,
      },
      "version-conflict": {
        code: "EMPLOYEE_VERSION_CONFLICT",
        message: "员工资料已更新，请刷新后重试。",
        status: 409,
      },
    };
    const mapped = reasons[error.reason as ManagerPeopleConflictReason];
    if (mapped)
      return {
        body: errorBody(mapped.code, mapped.message, requestId),
        status: mapped.status,
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
      "MANAGER_PEOPLE_SERVICE_UNAVAILABLE",
      "人员排班服务暂不可用，页面不会伪造成功。",
      requestId,
    ),
    status: 503 as const,
  };
}

async function roleSession(
  context: Context,
  services: AppServices,
  requestId: string,
  requiredRole: "hq" | "manager",
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
  if (session.role !== requiredRole) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "capability_denied",
    );
    return {
      response: context.json(
        errorBody(
          "MANAGER_PEOPLE_ROLE_REQUIRED",
          requiredRole === "manager"
            ? "请切换到店长角色维护所属门店人员与排班。"
            : "请切换到总部角色查看跨店汇总。",
          requestId,
        ),
        403,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

async function authorizeMutation(
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
        "MANAGER_PEOPLE_ORIGIN_INVALID",
        "请求来源无法验证，数据没有改变。",
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
        "MANAGER_PEOPLE_CSRF_INVALID",
        "页面上下文已变化，数据没有改变。",
        requestId,
      ),
      403,
    );
  }
  return null;
}

function requestHeaders(context: Context) {
  const requestId = randomUUID();
  context.header("X-Request-Id", requestId);
  context.header("Cache-Control", "no-store");
  return requestId;
}

export function registerManagerPeopleScheduleRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  app.get("/api/v1/manager/people-schedule", async (context) => {
    const requestId = requestHeaders(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const mapped = failure(null, requestId);
      return context.json(mapped.body, mapped.status);
    }
    const auth = await roleSession(context, services, requestId, "manager");
    if (!auth.session) return auth.response;
    try {
      const result = await services.sandboxDatabase.readManagerPeopleSchedule({
        contextVersion: auth.session.contextVersion,
        personaId: auth.session.personaId,
        role: "manager",
        sandboxId: auth.session.sandboxId,
      });
      return context.json(managerResponse(result));
    } catch (error) {
      const mapped = failure(error, requestId);
      return context.json(mapped.body, mapped.status);
    }
  });

  app.get("/api/v1/hq/people-schedule", async (context) => {
    const requestId = requestHeaders(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const mapped = failure(null, requestId);
      return context.json(mapped.body, mapped.status);
    }
    const auth = await roleSession(context, services, requestId, "hq");
    if (!auth.session) return auth.response;
    try {
      const result =
        await services.sandboxDatabase.readHeadquartersPeopleSchedule({
          contextVersion: auth.session.contextVersion,
          personaId: auth.session.personaId,
          role: "hq",
          sandboxId: auth.session.sandboxId,
        });
      return context.json({
        ...result,
        currentTime: result.currentTime.toISOString(),
        stores: result.stores.map((store) => ({
          ...store,
          coverage: {
            endsAt: store.coverage.endsAt.toISOString(),
            startsAt: store.coverage.startsAt.toISOString(),
            warnings: store.coverage.warnings.map((warning) => ({
              ...warning,
              endsAt: warning.endsAt.toISOString(),
              startsAt: warning.startsAt.toISOString(),
            })),
          },
          futureShifts: store.futureShifts.map((shift) => ({
            ...shift,
            endsAt: shift.endsAt.toISOString(),
            startsAt: shift.startsAt.toISOString(),
          })),
        })),
        status: "ready",
      } satisfies HeadquartersPeopleScheduleResponse);
    } catch (error) {
      const mapped = failure(error, requestId);
      return context.json(mapped.body, mapped.status);
    }
  });

  app.post(
    "/api/v1/manager/people-schedule/shift-preview",
    bodyLimit({
      maxSize: 4 * 1024,
      onError: (context) =>
        context.json(
          errorBody(
            "MANAGER_PEOPLE_BODY_TOO_LARGE",
            "排班检查请求超过允许大小。",
            requestHeaders(context),
          ),
          413,
        ),
    }),
    async (context) => {
      const requestId = requestHeaders(context);
      if (!services.sandboxDatabase || !services.sessionSecret) {
        const mapped = failure(null, requestId);
        return context.json(mapped.body, mapped.status);
      }
      const auth = await roleSession(context, services, requestId, "manager");
      if (!auth.session) return auth.response;
      const denied = await authorizeMutation(
        context,
        services,
        requestId,
        auth.session,
      );
      if (denied) return denied;
      const body = parsePreview(await context.req.json().catch(() => null));
      if (!body)
        return context.json(
          errorBody(
            "SHIFT_PREVIEW_INVALID",
            "请提交有效员工、门店和排班时段。",
            requestId,
          ),
          422,
        );
      try {
        const result =
          await services.sandboxDatabase.previewManagerShiftCoverage({
            contextVersion: auth.session.contextVersion,
            employeeId: body.employeeId,
            endsAt: new Date(body.endsAt),
            personaId: auth.session.personaId,
            requestId,
            role: "manager",
            sandboxId: auth.session.sandboxId,
            ...(body.shiftId ? { shiftId: body.shiftId } : {}),
            startsAt: new Date(body.startsAt),
            storeId: body.storeId,
          });
        return context.json({
          status: "ready",
          validation: result.validation,
          warnings: result.warnings.map(warningResponse),
        } satisfies ManagerShiftCoveragePreviewResponse);
      } catch (error) {
        const mapped = failure(error, requestId);
        return context.json(mapped.body, mapped.status);
      }
    },
  );

  app.post(
    "/api/v1/manager/people-schedule/commands",
    bodyLimit({
      maxSize: 4 * 1024,
      onError: (context) =>
        context.json(
          errorBody(
            "MANAGER_PEOPLE_BODY_TOO_LARGE",
            "人员排班请求超过允许大小，数据没有改变。",
            requestHeaders(context),
          ),
          413,
        ),
    }),
    async (context) => {
      const requestId = requestHeaders(context);
      if (!services.sandboxDatabase || !services.sessionSecret) {
        const mapped = failure(null, requestId);
        return context.json(mapped.body, mapped.status);
      }
      const auth = await roleSession(context, services, requestId, "manager");
      if (!auth.session) return auth.response;
      const denied = await authorizeMutation(
        context,
        services,
        requestId,
        auth.session,
      );
      if (denied) return denied;
      const idempotencyKey = context.req.header("Idempotency-Key");
      if (!idempotencyKey || !UUID_V4_PATTERN.test(idempotencyKey)) {
        return context.json(
          errorBody(
            "MANAGER_PEOPLE_IDEMPOTENCY_REQUIRED",
            "提交需要有效且稳定的提交标识。",
            requestId,
          ),
          422,
        );
      }
      const body = parseCommand(await context.req.json().catch(() => null));
      if (!body)
        return context.json(
          errorBody(
            "MANAGER_PEOPLE_COMMAND_INVALID",
            "请使用人员、排班或考勤专用表单提交。",
            requestId,
          ),
          422,
        );
      const dated =
        body.action === "create-shift" || body.action === "update-shift"
          ? {
              ...body,
              endsAt: new Date(body.endsAt),
              startsAt: new Date(body.startsAt),
            }
          : body.action === "correct-attendance"
            ? {
                ...body,
                correctedBusinessAt: new Date(body.correctedBusinessAt),
              }
            : body;
      try {
        const result =
          await services.sandboxDatabase.executeManagerPeopleCommand({
            ...dated,
            contextVersion: auth.session.contextVersion,
            idempotencyKey,
            personaId: auth.session.personaId,
            requestId,
            role: "manager",
            sandboxId: auth.session.sandboxId,
          } as ExecuteManagerPeopleCommandInput);
        return context.json({
          ...result,
          coverageWarnings: result.coverageWarnings.map(warningResponse),
          status: "ready",
        } satisfies ManagerPeopleCommandResponse);
      } catch (error) {
        const mapped = failure(error, requestId);
        return context.json(mapped.body, mapped.status);
      }
    },
  );
}
