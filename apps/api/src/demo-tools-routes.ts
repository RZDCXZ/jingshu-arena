import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type {
  ApiErrorResponse,
  DemoTimeAdvancedResponse,
  DemoTimeAdvanceMode,
  DemoTimePreviewResponse,
  SandboxResetReadyResponse,
} from "@jingshu/contracts";

import {
  issueRoleSession,
  readRoleSession,
  readRoleSessionEndReason,
} from "./role-session.js";
import {
  PUBLIC_VISITOR_COOKIE,
  readPublicVisitorKey,
} from "./public-sandbox-routes.js";
import {
  SESSION_COOKIE,
  UUID_V4_PATTERN,
  clientIpFromBindings,
  csrfTokensMatch,
  errorBody,
  isPlainRecord,
  isRoleContextStale,
  isRoleContextUnavailable,
  recordRoleContextDenial,
  roleContextBody,
  roleContextUnavailableBody,
  setRoleSessionCookie,
  type AppEnvironment,
  type AppServices,
} from "./route-support.js";

function hasErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

function roleContextError(
  error: unknown,
  requestId: string,
): { body: ApiErrorResponse; status: 401 | 409 } | null {
  if (isRoleContextStale(error)) {
    return {
      body: errorBody(
        "ROLE_CONTEXT_STALE",
        "当前标签的旧角色上下文已失效，请刷新到当前角色。",
        requestId,
      ),
      status: 409,
    };
  }
  if (isRoleContextUnavailable(error)) {
    return {
      body: roleContextUnavailableBody(
        error,
        "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
        requestId,
      ),
      status: 401,
    };
  }
  return null;
}

