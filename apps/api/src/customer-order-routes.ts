import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import type {
  CancelCustomerOrderRequest,
  CreateCustomerPendingOrderRequest,
  CustomerOrderCancellationResponse,
  CustomerOrderCatalogResponse,
  CustomerOrderDetailResponse,
  CustomerOrderPaymentResponse,
  CustomerPendingOrderResponse,
} from "@jingshu/contracts";
import type {
  CustomerOrderConflictError,
  CustomerOrderConflictReason,
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

function containsUnsafeCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

function customerOrderConflict(
  error: unknown,
): error is CustomerOrderConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "CUSTOMER_ORDER_CONFLICT" &&
    "reason" in error &&
    typeof error.reason === "string"
  );
}

function orderFailure(error: unknown, requestId: string) {
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
        "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
        requestId,
      ),
      status: 401 as const,
    };
  }
  if (customerOrderConflict(error)) {
    const failures: Record<
      CustomerOrderConflictReason,
      { code: string; message: string; status: 400 | 404 | 409 }
    > = {
      "coupon-ineligible": {
        code: "CUSTOMER_ORDER_COUPON_INELIGIBLE",
        message: "所选商品体验券不符合本单门店、时段或最低金额条件。",
        status: 409,
      },
      "coupon-not-found": {
        code: "CUSTOMER_ORDER_COUPON_NOT_FOUND",
        message: "所选商品体验券已不存在，请重新选择。",
        status: 404,
      },
      "coupon-unavailable": {
        code: "CUSTOMER_ORDER_COUPON_UNAVAILABLE",
        message: "所选商品体验券已被占用或失效，请重新选择。",
        status: 409,
      },
      "empty-cart": {
        code: "CUSTOMER_ORDER_EMPTY_CART",
        message: "购物车为空，请先选择商品。",
        status: 400,
      },
      "hold-expired": {
        code: "CUSTOMER_ORDER_HOLD_EXPIRED",
        message: "订单库存保留已到期，未产生扣款；请返回购物车重新提交。",
        status: 409,
      },
      "idempotency-conflict": {
        code: "CUSTOMER_ORDER_IDEMPOTENCY_CONFLICT",
        message: "本次提交标识已用于其他订单内容，请返回确认页重试。",
        status: 409,
      },
      "illegal-transition": {
        code: "CUSTOMER_ORDER_ILLEGAL_TRANSITION",
        message: "当前订单状态不允许执行此操作，请刷新订单详情。",
        status: 409,
      },
      "insufficient-inventory": {
        code: "CUSTOMER_ORDER_INSUFFICIENT_INVENTORY",
        message: "整单库存不足，订单未创建；购物车内容已保留，请调整数量。",
        status: 409,
      },
      "invalid-quantity": {
        code: "CUSTOMER_ORDER_QUANTITY_INVALID",
        message: "商品数量必须是正整数，且同一商品只能出现一次。",
        status: 400,
      },
      "not-found": {
        code: "CUSTOMER_ORDER_NOT_FOUND",
        message: "未找到属于当前顾客的商品订单。",
        status: 404,
      },
      "product-not-listed": {
        code: "CUSTOMER_ORDER_PRODUCT_NOT_LISTED",
        message: "购物车包含当前门店未上架商品，请刷新商品目录。",
        status: 409,
      },
      "reservation-ineligible": {
        code: "CUSTOMER_ORDER_RESERVATION_INELIGIBLE",
        message: "只有当前门店已到店或使用中的预约可以购买柜台商品。",
        status: 409,
      },
    };
    const failure = failures[error.reason];
    return {
      body: {
        error: {
          ...errorBody(failure.code, failure.message, requestId).error,
          ...(error.currentStatus
            ? { currentStatus: error.currentStatus }
            : {}),
        },
      },
      status: failure.status,
    };
  }
  return {
    body: errorBody(
      "CUSTOMER_ORDER_SERVICE_UNAVAILABLE",
      "商品订单暂时无法处理，未显示未经确认的成功结果；请稍后安全重试。",
      requestId,
    ),
    status: 503 as const,
  };
}

