import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  ROLE_ACCESS_TARGET_KINDS,
  ROLE_CAPABILITIES,
  type RoleAccessAllowedResponse,
  type RoleAccessCheckRequest,
  type RoleAccessTargetKind,
  type RoleCapability,
} from "@jingshu/contracts";

import { authorizeRoleCapability } from "./role-authorization.js";
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

const roleAccessTargetKinds = new Set<RoleAccessTargetKind>(
  ROLE_ACCESS_TARGET_KINDS,
);
const roleCapabilities = new Set<RoleCapability>(ROLE_CAPABILITIES);

function isRoleCapability(value: unknown): value is RoleCapability {
  return (
    typeof value === "string" && roleCapabilities.has(value as RoleCapability)
  );
}

function parseRoleAccessCheck(value: unknown): RoleAccessCheckRequest | null {
  if (!isPlainRecord(value) || Object.keys(value).length !== 2) return null;
  if (!isRoleCapability(value.capability) || !isPlainRecord(value.target)) {
    return null;
  }
  if (
    Object.keys(value.target).length !== 2 ||
    typeof value.target.kind !== "string" ||
    !roleAccessTargetKinds.has(value.target.kind as RoleAccessTargetKind) ||
    typeof value.target.id !== "string" ||
    !UUID_V4_PATTERN.test(value.target.id)
  ) {
    return null;
  }

  const kind = value.target.kind as RoleAccessTargetKind;
  const capability = value.capability;
  const compatible =
    (capability === "customer:manage-own-records" && kind === "persona") ||
    ((capability === "chain:compare" ||
      capability === "chain:configure" ||
      capability === "chain:maintain-catalogs") &&
      kind === "sandbox") ||
    (capability !== "customer:manage-own-records" &&
      capability !== "chain:compare" &&
      capability !== "chain:configure" &&
      capability !== "chain:maintain-catalogs" &&
      kind === "store");
  if (!compatible) return null;

  return {
    capability,
    target: { id: value.target.id, kind },
  };
}

export function registerRoleAccessRoutes(app: Hono, services: AppServices) {
  app.post("/api/v1/demo/context/access", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
          "角色权限暂时无法确认，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }

    const session = readRoleSession(
      getCookie(context, SESSION_COOKIE),
      services.sessionSecret,
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
          "请求来源无法验证，权限没有授予。",
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

    const accessRequest = parseRoleAccessCheck(
      await context.req.json().catch(() => null),
    );
    if (!accessRequest) {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "forged_context_fields",
      );
      return context.json(
        errorBody(
          "INVALID_ROLE_ACCESS_REQUEST",
          "权限目标无效；沙箱、人物和门店范围只能由服务端确认。",
          requestId,
        ),
        400,
      );
    }

    try {
      const roleContext = await services.sandboxDatabase.readRoleContext({
        sandboxId: session.sandboxId,
        contextVersion: session.contextVersion,
        role: session.role,
        personaId: session.personaId,
      });
      const allowed = authorizeRoleCapability(
        {
          personaId: roleContext.persona.id,
          role: roleContext.role,
          sandboxId: roleContext.sandboxId,
          storeIds: roleContext.storeScope.stores.map((store) => store.id),
        },
        {
          capability: accessRequest.capability,
          ...(accessRequest.target.kind === "persona"
            ? { ownerPersonaId: accessRequest.target.id }
            : {}),
          sandboxId:
            accessRequest.target.kind === "sandbox"
              ? accessRequest.target.id
              : roleContext.sandboxId,
          ...(accessRequest.target.kind === "store"
            ? { storeId: accessRequest.target.id }
            : {}),
        },
      );
      if (!allowed) {
        await recordRoleContextDenial(
          services,
          session,
          requestId,
          "capability_denied",
          accessRequest.target,
        );
        return context.json(
          errorBody(
            "ROLE_CAPABILITY_DENIED",
            "当前角色不能对该对象执行此操作。",
            requestId,
          ),
          403,
        );
      }

      return context.json({
        status: "allowed",
        capability: accessRequest.capability,
        target: { kind: accessRequest.target.kind },
      } satisfies RoleAccessAllowedResponse);
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
          "ROLE_CONTEXT_SERVICE_UNAVAILABLE",
          "角色权限暂时无法确认，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
  });
}
