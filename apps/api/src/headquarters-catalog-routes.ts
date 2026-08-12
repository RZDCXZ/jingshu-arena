import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie } from "hono/cookie";
import type {
  HeadquartersCatalogCommandRequest,
  HeadquartersCatalogCommandResponse,
  HeadquartersCatalogsResponse,
} from "@jingshu/contracts";
import type {
  ExecuteHeadquartersCatalogCommandInput,
  HeadquartersCatalogConflictReason,
} from "@jingshu/database";

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
  roleContextUnavailableBody,
  type AppEnvironment,
  type AppServices,
} from "./route-support.js";

const actions = new Set<HeadquartersCatalogCommandRequest["action"]>([
  "archive-machine-profile",
  "archive-product",
  "create-machine-profile",
  "create-product",
  "update-machine-profile",
  "update-product",
]);

function exactKeys(body: Record<string, unknown>, keys: ReadonlyArray<string>) {
  return (
    Object.keys(body).toSorted().join("|") === [...keys].toSorted().join("|")
  );
}

function stringWithin(value: unknown, maximum: number, minimum = 1) {
  return (
    typeof value === "string" &&
    value.trim().length >= minimum &&
    value.trim().length <= maximum
  );
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

function storeIds(value: unknown): value is ReadonlyArray<string> {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 3 &&
    value.every(uuid) &&
    new Set(value).size === value.length
  );
}

function parseCommand(body: unknown): HeadquartersCatalogCommandRequest | null {
  if (
    !isPlainRecord(body) ||
    typeof body.action !== "string" ||
    !actions.has(body.action as HeadquartersCatalogCommandRequest["action"])
  ) {
    return null;
  }
  switch (body.action) {
    case "create-product":
      return exactKeys(body, [
        "action",
        "availableStoreIds",
        "category",
        "code",
        "description",
        "displayName",
      ]) &&
        storeIds(body.availableStoreIds) &&
        ["drink", "meal", "snack", "supply"].includes(String(body.category)) &&
        stringWithin(body.code, 48) &&
        stringWithin(body.description, 240) &&
        stringWithin(body.displayName, 60)
        ? (body as unknown as HeadquartersCatalogCommandRequest)
        : null;
    case "update-product":
      return exactKeys(body, [
        "action",
        "availableStoreIds",
        "category",
        "description",
        "displayName",
        "expectedVersion",
        "productId",
      ]) &&
        storeIds(body.availableStoreIds) &&
        ["drink", "meal", "snack", "supply"].includes(String(body.category)) &&
        stringWithin(body.description, 240) &&
        stringWithin(body.displayName, 60) &&
        positiveInteger(body.expectedVersion) &&
        uuid(body.productId)
        ? (body as unknown as HeadquartersCatalogCommandRequest)
        : null;
    case "archive-product":
      return exactKeys(body, ["action", "expectedVersion", "productId"]) &&
        positiveInteger(body.expectedVersion) &&
        uuid(body.productId)
        ? (body as unknown as HeadquartersCatalogCommandRequest)
        : null;
    case "create-machine-profile":
      return exactKeys(body, [
        "action",
        "code",
        "displayName",
        "experienceDescription",
      ]) &&
        stringWithin(body.code, 48) &&
        stringWithin(body.displayName, 60) &&
        stringWithin(body.experienceDescription, 240)
        ? (body as unknown as HeadquartersCatalogCommandRequest)
        : null;
    case "update-machine-profile":
      return exactKeys(body, [
        "action",
        "displayName",
        "expectedVersion",
        "experienceDescription",
        "machineProfileId",
      ]) &&
        stringWithin(body.displayName, 60) &&
        positiveInteger(body.expectedVersion) &&
        stringWithin(body.experienceDescription, 240) &&
        uuid(body.machineProfileId)
        ? (body as unknown as HeadquartersCatalogCommandRequest)
        : null;
    case "archive-machine-profile":
      return exactKeys(body, [
        "action",
        "expectedVersion",
        "machineProfileId",
      ]) &&
        positiveInteger(body.expectedVersion) &&
        uuid(body.machineProfileId)
        ? (body as unknown as HeadquartersCatalogCommandRequest)
        : null;
    default:
      return null;
  }
}

function failure(error: unknown, requestId: string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "HEADQUARTERS_CATALOG_CONFLICT" &&
    "reason" in error
  ) {
    const mapping: Record<
      HeadquartersCatalogConflictReason,
      { code: string; message: string; status: 404 | 409 | 422 }
    > = {
      archived: {
        code: "HEADQUARTERS_CATALOG_ARCHIVED",
        message: "该目录项已经归档，不能继续编辑。",
        status: 409,
      },
      "code-conflict": {
        code: "HEADQUARTERS_CATALOG_CODE_CONFLICT",
        message: "目录代码已存在，请使用另一个虚构代码。",
        status: 409,
      },
      "idempotency-conflict": {
        code: "HEADQUARTERS_CATALOG_IDEMPOTENCY_CONFLICT",
        message: "原提交标识已用于另一项操作，请刷新后重试。",
        status: 409,
      },
      "invalid-machine-profile": {
        code: "HEADQUARTERS_MACHINE_PROFILE_INVALID",
        message: "请使用安全的虚构机型名称与体验描述。",
        status: 422,
      },
      "invalid-product": {
        code: "HEADQUARTERS_PRODUCT_INVALID",
        message: "请检查商品名称、分类、描述和适用门店。",
        status: 422,
      },
      "not-found": {
        code: "HEADQUARTERS_CATALOG_NOT_FOUND",
        message: "没有找到当前沙箱内可维护的目录项。",
        status: 404,
      },
      "product-store-scope": {
        code: "HEADQUARTERS_PRODUCT_STORE_SCOPE_INVALID",
        message: "商品适用门店必须来自当前沙箱的固定门店。",
        status: 422,
      },
      "version-conflict": {
        code: "HEADQUARTERS_CATALOG_VERSION_CONFLICT",
        message: "目录项已更新，请刷新后重试。",
        status: 409,
      },
    };
    const mapped = mapping[error.reason as HeadquartersCatalogConflictReason];
    if (mapped) {
      return {
        body: errorBody(mapped.code, mapped.message, requestId),
        status: mapped.status,
      };
    }
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
      "HEADQUARTERS_CATALOG_SERVICE_UNAVAILABLE",
      "总部目录服务暂不可用，页面不会伪造成功。",
      requestId,
    ),
    status: 503 as const,
  };
}