async function customerSession(
  context: Context,
  services: AppServices,
  requestId: string,
) {
  const session = services.sessionSecret
    ? readRoleSession(
        getCookie(context, SESSION_COOKIE),
        services.sessionSecret,
      )
    : null;
  if (!session) {
    return {
      response: context.json(
        errorBody(
          "ROLE_CONTEXT_REQUIRED",
          "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId,
        ),
        401,
      ),
      session: null,
    };
  }
  if (session.role !== "customer") {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "capability_denied",
    );
    return {
      response: context.json(
        errorBody(
          "CUSTOMER_ROLE_REQUIRED",
          "请切换到顾客角色后处理自己的商品订单。",
          requestId,
        ),
        403,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

async function customerWriteFence(
  context: Context,
  services: AppServices,
  requestId: string,
  session: NonNullable<Awaited<ReturnType<typeof customerSession>>["session"]>,
) {
  const origin = context.req.header("Origin");
  if (!origin || !services.allowedOrigins.has(origin)) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "invalid_origin",
    );
    return {
      idempotencyKey: null,
      response: context.json(
        errorBody(
          "INVALID_REQUEST_ORIGIN",
          "请求来源无法验证，订单、库存和体验券均未变更。",
          requestId,
        ),
        403,
      ),
    };
  }
  if (!csrfTokensMatch(session.csrfToken, context.req.header("X-CSRF-Token"))) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "csrf_context_mismatch",
    );
    return {
      idempotencyKey: null,
      response: context.json(
        errorBody(
          "ROLE_CONTEXT_STALE",
          "当前标签的写入上下文已失效，请刷新后重试。",
          requestId,
        ),
        409,
      ),
    };
  }
  const idempotencyKey = context.req.header("Idempotency-Key");
  if (!idempotencyKey || !UUID_V4_PATTERN.test(idempotencyKey)) {
    return {
      idempotencyKey: null,
      response: context.json(
        errorBody(
          "INVALID_IDEMPOTENCY_KEY",
          "订单提交标识已失效，请返回确认页重新提交。",
          requestId,
        ),
        400,
      ),
    };
  }
  return { idempotencyKey, response: null };
}

