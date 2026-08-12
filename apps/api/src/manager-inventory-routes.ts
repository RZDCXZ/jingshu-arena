import { randomUUID } from "node:crypto";

import type { Context } from "hono";
import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type {
  InventoryMovementResponse,
  ManagerInventoryCommandRequest,
  ManagerInventoryCommandResponse,
  StoreInventoryResponse,
} from "@jingshu/contracts";
import type {
  DatabaseInventoryMovement,
  ManagerInventoryConflictReason,
} from "@jingshu/database";
import { isSafePlainTextReason } from "@jingshu/domain";

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

function movementResponse(
  movement: DatabaseInventoryMovement,
): InventoryMovementResponse {
  return {
    ...movement,
    businessOccurredAt: movement.businessOccurredAt.toISOString(),
  };
}

function failure(error: unknown, requestId: string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MANAGER_INVENTORY_CONFLICT" &&
    "reason" in error
  ) {
    const reason = error.reason as ManagerInventoryConflictReason;
    const failures: Record<
      ManagerInventoryConflictReason,
      { code: string; message: string; status: 403 | 404 | 409 | 422 }
    > = {
      "cross-store": {
        code: "INVENTORY_ITEM_NOT_FOUND",
        message: "没有找到当前门店可调整的库存项目。",
        status: 404,
      },
      "idempotency-conflict": {
        code: "INVENTORY_IDEMPOTENCY_CONFLICT",
        message: "原提交标识已用于另一项库存内容，请刷新后重试。",
        status: 409,
      },
      "invalid-quantity": {
        code: "INVENTORY_QUANTITY_INVALID",
        message: "库存数量必须是符合当前动作要求的整数。",
        status: 422,
      },
      "invalid-reason": {
        code: "INVENTORY_REASON_INVALID",
        message: "业务原因必须是 1–200 字安全文本。",
        status: 422,
      },
      "no-change": {
        code: "INVENTORY_STOCKTAKE_NO_CHANGE",
        message: "实际数量与账面库存一致，无需创建盘点流水。",
        status: 409,
      },
      "not-found": {
        code: "INVENTORY_ITEM_NOT_FOUND",
        message: "没有找到当前门店可调整的库存项目。",
        status: 404,
      },
      "original-movement-not-found": {
        code: "INVENTORY_ORIGINAL_MOVEMENT_NOT_FOUND",
        message: "没有找到当前库存项目可关联的原流水。",
        status: 422,
      },
      "reserved-inventory": {
        code: "INVENTORY_RESERVED_QUANTITY_CONFLICT",
        message: "调整后账面库存不能小于当前预留库存。",
        status: 409,
      },
    };
    const mapped = failures[reason];
    if (!mapped) {
      return {
        body: errorBody(
          "INVENTORY_SERVICE_UNAVAILABLE",
          "库存服务暂不可用，当前页面不会伪造数据。",
          requestId,
        ),
        status: 503 as const,
      };
    }
    return {
      body: errorBody(mapped.code, mapped.message, requestId),
      status: mapped.status,
    };
  }
  if (isRoleContextStale(error)) {
    return {
      body: errorBody(
        "ROLE_CONTEXT_STALE",
        "角色上下文已经变化，请刷新后重试。",
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
      "INVENTORY_SERVICE_UNAVAILABLE",
      "库存服务暂不可用，当前页面不会伪造数据。",
      requestId,
    ),
    status: 503 as const,
  };
}

async function frontlineSession(
  context: Context,
  services: AppServices,
  requestId: string,
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
          "INVENTORY_STORE_ROLE_REQUIRED",
          "请切换到店员或店长角色后查看门店库存。",
          requestId,
        ),
        403,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

