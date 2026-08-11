import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { DatabaseRoleContext } from "@jingshu/database";

import {
  issueRoleSession,
  readRoleSession,
  readRoleSessionWithLegacyFallback,
} from "./role-session.js";
import type { RoleSessionPayload } from "./role-session.js";
import {
  SESSION_COOKIE,
  csrfTokensMatch,
  errorBody,
  isPlainRecord,
  isPublicRole,
  isRoleContextStale,
  isRoleContextUnavailable,
  recordRoleContextDenial,
  roleContextBody,
  setRoleSessionCookie,
  type AppServices,
} from "./route-support.js";

function sessionMatchesContext(
  session: RoleSessionPayload,
  current: DatabaseRoleContext,
) {
  const storeIds = current.storeScope.stores.map((store) => store.id);
  return (
    session.sandboxId === current.sandboxId &&
    session.contextVersion === current.contextVersion &&
    session.role === current.role &&
    session.personaId === current.persona.id &&
    session.storeIds.length === storeIds.length &&
    session.storeIds.every((storeId, index) => storeId === storeIds[index])
  );
}

export function registerRoleContextRoutes(app: Hono, services: AppServices) {
  app.get("/api/v1/demo/context", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
          "角色上下文暂时不可用，请稍后刷新。",
          requestId,
        ),
        503,
      );
    }

    const session = readRoleSessionWithLegacyFallback(
      getCookie(context, SESSION_COOKIE),
      services.sessionSecret,
      services.wallClock.now().getTime(),
    );
    if (!session) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_REQUIRED",
          "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId,
        ),
        401,
      );
    }

    try {
      if (session.version === 1) {
        const current = await services.sandboxDatabase.readCurrentRoleContext({
          sandboxId: session.sandboxId,
          claimRole: session.role,
        });
        const upgraded = issueRoleSession(current, services.sessionSecret);
        setRoleSessionCookie(context, upgraded.token, services);
        return context.json(
          roleContextBody(current, upgraded.payload.csrfToken),
        );
      }
      const roleContext = await services.sandboxDatabase.readRoleContext({
        sandboxId: session.sandboxId,
        contextVersion: session.contextVersion,
        role: session.role,
        personaId: session.personaId,
      });
      return context.json(roleContextBody(roleContext, session.csrfToken));
    } catch (error) {
      if (isRoleContextStale(error)) {
        return context.json(
          errorBody(
            "ROLE_CONTEXT_STALE",
            "当前标签的旧角色上下文已失效，请刷新到当前角色。",
            requestId,
          ),
          409,
        );
      }
      if (!isRoleContextUnavailable(error)) {
        return context.json(
          errorBody(
            "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
            "角色上下文暂时无法读取，请稍后安全重试。",
            requestId,
          ),
          503,
        );
      }
      return context.json(
        errorBody(
          "ROLE_CONTEXT_UNAVAILABLE",
          "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
          requestId,
        ),
        401,
      );
    }
  });

  app.post("/api/v1/demo/context/refresh", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
          "角色上下文暂时不可用，请稍后刷新。",
          requestId,
        ),
        503,
      );
    }

    const session = readRoleSessionWithLegacyFallback(
      getCookie(context, SESSION_COOKIE),
      services.sessionSecret,
      services.wallClock.now().getTime(),
    );
    if (!session) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_REQUIRED",
          "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId,
        ),
        401,
      );
    }

    const origin = context.req.header("Origin");
    if (!origin || !services.allowedOrigins.has(origin)) {
      if (session.version === 2) {
        await recordRoleContextDenial(
          services,
          session,
          requestId,
          "invalid_origin",
        );
      }
      return context.json(
        errorBody(
          "INVALID_REQUEST_ORIGIN",
          "请求来源无法验证，角色上下文没有刷新。",
          requestId,
        ),
        403,
      );
    }

    const parsedBody: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsedBody) ? parsedBody : null;
    const validPageContextVersion =
      typeof body?.pageContextVersion === "number" &&
      Number.isInteger(body.pageContextVersion) &&
      body.pageContextVersion > 0;
    const validCanonical =
      body?.mode === "canonical" &&
      (Object.keys(body).length === 1 ||
        (Object.keys(body).length === 2 && validPageContextVersion));
    const validUnknownOutcome =
      body?.mode === "switch-outcome-unknown" &&
      Object.keys(body).length === 2 &&
      validPageContextVersion;
    if (!body || (!validCanonical && !validUnknownOutcome)) {
      if (session.version === 2) {
        await recordRoleContextDenial(
          services,
          session,
          requestId,
          "forged_context_fields",
        );
      }
      return context.json(
        errorBody(
          "INVALID_ROLE_CONTEXT_REFRESH",
          "角色恢复请求无效，请重新确认当前演示上下文。",
          requestId,
        ),
        400,
      );
    }

    try {
      let fence:
        | {
            contextVersion: number;
            personaId: string;
            requestId: string;
            role: RoleSessionPayload["role"];
          }
        | undefined;
      if (
        session.version === 2 &&
        body.mode === "switch-outcome-unknown" &&
        validPageContextVersion &&
        body.pageContextVersion === session.contextVersion
      ) {
        if (
          !csrfTokensMatch(
            session.csrfToken,
            context.req.header("X-CSRF-Token"),
          )
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
              "当前标签的旧角色上下文已失效，请刷新到当前角色。",
              requestId,
            ),
            409,
          );
        }
        fence = {
          contextVersion: session.contextVersion,
          personaId: session.personaId,
          requestId,
          role: session.role,
        };
      }

      // Canonical recovery is read-only. The unknown-outcome fence advances the
      // signed context version and therefore requires both exact Origin and CSRF.
      const current = await services.sandboxDatabase.readCurrentRoleContext({
        sandboxId: session.sandboxId,
        ...(session.version === 1 ? { claimRole: session.role } : {}),
        ...(fence ? { fence } : {}),
      });
      if (session.version === 2 && sessionMatchesContext(session, current)) {
        return context.json(roleContextBody(current, session.csrfToken));
      }
      const nextSession = issueRoleSession(current, services.sessionSecret);
      setRoleSessionCookie(context, nextSession.token, services);
      return context.json(
        roleContextBody(current, nextSession.payload.csrfToken),
      );
    } catch (error) {
      if (isRoleContextUnavailable(error)) {
        return context.json(
          errorBody(
            "ROLE_CONTEXT_UNAVAILABLE",
            "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
            requestId,
          ),
          401,
        );
      }
      return context.json(
        errorBody(
          "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
          "角色上下文暂时无法恢复，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
  });

  app.post("/api/v1/demo/context/switch", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
          "角色上下文暂时不可用，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }

    const session = readRoleSession(
      getCookie(context, SESSION_COOKIE),
      services.sessionSecret,
      services.wallClock.now().getTime(),
    );
    if (!session) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_REQUIRED",
          "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId,
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
          "请求来源无法验证，角色没有切换。",
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
          "当前标签的旧角色上下文已失效，请刷新到当前角色。",
          requestId,
        ),
        409,
      );
    }

    const parsedBody: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsedBody) ? parsedBody : null;
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      !isPublicRole(body.targetRole) ||
      body.targetRole === session.role
    ) {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "forged_context_fields",
      );
      return context.json(
        errorBody(
          "INVALID_ROLE_SWITCH_REQUEST",
          "角色切换请求无效；人物、门店和沙箱范围只能由服务端确定。",
          requestId,
        ),
        400,
      );
    }

    try {
      const switched = await services.sandboxDatabase.switchRoleContext({
        sandboxId: session.sandboxId,
        contextVersion: session.contextVersion,
        role: session.role,
        personaId: session.personaId,
        targetRole: body.targetRole,
        requestId,
      });
      const nextSession = issueRoleSession(switched, services.sessionSecret);
      setRoleSessionCookie(context, nextSession.token, services);
      return context.json(
        roleContextBody(switched, nextSession.payload.csrfToken),
      );
    } catch (error) {
      if (isRoleContextStale(error)) {
        await recordRoleContextDenial(
          services,
          session,
          requestId,
          "context_version_stale",
        );
        return context.json(
          errorBody(
            "ROLE_CONTEXT_STALE",
            "当前标签的旧角色上下文已失效，请刷新到当前角色。",
            requestId,
          ),
          409,
        );
      }
      if (isRoleContextUnavailable(error)) {
        return context.json(
          errorBody(
            "ROLE_CONTEXT_UNAVAILABLE",
            "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
            requestId,
          ),
          401,
        );
      }
      return context.json(
        errorBody(
          "ROLE_CONTEXT_SWITCH_FAILED",
          "角色切换结果未确认；请刷新到服务端当前角色。",
          requestId,
        ),
        503,
      );
    }
  });
}