export function registerCustomerOrderRoutes(app: Hono, services: AppServices) {
  app.get(
    "/api/v1/customer/reservations/:reservationId/products",
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (!services.sandboxDatabase || !services.sessionSecret) {
        return context.json(orderFailure(null, requestId).body, 503);
      }
      const auth = await customerSession(context, services, requestId);
      if (!auth.session) return auth.response;
      const reservationId = context.req.param("reservationId");
      if (!UUID_V4_PATTERN.test(reservationId)) {
        return context.json(
          errorBody(
            "CUSTOMER_RESERVATION_ID_INVALID",
            "预约标识无效，请返回行程重新进入。",
            requestId,
          ),
          400,
        );
      }
      try {
        const catalog = await services.sandboxDatabase.readCustomerOrderCatalog(
          {
            contextVersion: auth.session.contextVersion,
            personaId: auth.session.personaId,
            reservationId,
            role: auth.session.role,
            sandboxId: auth.session.sandboxId,
          },
        );
        return context.json({
          status: "ready",
          coupons: catalog.coupons.map((coupon) => ({
            ...coupon,
            validUntil: coupon.validUntil.toISOString(),
          })),
          currentTime: catalog.currentTime.toISOString(),
          products: catalog.products,
          reservation: catalog.reservation,
        } satisfies CustomerOrderCatalogResponse);
      } catch (error) {
        const failure = orderFailure(error, requestId);
        return context.json(failure.body, failure.status);
      }
    },
  );

  app.post("/api/v1/customer/orders", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(orderFailure(null, requestId).body, 503);
    }
    const auth = await customerSession(context, services, requestId);
    if (!auth.session) return auth.response;
    const fence = await customerWriteFence(
      context,
      services,
      requestId,
      auth.session,
    );
    if (fence.response) return fence.response;
    const idempotencyKey = fence.idempotencyKey;
    if (!idempotencyKey) {
      return context.json(orderFailure(null, requestId).body, 503);
    }
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    const allowed = new Set(["couponId", "lines", "reservationId"]);
    if (
      !body ||
      Object.keys(body).some((key) => !allowed.has(key)) ||
      !UUID_V4_PATTERN.test(String(body.reservationId ?? "")) ||
      !(
        body.couponId === null ||
        (typeof body.couponId === "string" &&
          UUID_V4_PATTERN.test(body.couponId))
      ) ||
      !Array.isArray(body.lines) ||
      body.lines.length < 1 ||
      body.lines.length > 20 ||
      body.lines.some(
        (line) =>
          !isPlainRecord(line) ||
          Object.keys(line).some(
            (key) => key !== "productId" && key !== "quantity",
          ) ||
          !UUID_V4_PATTERN.test(String(line.productId ?? "")) ||
          !Number.isInteger(line.quantity) ||
          Number(line.quantity) < 1 ||
          Number(line.quantity) > 99,
      ) ||
      new Set(
        body.lines.map((line) =>
          isPlainRecord(line) ? String(line.productId) : "",
        ),
      ).size !== body.lines.length
    ) {
      return context.json(
        errorBody(
          "CUSTOMER_ORDER_REQUEST_INVALID",
          "订单确认内容不完整，请返回购物车重新确认。",
          requestId,
        ),
        400,
      );
    }
    try {
      const request = body as unknown as CreateCustomerPendingOrderRequest;
      const result = await services.sandboxDatabase.createCustomerPendingOrder({
        contextVersion: auth.session.contextVersion,
        couponId: request.couponId,
        idempotencyKey,
        lines: request.lines,
        personaId: auth.session.personaId,
        requestId,
        reservationId: request.reservationId,
        role: auth.session.role,
        sandboxId: auth.session.sandboxId,
      });
      return context.json(
        {
          holdExpiresAt: result.holdExpiresAt.toISOString(),
          orderId: result.orderId,
          replayed: result.replayed,
          snapshot: result.snapshot,
          status: result.status,
        } satisfies CustomerPendingOrderResponse,
        result.replayed ? 200 : 201,
      );
    } catch (error) {
      const failure = orderFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.get("/api/v1/customer/orders/:orderId", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(orderFailure(null, requestId).body, 503);
    }
    const auth = await customerSession(context, services, requestId);
    if (!auth.session) return auth.response;
    const orderId = context.req.param("orderId");
    if (!UUID_V4_PATTERN.test(orderId)) {
      return context.json(
        errorBody(
          "CUSTOMER_ORDER_ID_INVALID",
          "订单标识无效，请返回行程重新进入。",
          requestId,
        ),
        400,
      );
    }
    try {
      const detail = await services.sandboxDatabase.readCustomerOrderDetail({
        contextVersion: auth.session.contextVersion,
        orderId,
        personaId: auth.session.personaId,
        role: auth.session.role,
        sandboxId: auth.session.sandboxId,
      });
      return context.json({
        actions: detail.actions,
        cancelledAt: detail.cancelledAt?.toISOString() ?? null,
        coupon: detail.coupon,
        currentTime: detail.currentTime.toISOString(),
        expiredAt: detail.expiredAt?.toISOString() ?? null,
        holdExpiresAt: detail.holdExpiresAt.toISOString(),
        inventory: detail.inventory,
        orderId: detail.orderId,
        payment: detail.payment
          ? {
              ...detail.payment,
              occurredAt: detail.payment.occurredAt.toISOString(),
            }
          : null,
        snapshot: detail.snapshot,
        status: detail.status,
        terminalReason: detail.terminalReason,
        timeline: detail.events.map((event) => ({
          ...event,
          occurredAt: event.occurredAt.toISOString(),
        })),
      } satisfies CustomerOrderDetailResponse);
    } catch (error) {
      const failure = orderFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post(
    "/api/v1/customer/orders/:orderId/simulated-payment",
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (!services.sandboxDatabase || !services.sessionSecret) {
        return context.json(orderFailure(null, requestId).body, 503);
      }
      const auth = await customerSession(context, services, requestId);
      if (!auth.session) return auth.response;
      const fence = await customerWriteFence(
        context,
        services,
        requestId,
        auth.session,
      );
      if (fence.response) return fence.response;
      const idempotencyKey = fence.idempotencyKey;
      if (!idempotencyKey) {
        return context.json(orderFailure(null, requestId).body, 503);
      }
      const orderId = context.req.param("orderId");
      const parsed: unknown = await context.req.json().catch(() => null);
      if (
        !UUID_V4_PATTERN.test(orderId) ||
        !isPlainRecord(parsed) ||
        Object.keys(parsed).length !== 0
      ) {
        return context.json(
          errorBody(
            "CUSTOMER_ORDER_PAYMENT_REQUEST_INVALID",
            "模拟支付确认内容无效，请返回订单详情重试。",
            requestId,
          ),
          400,
        );
      }
      try {
        const result =
          await services.sandboxDatabase.simulateCustomerOrderPayment({
            contextVersion: auth.session.contextVersion,
            idempotencyKey,
            orderId,
            personaId: auth.session.personaId,
            requestId,
            role: auth.session.role,
            sandboxId: auth.session.sandboxId,
          });
        return context.json({
          notice: "模拟支付，不会扣款，也不需要真实支付凭证。",
          orderId: result.orderId,
          payment: {
            ...result.payment,
            occurredAt: result.payment.occurredAt.toISOString(),
          },
          replayed: result.replayed,
          status: result.status,
        } satisfies CustomerOrderPaymentResponse);
      } catch (error) {
        const failure = orderFailure(error, requestId);
        return context.json(failure.body, failure.status);
      }
    },
  );

  app.post("/api/v1/customer/orders/:orderId/cancel", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(orderFailure(null, requestId).body, 503);
    }
    const auth = await customerSession(context, services, requestId);
    if (!auth.session) return auth.response;
    const fence = await customerWriteFence(
      context,
      services,
      requestId,
      auth.session,
    );
    if (fence.response) return fence.response;
    const idempotencyKey = fence.idempotencyKey;
    if (!idempotencyKey) {
      return context.json(orderFailure(null, requestId).body, 503);
    }
    const orderId = context.req.param("orderId");
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    if (
      !UUID_V4_PATTERN.test(orderId) ||
      !body ||
      Object.keys(body).some((key) => key !== "reason") ||
      typeof body.reason !== "string" ||
      body.reason.trim().length < 1 ||
      body.reason.trim().length > 200 ||
      containsUnsafeCharacter(body.reason)
    ) {
      return context.json(
        errorBody(
          "CUSTOMER_ORDER_CANCEL_REQUEST_INVALID",
          "请填写 1–200 字的安全取消原因。",
          requestId,
        ),
        400,
      );
    }
    try {
      const request = body as unknown as CancelCustomerOrderRequest;
      const result = await services.sandboxDatabase.cancelCustomerOrder({
        contextVersion: auth.session.contextVersion,
        idempotencyKey,
        orderId,
        personaId: auth.session.personaId,
        reason: request.reason.trim(),
        requestId,
        role: auth.session.role,
        sandboxId: auth.session.sandboxId,
      });
      return context.json({
        cancelledAt: result.cancelledAt.toISOString(),
        couponRestored: result.couponRestored,
        orderId: result.orderId,
        replayed: result.replayed,
        status: result.status,
      } satisfies CustomerOrderCancellationResponse);
    } catch (error) {
      const failure = orderFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });
}