export function registerDemoToolsRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  app.get("/api/v1/demo/time", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "DEMO_TIME_SERVICE_UNAVAILABLE",
          "沙箱业务时间暂时无法读取，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
    const sessionToken = getCookie(context, SESSION_COOKIE);
    const now = services.wallClock.now().getTime();
    const session = readRoleSession(sessionToken, services.sessionSecret, now);
    if (!session) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_REQUIRED",
          "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId,
          readRoleSessionEndReason(sessionToken, services.sessionSecret, now),
        ),
        401,
      );
    }

    try {
      const preview = await services.sandboxDatabase.readDemoTime({
        contextVersion: session.contextVersion,
        personaId: session.personaId,
        role: session.role,
        sandboxId: session.sandboxId,
      });
      return context.json({
        status: "ready",
        clock: {
          ...preview.clock,
          currentTime: preview.clock.currentTime.toISOString(),
        },
        halfHour: {
          afterTime: preview.halfHour.afterTime?.toISOString() ?? null,
          impacts: preview.halfHour.impacts,
        },
        nextEvent: preview.nextEvent
          ? {
              afterTime: preview.nextEvent.afterTime.toISOString(),
              impacts: preview.nextEvent.impacts,
            }
          : null,
      } satisfies DemoTimePreviewResponse);
    } catch (error) {
      const roleError = roleContextError(error, requestId);
      if (roleError) return context.json(roleError.body, roleError.status);
      return context.json(
        errorBody(
          "DEMO_TIME_SERVICE_UNAVAILABLE",
          "沙箱业务时间暂时无法读取，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
  });

  app.post("/api/v1/demo/time/advance", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "DEMO_TIME_SERVICE_UNAVAILABLE",
          "演示时间推进暂时不可用，业务状态没有改变。",
          requestId,
        ),
        503,
      );
    }
    const sessionToken = getCookie(context, SESSION_COOKIE);
    const now = services.wallClock.now().getTime();
    const session = readRoleSession(sessionToken, services.sessionSecret, now);
    if (!session) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_REQUIRED",
          "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId,
          readRoleSessionEndReason(sessionToken, services.sessionSecret, now),
        ),
        401,
      );
    }

    const origin = context.req.header("Origin");
    if (!origin || !services.allowedOrigins.has(origin)) {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "invalid_origin",
      );
      return context.json(
        errorBody(
          "INVALID_REQUEST_ORIGIN",
          "请求来源无法验证，业务时间没有推进。",
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
          "ROLE_CONTEXT_STALE",
          "当前标签的写入上下文已失效，请刷新后重试。",
          requestId,
        ),
        409,
      );
    }

    const idempotencyKey = context.req.header("Idempotency-Key");
    if (!idempotencyKey || !UUID_V4_PATTERN.test(idempotencyKey)) {
      return context.json(
        errorBody(
          "INVALID_IDEMPOTENCY_KEY",
          "时间推进请求已失效，请重新确认影响。",
          requestId,
        ),
        400,
      );
    }
    const parsedBody: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsedBody) ? parsedBody : null;
    const mode = body?.mode;
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      (mode !== "next-event" && mode !== "half-hour")
    ) {
      return context.json(
        errorBody(
          "INVALID_DEMO_TIME_ADVANCE",
          "只能推进到下一事件或向前 30 分钟。",
          requestId,
        ),
        400,
      );
    }

    try {
      const result = await services.sandboxDatabase.advanceDemoTime({
        contextVersion: session.contextVersion,
        idempotencyKey,
        mode: mode satisfies DemoTimeAdvanceMode,
        personaId: session.personaId,
        requestId,
        role: session.role,
        sandboxId: session.sandboxId,
      });
      return context.json({
        status: "advanced",
        replayed: result.replayed,
        mode: result.mode,
        beforeTime: result.beforeTime.toISOString(),
        afterTime: result.afterTime.toISOString(),
        clock: result.clock,
        impacts: result.impacts,
      } satisfies DemoTimeAdvancedResponse);
    } catch (error) {
      const roleError = roleContextError(error, requestId);
      if (roleError) return context.json(roleError.body, roleError.status);
      if (hasErrorCode(error, "DEMO_TIME_ADVANCE_LIMIT_REACHED")) {
        return context.json(
          errorBody(
            "DEMO_TIME_ADVANCE_LIMIT_REACHED",
            "当前沙箱已达到 24 小时累计推进上限；重置后可重新开始。",
            requestId,
          ),
          409,
        );
      }
      if (hasErrorCode(error, "DEMO_TIME_NO_NEXT_EVENT")) {
        return context.json(
          errorBody(
            "DEMO_TIME_NO_NEXT_EVENT",
            "当前没有已登记的下一业务事件，可改用向前 30 分钟。",
            requestId,
          ),
          409,
        );
      }
      if (hasErrorCode(error, "SANDBOX_COMMAND_IDEMPOTENCY_CONFLICT")) {
        return context.json(
          errorBody(
            "DEMO_TIME_IDEMPOTENCY_CONFLICT",
            "该推进请求已用于另一种操作，请重新确认。",
            requestId,
          ),
          409,
        );
      }
      return context.json(
        errorBody(
          "DEMO_TIME_ADVANCE_FAILED",
          "到期处理未能全部完成，时钟和业务状态均未改变；可以安全重试。",
          requestId,
        ),
        503,
      );
    }
  });

  app.post("/api/v1/demo/reset", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "SANDBOX_RESET_SERVICE_UNAVAILABLE",
          "沙箱重置暂时不可用，当前沙箱已保留。",
          requestId,
        ),
        503,
      );
    }
    const sessionToken = getCookie(context, SESSION_COOKIE);
    const now = services.wallClock.now().getTime();
    const session = readRoleSession(sessionToken, services.sessionSecret, now);
    if (!session) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_REQUIRED",
          "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId,
          readRoleSessionEndReason(sessionToken, services.sessionSecret, now),
        ),
        401,
      );
    }
    const visitorKey = readPublicVisitorKey(
      getCookie(context, PUBLIC_VISITOR_COOKIE),
      services.sessionSecret,
    );
    if (!visitorKey) {
      return context.json(
        errorBody(
          "PUBLIC_VISITOR_CONTEXT_REQUIRED",
          "访客上下文已失效，请返回公开入口重新选择后再重置。",
          requestId,
        ),
        428,
      );
    }
    const origin = context.req.header("Origin");
    if (!origin || !services.allowedOrigins.has(origin)) {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "invalid_origin",
      );
      return context.json(
        errorBody(
          "INVALID_REQUEST_ORIGIN",
          "请求来源无法验证，当前沙箱已保留。",
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
          "ROLE_CONTEXT_STALE",
          "当前标签的写入上下文已失效，请刷新后重试。",
          requestId,
        ),
        409,
      );
    }
    const idempotencyKey = context.req.header("Idempotency-Key");
    if (!idempotencyKey || !UUID_V4_PATTERN.test(idempotencyKey)) {
      return context.json(
        errorBody(
          "INVALID_IDEMPOTENCY_KEY",
          "重置请求已失效，请重新确认四角色数据影响。",
          requestId,
        ),
        400,
      );
    }
    const parsedBody: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsedBody) ? parsedBody : null;
    if (!body || Object.keys(body).length !== 1 || body.confirm !== true) {
      return context.json(
        errorBody(
          "SANDBOX_RESET_CONFIRMATION_REQUIRED",
          "请确认了解四角色故事会由全新标准种子替换。",
          requestId,
        ),
        400,
      );
    }

    try {
      const clientIp = clientIpFromBindings(context.env?.clientIp);
      const result = await services.sandboxDatabase.resetSandbox({
        ...(clientIp ? { clientIp } : {}),
        contextVersion: session.contextVersion,
        idempotencyKey,
        personaId: session.personaId,
        requestId,
        role: session.role,
        sandboxId: session.sandboxId,
        visitorKey,
      });
      const nextSession = issueRoleSession(
        result.roleContext,
        services.sessionSecret,
      );
      setRoleSessionCookie(context, nextSession.token, services);
      return context.json(
        {
          status: "ready",
          replayed: result.replayed,
          previousSandboxInvalidated: true,
          result: {
            targetRole: result.outcome.targetRole,
            persona: {
              displayName: result.outcome.personaDisplayName,
            },
            sandbox: {
              schemaVersion: result.outcome.schemaVersion,
              seedVersion: result.outcome.seedVersion,
              expiresAt: result.outcome.expiresAt.toISOString(),
              businessClock: {
                ...result.outcome.businessClock,
                currentTime:
                  result.outcome.businessClock.currentTime.toISOString(),
              },
            },
          },
          context: roleContextBody(
            result.roleContext,
            nextSession.payload.csrfToken,
            services.wallClock.now(),
          ),
        } satisfies SandboxResetReadyResponse,
        result.replayed ? 200 : 201,
      );
    } catch (error) {
      const roleError = roleContextError(error, requestId);
      if (roleError) return context.json(roleError.body, roleError.status);
      if (hasErrorCode(error, "SANDBOX_COMMAND_IDEMPOTENCY_CONFLICT")) {
        return context.json(
          errorBody(
            "SANDBOX_RESET_IDEMPOTENCY_CONFLICT",
            "该重置请求已用于另一项操作，请重新确认。",
            requestId,
          ),
          409,
        );
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "PUBLIC_SANDBOX_RATE_LIMITED" &&
        "retryAt" in error &&
        error.retryAt instanceof Date
      ) {
        context.header(
          "Retry-After",
          String(
            Math.max(
              1,
              Math.ceil(
                (error.retryAt.getTime() - services.wallClock.now().getTime()) /
                  1_000,
              ),
            ),
          ),
        );
        return context.json(
          errorBody(
            "SANDBOX_RESET_RATE_LIMITED",
            "重置请求过于频繁；当前沙箱未被替换，请稍后安全重试。",
            requestId,
          ),
          429,
        );
      }
      return context.json(
        errorBody(
          "SANDBOX_RESET_FAILED",
          "新标准沙箱创建失败，当前沙箱已完整保留；可以安全重试。",
          requestId,
        ),
        503,
      );
    }
  });
}