export function registerManagerInventoryRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  app.get("/api/v1/store/inventory", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = failure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await frontlineSession(context, services, requestId);
    if (!auth.session) return auth.response;
    try {
      const result = await services.sandboxDatabase.readStoreInventory({
        contextVersion: auth.session.contextVersion,
        personaId: auth.session.personaId,
        role: auth.session.role as "manager" | "staff",
        sandboxId: auth.session.sandboxId,
      });
      const movements = result.movements.map(movementResponse);
      return context.json({
        currentTime: result.currentTime.toISOString(),
        items: result.items.map((item) => ({
          ...item,
          recentMovement: item.recentMovement
            ? movementResponse(item.recentMovement)
            : null,
        })),
        movements,
        status: "ready",
        store: result.store,
        summary: result.summary,
      } satisfies StoreInventoryResponse);
    } catch (error) {
      const mapped = failure(error, requestId);
      return context.json(mapped.body, mapped.status);
    }
  });

  app.post("/api/v1/store/inventory/commands", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      const unavailable = failure(null, requestId);
      return context.json(unavailable.body, unavailable.status);
    }
    const auth = await frontlineSession(context, services, requestId);
    if (!auth.session) return auth.response;
    if (auth.session.role !== "manager") {
      await recordRoleContextDenial(
        services,
        auth.session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "INVENTORY_MANAGER_REQUIRED",
          "店员只能查看余额；请切换到店长角色执行库存业务动作。",
          requestId,
        ),
        403,
      );
    }
    if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
      await recordRoleContextDenial(
        services,
        auth.session,
        requestId,
        "invalid_origin",
      );
      return context.json(
        errorBody(
          "INVENTORY_ORIGIN_INVALID",
          "请求来源无法验证，库存没有改变。",
          requestId,
        ),
        403,
      );
    }
    if (
      !csrfTokensMatch(
        auth.session.csrfToken,
        context.req.header("X-CSRF-Token"),
      )
    ) {
      await recordRoleContextDenial(
        services,
        auth.session,
        requestId,
        "csrf_context_mismatch",
      );
      return context.json(
        errorBody(
          "INVENTORY_CSRF_INVALID",
          "角色上下文已经变化，请刷新后重新确认。",
          requestId,
        ),
        409,
      );
    }
    const idempotencyKey = context.req.header("Idempotency-Key") ?? "";
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    const action = body?.action;
    const inventoryItemId = body?.inventoryItemId;
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const requiredKeys =
      action === "receipt"
        ? ["action", "inventoryItemId", "quantity", "reason"]
        : action === "stocktake"
          ? ["action", "actualQuantity", "inventoryItemId", "reason"]
          : action === "compensation"
            ? [
                "action",
                "inventoryItemId",
                "onHandDelta",
                "originalMovementId",
                "reason",
              ]
            : [];
    const exactKeys =
      body !== null &&
      Object.keys(body).toSorted().join("|") ===
        requiredKeys.toSorted().join("|");
    const quantityValid =
      (action === "receipt" &&
        Number.isInteger(body?.quantity) &&
        Number(body?.quantity) > 0) ||
      (action === "stocktake" &&
        Number.isInteger(body?.actualQuantity) &&
        Number(body?.actualQuantity) >= 0) ||
      (action === "compensation" &&
        Number.isInteger(body?.onHandDelta) &&
        Number(body?.onHandDelta) !== 0);
    const originalMovementValid =
      action !== "compensation" ||
      body?.originalMovementId === null ||
      (typeof body?.originalMovementId === "string" &&
        UUID_V4_PATTERN.test(body.originalMovementId));
    if (
      !body ||
      !exactKeys ||
      !UUID_V4_PATTERN.test(idempotencyKey) ||
      typeof inventoryItemId !== "string" ||
      !UUID_V4_PATTERN.test(inventoryItemId) ||
      !quantityValid ||
      !originalMovementValid ||
      !isSafePlainTextReason(reason)
    ) {
      return context.json(
        errorBody(
          "INVENTORY_COMMAND_INVALID",
          "请使用盘点、手工入库或补偿流水的专用字段提交安全的整数库存动作。",
          requestId,
        ),
        422,
      );
    }
    const request = { ...body, reason } as ManagerInventoryCommandRequest;
    try {
      const result =
        await services.sandboxDatabase.executeManagerInventoryCommand({
          ...request,
          contextVersion: auth.session.contextVersion,
          idempotencyKey,
          personaId: auth.session.personaId,
          requestId,
          role: "manager",
          sandboxId: auth.session.sandboxId,
        });
      return context.json({
        ...result,
        businessOccurredAt: result.businessOccurredAt.toISOString(),
      } satisfies ManagerInventoryCommandResponse);
    } catch (error) {
      const mapped = failure(error, requestId);
      return context.json(mapped.body, mapped.status);
    }
  });
}