function requestId(context: Context) {
  const value = randomUUID();
  context.header("X-Request-Id", value);
  context.header("Cache-Control", "no-store");
  return value;
}

async function headquartersSession(
  context: Context,
  services: AppServices,
  id: string,
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
        errorBody("ROLE_CONTEXT_REQUIRED", "请先选择演示角色。", id),
        401,
      ),
      session: null,
    };
  }
  if (
    !authorizeRoleCapability(
      {
        personaId: session.personaId,
        role: session.role,
        sandboxId: session.sandboxId,
        storeIds: session.storeIds,
      },
      {
        capability: "chain:maintain-catalogs",
        sandboxId: session.sandboxId,
      },
    )
  ) {
    await recordRoleContextDenial(services, session, id, "capability_denied");
    return {
      response: context.json(
        errorBody(
          "HEADQUARTERS_CATALOG_ROLE_REQUIRED",
          "请切换到总部角色维护跨店商品与机型目录。",
          id,
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
  id: string,
  session: NonNullable<ReturnType<typeof readRoleSession>>,
) {
  if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
    await recordRoleContextDenial(services, session, id, "invalid_origin");
    return context.json(
      errorBody(
        "HEADQUARTERS_CATALOG_ORIGIN_INVALID",
        "请求来源无法验证，目录没有改变。",
        id,
      ),
      403,
    );
  }
  if (!csrfTokensMatch(session.csrfToken, context.req.header("X-CSRF-Token"))) {
    await recordRoleContextDenial(
      services,
      session,
      id,
      "csrf_context_mismatch",
    );
    return context.json(
      errorBody(
        "HEADQUARTERS_CATALOG_CSRF_INVALID",
        "页面上下文已变化，目录没有改变。",
        id,
      ),
      403,
    );
  }
  return null;
}

export function registerHeadquartersCatalogRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  app.get("/api/v1/hq/catalogs", async (context) => {
    const id = requestId(context);
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const mapped = failure(null, id);
      return context.json(mapped.body, mapped.status);
    }
    const auth = await headquartersSession(context, services, id);
    if (!auth.session) return auth.response;
    try {
      const result = await services.sandboxDatabase.readHeadquartersCatalogs({
        contextVersion: auth.session.contextVersion,
        personaId: auth.session.personaId,
        role: "hq",
        sandboxId: auth.session.sandboxId,
      });
      return context.json({
        ...result,
        currentTime: result.currentTime.toISOString(),
        status: "ready",
      } satisfies HeadquartersCatalogsResponse);
    } catch (error) {
      const mapped = failure(error, id);
      return context.json(mapped.body, mapped.status);
    }
  });

  app.post(
    "/api/v1/hq/catalogs/commands",
    bodyLimit({
      maxSize: 4 * 1024,
      onError: (context) =>
        context.json(
          errorBody(
            "HEADQUARTERS_CATALOG_BODY_TOO_LARGE",
            "总部目录请求超过允许大小，目录没有改变。",
            requestId(context),
          ),
          413,
        ),
    }),
    async (context) => {
      const id = requestId(context);
      if (!services.sandboxDatabase || !services.sessionSecret) {
        const mapped = failure(null, id);
        return context.json(mapped.body, mapped.status);
      }
      const auth = await headquartersSession(context, services, id);
      if (!auth.session) return auth.response;
      const denied = await authorizeMutation(
        context,
        services,
        id,
        auth.session,
      );
      if (denied) return denied;
      const idempotencyKey = context.req.header("Idempotency-Key");
      if (!idempotencyKey || !UUID_V4_PATTERN.test(idempotencyKey)) {
        return context.json(
          errorBody(
            "HEADQUARTERS_CATALOG_IDEMPOTENCY_REQUIRED",
            "提交需要有效且稳定的提交标识。",
            id,
          ),
          422,
        );
      }
      const body = parseCommand(await context.req.json().catch(() => null));
      if (!body) {
        return context.json(
          errorBody(
            "HEADQUARTERS_CATALOG_COMMAND_INVALID",
            "请使用商品或机型目录专用表单提交。",
            id,
          ),
          422,
        );
      }
      try {
        const result =
          await services.sandboxDatabase.executeHeadquartersCatalogCommand({
            ...body,
            contextVersion: auth.session.contextVersion,
            idempotencyKey,
            personaId: auth.session.personaId,
            requestId: id,
            role: "hq",
            sandboxId: auth.session.sandboxId,
          } as ExecuteHeadquartersCatalogCommandInput);
        return context.json({
          ...result,
          status: "ready",
        } satisfies HeadquartersCatalogCommandResponse);
      } catch (error) {
        const mapped = failure(error, id);
        return context.json(mapped.body, mapped.status);
      }
    },
  );
}
