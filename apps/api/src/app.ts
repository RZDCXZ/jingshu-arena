import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  PUBLIC_ROLES,
  type ApiErrorResponse,
  type ApiHealth,
  type PublicRole,
  type PublicSandboxReadyResponse,
} from "@jingshu/contracts";
import type { PublicSandboxDatabase } from "@jingshu/database";

const SESSION_COOKIE = "jingshu_session";
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const VISITOR_COOKIE = "jingshu_visitor";
const VISITOR_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const publicRoles = new Set<PublicRole>(PUBLIC_ROLES);
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface AppOptions {
  sandboxDatabase?: PublicSandboxDatabase;
  sessionSecret?: string;
  secureCookies?: boolean;
}

function isPublicRole(value: unknown): value is PublicRole {
  return typeof value === "string" && publicRoles.has(value as PublicRole);
}

function issueSessionToken(
  sandboxId: string,
  role: PublicRole,
  expiresAt: Date,
  secret: string,
): string {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      sandboxId,
      role,
      expiresAt: expiresAt.toISOString(),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

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

function readVisitorKey(
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
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("visitorKey" in parsed) ||
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

function errorBody(
  code: string,
  message: string,
  requestId: string,
): ApiErrorResponse {
  return { error: { code, message, requestId } };
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

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  app.get("/api/v1/health", (context) =>
    context.json({
      service: "jingshu-api",
      status: "ready",
    } satisfies ApiHealth),
  );

  app.get("/api/v1/public/visitor", (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!options.sessionSecret) {
      return context.json(
        errorBody(
          "SANDBOX_SERVICE_UNAVAILABLE",
          "演示世界暂时无法创建，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }

    const existingVisitorKey = readVisitorKey(
      getCookie(context, VISITOR_COOKIE),
      options.sessionSecret,
    );
    if (existingVisitorKey) return context.body(null, 204);

    const visitorToken = issueVisitorToken(randomUUID(), options.sessionSecret);
    setCookie(context, VISITOR_COOKIE, visitorToken, {
      httpOnly: true,
      maxAge: VISITOR_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "Lax",
      secure: options.secureCookies ?? process.env.NODE_ENV === "production",
    });
    return context.body(null, 204);
  });

  app.post("/api/v1/public/sandboxes", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    const body: Record<string, unknown> = await context.req
      .json<Record<string, unknown>>()
      .catch(() => ({}));
    if (!isPublicRole(body.role)) {
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

    if (!options.sandboxDatabase || !options.sessionSecret) {
      return context.json(
        errorBody(
          "SANDBOX_SERVICE_UNAVAILABLE",
          "演示世界暂时无法创建，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }

    const visitorKey = readVisitorKey(
      getCookie(context, VISITOR_COOKIE),
      options.sessionSecret,
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
      const result = await options.sandboxDatabase.create({
        creationKey,
        selectedRole: body.role,
        visitorKey,
      });
      const sessionToken = issueSessionToken(
        result.sandboxId,
        result.selectedRole,
        result.expiresAt,
        options.sessionSecret,
      );
      setCookie(context, SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_SECONDS,
        path: "/",
        sameSite: "Lax",
        secure: options.secureCookies ?? process.env.NODE_ENV === "production",
      });

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

  return app;
}

export const app = createApp();
