import { createHmac, randomUUID } from "node:crypto";

import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type {
  ApiErrorResponse,
  ApiHealth,
  PublicRole,
  PublicSandboxReadyResponse,
} from "@jingshu/contracts";
import type { PublicSandboxDatabase } from "@jingshu/database";

const SESSION_COOKIE = "jingshu_session";
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
const publicRoles = new Set<PublicRole>(["customer", "staff", "manager", "hq"]);
const IDEMPOTENCY_KEY_PATTERN =
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

export function createApp(options: AppOptions = {}) {
  const app = new Hono();

  app.get("/api/v1/health", (context) =>
    context.json({
      service: "jingshu-api",
      status: "ready",
    } satisfies ApiHealth),
  );

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
    if (!creationKey || !IDEMPOTENCY_KEY_PATTERN.test(creationKey)) {
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

    try {
      const result = await options.sandboxDatabase.create({
        creationKey,
        selectedRole: body.role,
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
