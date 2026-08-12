import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { PublicSandboxReadyResponse } from "@jingshu/contracts";

import { issueRoleSession, readRoleSession } from "./role-session.js";
import {
  SESSION_COOKIE,
  UUID_V4_PATTERN,
  clientIpFromBindings,
  errorBody,
  isPlainRecord,
  isPublicRole,
  setRoleSessionCookie,
  type AppEnvironment,
  type AppServices,
} from "./route-support.js";

export const PUBLIC_VISITOR_COOKIE = "jingshu_visitor";
const VISITOR_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

function signVisitorPayload(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("jingshu-public-visitor-v1\0")
    .update(payload)
    .digest();
}

function issueVisitorToken(visitorKey: string, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ version: 1, visitorKey }),
  ).toString("base64url");
  const signature = signVisitorPayload(payload, secret).toString("base64url");
  return `${payload}.${signature}`;
}

export function readPublicVisitorKey(
  token: string | undefined,
  secret: string,
): string | null {
  if (!token || token.length > 2_048) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, encodedSignature] = parts;
  if (!payload || !encodedSignature) return null;

  try {
    const expectedSignature = signVisitorPayload(payload, secret);
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null;
    }

    const parsed: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (
      !isPlainRecord(parsed) ||
      parsed.version !== 1 ||
      typeof parsed.visitorKey !== "string" ||
      !UUID_V4_PATTERN.test(parsed.visitorKey)
    ) {
      return null;
    }

    return parsed.visitorKey;
  } catch {
    return null;
  }
}

function isIdempotencyConflict(
  error: unknown,
): error is { code: "PUBLIC_SANDBOX_IDEMPOTENCY_CONFLICT" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "PUBLIC_SANDBOX_IDEMPOTENCY_CONFLICT"
  );
}

function isOwnershipConflict(
  error: unknown,
): error is { code: "PUBLIC_SANDBOX_OWNERSHIP_CONFLICT" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "PUBLIC_SANDBOX_OWNERSHIP_CONFLICT"
  );
}

export function registerPublicSandboxRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  app.get("/api/v1/public/visitor", (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!services.sessionSecret) {
      return context.json(
        errorBody(
          "SANDBOX_SERVICE_UNAVAILABLE",
          "演示世界暂时无法创建，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }

    const existingVisitorKey = readPublicVisitorKey(
      getCookie(context, PUBLIC_VISITOR_COOKIE),
      services.sessionSecret,
    );
    if (existingVisitorKey) return context.body(null, 204);

    const visitorToken = issueVisitorToken(
      randomUUID(),
      services.sessionSecret,
    );
    setCookie(context, PUBLIC_VISITOR_COOKIE, visitorToken, {
      httpOnly: true,
      maxAge: VISITOR_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "Lax",
      secure: services.secureCookies,
    });
    return context.body(null, 204);
  });

  app.post("/api/v1/public/sandboxes", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    const origin = context.req.header("Origin");
    if (!origin || !services.allowedOrigins.has(origin)) {
      return context.json(
        errorBody(
          "INVALID_REQUEST_ORIGIN",
          "请求来源无法验证，演示世界没有创建。",
          requestId,
        ),
        403,
      );
    }

    const parsedBody: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsedBody) ? parsedBody : null;
    if (!body || !isPublicRole(body.role)) {
      return context.json(
        errorBody(
          "PUBLIC_ROLE_REQUIRED",
          "请选择一个演示角色后再创建沙箱。",
          requestId,
        ),
        400,
      );
    }

    const creationKey = context.req.header("Idempotency-Key");
    if (!creationKey || !UUID_V4_PATTERN.test(creationKey)) {
      return context.json(
        errorBody(
          "INVALID_IDEMPOTENCY_KEY",
          "创建请求已失效，请重新选择角色。",
          requestId,
        ),
        400,
      );
    }

    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "SANDBOX_SERVICE_UNAVAILABLE",
          "演示世界暂时无法创建，请稍后安全重试。",
          requestId,
        ),
        503,
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
          "访客上下文已失效，请重新选择角色后安全重试。",
          requestId,
        ),
        428,
      );
    }

    try {
      const clientIp = clientIpFromBindings(context.env?.clientIp);
      const result = await services.sandboxDatabase.create({
        ...(clientIp ? { clientIp } : {}),
        creationKey,
        selectedRole: body.role,
        visitorKey,
      });
      const existingSession = readRoleSession(
        getCookie(context, SESSION_COOKIE),
        services.sessionSecret,
        services.wallClock.now().getTime(),
      );
      const preservesSameSandboxSession =
        result.replayed && existingSession?.sandboxId === result.sandboxId;
      if (!preservesSameSandboxSession) {
        const session = issueRoleSession(
          result.roleContext,
          services.sessionSecret,
        );
        setRoleSessionCookie(context, session.token, services);
      }

      const response = {
        status: "ready",
        replayed: result.replayed,
        role: result.selectedRole,
        persona: {
          displayName: result.persona.displayName,
          scope: result.persona.scope,
        },
        world: {
          schemaVersion: result.schemaVersion,
          seedVersion: result.seedVersion,
          expiresAt: result.expiresAt.toISOString(),
          operator: result.operator,
          stores: result.stores,
        },
      } satisfies PublicSandboxReadyResponse;

      return context.json(response, result.replayed ? 200 : 201);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "PUBLIC_SANDBOX_CAPACITY_EXHAUSTED" &&
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
            "PUBLIC_SANDBOX_CAPACITY_EXHAUSTED",
            "当前公共演示容量已满。你可以查看只读标准快照，并稍后重新创建独立沙箱。",
            requestId,
          ),
          503,
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
            "PUBLIC_SANDBOX_RATE_LIMITED",
            "创建请求过于频繁；本次没有生成部分沙箱，请稍后安全重试。",
            requestId,
          ),
          429,
        );
      }
      if (isIdempotencyConflict(error)) {
        return context.json(
          errorBody(
            "PUBLIC_SANDBOX_IDEMPOTENCY_CONFLICT",
            "这次重试与原创建请求不一致，请重新选择角色。",
            requestId,
          ),
          409,
        );
      }

      if (isOwnershipConflict(error)) {
        return context.json(
          errorBody(
            "PUBLIC_SANDBOX_OWNERSHIP_CONFLICT",
            "该创建请求不属于当前访客，请重新选择角色。",
            requestId,
          ),
          409,
        );
      }

      return context.json(
        errorBody(
          "SANDBOX_CREATION_FAILED",
          "演示世界创建失败，未保存部分数据；你可以安全重试。",
          requestId,
        ),
        503,
      );
    }
  });
}
