import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  CUSTOMER_MACHINE_PROFILE_CODES,
  type CancelCustomerReservationRequest,
  type CreateCustomerPendingReservationRequest,
  type CustomerMachineProfileCode,
  type CustomerPendingReservationResponse,
  type CustomerReservationCancellationResponse,
  type CustomerReservationDetailResponse,
  type CustomerReservationPaymentResponse,
  type CustomerSeatAvailabilityResponse,
  type CustomerStoreCatalogResponse,
} from "@jingshu/contracts";
import type {
  CustomerReservationCreateConflictError,
  CustomerReservationLifecycleConflictError,
  CustomerReservationLifecycleConflictReason,
  CustomerSeatBrowseValidationError,
  CustomerSeatBrowseValidationReason,
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

const machineProfileCodes = new Set<CustomerMachineProfileCode>(
  CUSTOMER_MACHINE_PROFILE_CODES,
);
const safeCodePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const safeSeatCodePattern = /^[A-Z]-\d{2}$/u;

function containsUnsafeReasonCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || code === 127;
  });
}

const validationErrors: Record<
  CustomerSeatBrowseValidationReason,
  { code: string; message: string }
> = {
  "area-not-found": {
    code: "CUSTOMER_AREA_NOT_FOUND",
    message: "所选区域不在当前门店，请重新选择区域。",
  },
  duration: {
    code: "CUSTOMER_BOOKING_DURATION_INVALID",
    message: "使用时长必须是 1–8 小时的整数。",
  },
  "future-start": {
    code: "CUSTOMER_BOOKING_FUTURE_START_REQUIRED",
    message: "未来预约必须选择当前时间之后的半小时片段。",
  },
  "half-hour-alignment": {
    code: "CUSTOMER_BOOKING_HALF_HOUR_ALIGNMENT",
    message: "预约开始时间必须按半小时对齐。",
  },
  "machine-profile-not-found": {
    code: "CUSTOMER_MACHINE_PROFILE_NOT_FOUND",
    message: "所选机型档案不存在，请重新选择。",
  },
  "outside-business-hours": {
    code: "CUSTOMER_BOOKING_OUTSIDE_BUSINESS_HOURS",
    message: "所选连续时段超出该门店营业时间，请调整开始时间或时长。",
  },
  "price-plan-not-found": {
    code: "CUSTOMER_PRICE_PLAN_NOT_FOUND",
    message: "所选条件暂时没有有效价格计划，请更换区域或机型。",
  },
  "seven-day-window": {
    code: "CUSTOMER_BOOKING_SEVEN_DAY_WINDOW",
    message: "只能选择未来七天内的预约开始时间。",
  },
  "store-not-found": {
    code: "CUSTOMER_STORE_NOT_FOUND",
    message: "所选门店不存在，请返回三店列表重新选择。",
  },
};

function isCustomerSeatBrowseValidationError(
  error: unknown,
): error is CustomerSeatBrowseValidationError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "CUSTOMER_SEAT_BROWSE_INVALID" &&
    "reason" in error &&
    typeof error.reason === "string" &&
    error.reason in validationErrors
  );
}

function customerContextError(
  error: unknown,
  requestId: string,
): { body: ReturnType<typeof errorBody>; status: 401 | 409 | 422 | 503 } {
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
  if (isCustomerSeatBrowseValidationError(error)) {
    const validation = validationErrors[error.reason];
    return {
      body: errorBody(validation.code, validation.message, requestId),
      status: 422,
    };
  }
  return {
    body: errorBody(
      "CUSTOMER_BROWSE_SERVICE_UNAVAILABLE",
      "门店和座位信息暂时无法读取，请稍后安全重试。",
      requestId,
    ),
    status: 503,
  };
}

function isCustomerReservationLifecycleConflictError(
  error: unknown,
): error is CustomerReservationLifecycleConflictError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "CUSTOMER_RESERVATION_LIFECYCLE_CONFLICT" &&
    "reason" in error &&
    typeof error.reason === "string"
  );
}

function lifecycleConflictResponse(
  error: CustomerReservationLifecycleConflictError,
  requestId: string,
) {
  const failures: Record<
    CustomerReservationLifecycleConflictReason,
    { code: string; message: string; status: 404 | 409 }
  > = {
    "hold-expired": {
      code: "CUSTOMER_RESERVATION_HOLD_EXPIRED",
      message: "预约保留已到期，未产生扣款；请返回重新选座。",
      status: 409,
    },
    "illegal-transition": {
      code: "CUSTOMER_RESERVATION_ILLEGAL_TRANSITION",
      message: "当前预约状态不允许执行此操作，请刷新详情后继续。",
      status: 409,
    },
    "not-found": {
      code: "CUSTOMER_RESERVATION_NOT_FOUND",
      message: "未找到属于当前顾客的预约记录。",
      status: 404,
    },
    "reservation-started": {
      code: "CUSTOMER_RESERVATION_ALREADY_STARTED",
      message: "预约已到开始时间，不能再由顾客取消。",
      status: 409,
    },
  };
  const failure = failures[error.reason];
  return {
    body: {
      error: {
        ...errorBody(failure.code, failure.message, requestId).error,
        ...(error.currentStatus ? { currentStatus: error.currentStatus } : {}),
      },
    },
    status: failure.status,
  } as const;
}

function reservationSnapshotResponse(
  snapshot: Awaited<
    ReturnType<
      NonNullable<
        AppServices["sandboxDatabase"]
      >["readCustomerReservationDetail"]
    >
  >["snapshot"],
): CustomerPendingReservationResponse["snapshot"] {
  return {
    ...snapshot,
    price: {
      ...snapshot.price,
      segments: snapshot.price.segments.map((segment) => ({
        ...segment,
        endsAt: segment.endsAt.toISOString(),
        startsAt: segment.startsAt.toISOString(),
      })),
    },
    window: {
      endsAt: snapshot.window.endsAt.toISOString(),
      startsAt: snapshot.window.startsAt.toISOString(),
    },
  };
}

export function registerCustomerSeatBrowseRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  app.get("/api/v1/customer/stores", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "CUSTOMER_BROWSE_SERVICE_UNAVAILABLE",
          "门店和座位信息暂时无法读取，请稍后安全重试。",
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
    if (session.role !== "customer") {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "CUSTOMER_ROLE_REQUIRED",
          "请切换到顾客角色后浏览三店与座位。",
          requestId,
        ),
        403,
      );
    }

    try {
      const catalog = await services.sandboxDatabase.readCustomerStoreCatalog({
        contextVersion: session.contextVersion,
        personaId: session.personaId,
        role: session.role,
        sandboxId: session.sandboxId,
      });
      return context.json({
        status: "ready",
        bookingRules: {
          durationHours: { maximum: 8, minimum: 1 },
          futureDays: 7,
          halfHourAligned: true,
          immediateSelectsNearestArrivalEligibleSegment:
            catalog.immediateReservationWindowStrategy ===
            "nearest-arrival-eligible-segment",
        },
        city: catalog.city,
        currentTime: catalog.currentTime.toISOString(),
        stores: catalog.stores,
      } satisfies CustomerStoreCatalogResponse);
    } catch (error) {
      const failure = customerContextError(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.get("/api/v1/customer/seat-availability", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "CUSTOMER_BROWSE_SERVICE_UNAVAILABLE",
          "门店和座位信息暂时无法读取，请稍后安全重试。",
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
    if (session.role !== "customer") {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "CUSTOMER_ROLE_REQUIRED",
          "请切换到顾客角色后查询座位。",
          requestId,
        ),
        403,
      );
    }

    const storeCode = context.req.query("store");
    const areaCode = context.req.query("area");
    const machineProfileCode = context.req.query("machine");
    const mode = context.req.query("mode");
    const durationText = context.req.query("durationHours");
    const startText = context.req.query("start");
    const durationHours = Number(durationText);
    const requestedStartsAt = startText ? new Date(startText) : undefined;
    if (
      !storeCode ||
      !safeCodePattern.test(storeCode) ||
      !areaCode ||
      !safeCodePattern.test(areaCode) ||
      !machineProfileCode ||
      !machineProfileCodes.has(
        machineProfileCode as CustomerMachineProfileCode,
      ) ||
      (mode !== "immediate" && mode !== "future") ||
      !/^[1-8]$/u.test(durationText ?? "") ||
      !Number.isInteger(durationHours) ||
      (mode === "future" &&
        (!requestedStartsAt || Number.isNaN(requestedStartsAt.getTime()))) ||
      (mode === "immediate" && startText !== undefined)
    ) {
      return context.json(
        errorBody(
          "CUSTOMER_SEAT_QUERY_INVALID",
          "请选择有效的门店、区域、机型、预约方式和使用时长。",
          requestId,
        ),
        400,
      );
    }

    try {
      const availability =
        await services.sandboxDatabase.readCustomerSeatAvailability({
          areaCode,
          contextVersion: session.contextVersion,
          durationHours,
          machineProfileCode: machineProfileCode as CustomerMachineProfileCode,
          mode,
          personaId: session.personaId,
          ...(requestedStartsAt ? { requestedStartsAt } : {}),
          role: session.role,
          sandboxId: session.sandboxId,
          storeCode,
        });
      return context.json({
        status: "ready",
        area: availability.area,
        coupons: availability.coupons.map((coupon) => ({
          ...coupon,
          validUntil: coupon.validUntil.toISOString(),
        })),
        machineProfile: availability.machineProfile,
        price: {
          ...availability.price,
          segments: availability.price.segments.map((segment) => ({
            ...segment,
            endsAt: segment.endsAt.toISOString(),
            startsAt: segment.startsAt.toISOString(),
          })),
        },
        seats: availability.seats,
        store: availability.store,
        window: {
          ...availability.window,
          endsAt: availability.window.endsAt.toISOString(),
          startsAt: availability.window.startsAt.toISOString(),
        },
      } satisfies CustomerSeatAvailabilityResponse);
    } catch (error) {
      const failure = customerContextError(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.post("/api/v1/customer/reservations", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "CUSTOMER_RESERVATION_SERVICE_UNAVAILABLE",
          "预约保留暂时不可用，未创建预约也未占用体验券。",
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
    if (session.role !== "customer") {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "CUSTOMER_ROLE_REQUIRED",
          "请切换到顾客角色后创建自己的预约。",
          requestId,
        ),
        403,
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
          "请求来源无法验证，预约和体验券均未占用。",
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
          "预约提交标识已失效，请返回确认页重新提交。",
          requestId,
        ),
        400,
      );
    }
    const parsed: unknown = await context.req.json().catch(() => null);
    const body = isPlainRecord(parsed) ? parsed : null;
    const requestedStartsAt =
      typeof body?.requestedStartsAt === "string"
        ? new Date(body.requestedStartsAt)
        : undefined;
    const allowedKeys = new Set([
      "areaCode",
      "couponId",
      "durationHours",
      "machineProfileCode",
      "mode",
      "requestedStartsAt",
      "seatCode",
      "storeCode",
    ]);
    if (
      !body ||
      Object.keys(body).some((key) => !allowedKeys.has(key)) ||
      typeof body.areaCode !== "string" ||
      !safeCodePattern.test(body.areaCode) ||
      !(
        body.couponId === null ||
        (typeof body.couponId === "string" &&
          UUID_V4_PATTERN.test(body.couponId))
      ) ||
      !Number.isInteger(body.durationHours) ||
      Number(body.durationHours) < 1 ||
      Number(body.durationHours) > 8 ||
      typeof body.machineProfileCode !== "string" ||
      !machineProfileCodes.has(
        body.machineProfileCode as CustomerMachineProfileCode,
      ) ||
      (body.mode !== "immediate" && body.mode !== "future") ||
      typeof body.seatCode !== "string" ||
      !safeSeatCodePattern.test(body.seatCode) ||
      typeof body.storeCode !== "string" ||
      !safeCodePattern.test(body.storeCode) ||
      (body.mode === "future" &&
        (!requestedStartsAt || Number.isNaN(requestedStartsAt.getTime()))) ||
      (body.mode === "immediate" && body.requestedStartsAt !== undefined)
    ) {
      return context.json(
        errorBody(
          "CUSTOMER_RESERVATION_REQUEST_INVALID",
          "预约确认内容不完整，请返回选座后重新确认。",
          requestId,
        ),
        400,
      );
    }

    try {
      const request =
        body as unknown as CreateCustomerPendingReservationRequest;
      const result =
        await services.sandboxDatabase.createCustomerPendingReservation({
          areaCode: request.areaCode,
          contextVersion: session.contextVersion,
          couponId: request.couponId,
          durationHours: request.durationHours,
          idempotencyKey,
          machineProfileCode: request.machineProfileCode,
          mode: request.mode,
          personaId: session.personaId,
          requestId,
          ...(requestedStartsAt ? { requestedStartsAt } : {}),
          role: session.role,
          sandboxId: session.sandboxId,
          seatCode: request.seatCode,
          storeCode: request.storeCode,
        });
      const response = {
        holdExpiresAt: result.holdExpiresAt.toISOString(),
        replayed: result.replayed,
        reservationId: result.reservationId,
        snapshot: {
          ...result.snapshot,
          price: {
            ...result.snapshot.price,
            segments: result.snapshot.price.segments.map((segment) => ({
              ...segment,
              endsAt: segment.endsAt.toISOString(),
              startsAt: segment.startsAt.toISOString(),
            })),
          },
          window: {
            endsAt: result.snapshot.window.endsAt.toISOString(),
            startsAt: result.snapshot.window.startsAt.toISOString(),
          },
        },
        status: result.status,
      } satisfies CustomerPendingReservationResponse;
      return context.json(response, result.replayed ? 200 : 201);
    } catch (error) {
      const contextFailure = customerContextError(error, requestId);
      if (contextFailure.status !== 503) {
        return context.json(contextFailure.body, contextFailure.status);
      }
      const createConflict =
        error as Partial<CustomerReservationCreateConflictError>;
      if (createConflict.code === "CUSTOMER_RESERVATION_CREATE_CONFLICT") {
        const messages = {
          "coupon-ineligible":
            "所选体验券不符合当前门店、时段、金额或有效期条件。",
          "coupon-not-found": "所选体验券已不存在，请重新选择。",
          "coupon-unavailable": "所选体验券已被占用或失效，请重新选择。",
          "customer-conflict": "你在该时段已有另一条有效预约，请调整时段。",
          "seat-conflict": "该座位刚刚被其他预约占用，请返回重新选座。",
          "seat-maintenance": "该座位当前处于维护状态，请返回重新选座。",
          "seat-not-found": "该座位已不属于当前区域或机型，请返回重新选座。",
        } as const;
        return context.json(
          errorBody(
            `CUSTOMER_RESERVATION_${String(createConflict.reason ?? "conflict")
              .toUpperCase()
              .replaceAll("-", "_")}`,
            messages[createConflict.reason as keyof typeof messages] ??
              "当前预约条件已变化，请返回重新选座。",
            requestId,
          ),
          409,
        );
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "CUSTOMER_RESERVATION_IDEMPOTENCY_CONFLICT"
      ) {
        return context.json(
          errorBody(
            "CUSTOMER_RESERVATION_IDEMPOTENCY_CONFLICT",
            "该提交标识已用于另一组预约内容，请返回确认页重新提交。",
            requestId,
          ),
          409,
        );
      }
      return context.json(
        errorBody(
          "CUSTOMER_RESERVATION_CREATE_FAILED",
          "预约保留未能完整创建；没有留下部分预约或体验券占用，可安全重试。",
          requestId,
        ),
        503,
      );
    }
  });

  app.get("/api/v1/customer/reservations/:reservationId", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "CUSTOMER_RESERVATION_SERVICE_UNAVAILABLE",
          "预约详情暂时无法读取，请稍后安全重试。",
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
    if (session.role !== "customer") {
      await recordRoleContextDenial(
        services,
        session,
        requestId,
        "capability_denied",
      );
      return context.json(
        errorBody(
          "CUSTOMER_ROLE_REQUIRED",
          "请切换到顾客角色后查看自己的预约。",
          requestId,
        ),
        403,
      );
    }
    const reservationId = context.req.param("reservationId");
    if (!UUID_V4_PATTERN.test(reservationId)) {
      return context.json(
        errorBody(
          "CUSTOMER_RESERVATION_ID_INVALID",
          "预约标识无效，请返回预约记录重新进入。",
          requestId,
        ),
        400,
      );
    }

    try {
      const detail =
        await services.sandboxDatabase.readCustomerReservationDetail({
          contextVersion: session.contextVersion,
          personaId: session.personaId,
          reservationId,
          role: session.role,
          sandboxId: session.sandboxId,
        });
      return context.json({
        actions: detail.actions,
        arrivalWindow: {
          closesAt: detail.arrivalWindow.closesAt.toISOString(),
          opensAt: detail.arrivalWindow.opensAt.toISOString(),
        },
        cancelledAt: detail.cancelledAt?.toISOString() ?? null,
        confirmedAt: detail.confirmedAt?.toISOString() ?? null,
        coupon: detail.coupon,
        currentTime: detail.currentTime.toISOString(),
        expiredAt: detail.expiredAt?.toISOString() ?? null,
        holdExpiresAt: detail.holdExpiresAt?.toISOString() ?? null,
        payment: detail.payment
          ? {
              ...detail.payment,
              occurredAt: detail.payment.occurredAt.toISOString(),
            }
          : null,
        refund: detail.refund
          ? {
              ...detail.refund,
              occurredAt: detail.refund.occurredAt.toISOString(),
            }
          : null,
        related: detail.related,
        reservationId: detail.reservationId,
        snapshot: reservationSnapshotResponse(detail.snapshot),
        status: detail.status,
        terminalReason: detail.terminalReason,
        timeline: detail.events.map((event) => ({
          ...event,
          occurredAt: event.occurredAt.toISOString(),
        })),
      } satisfies CustomerReservationDetailResponse);
    } catch (error) {
      const contextFailure = customerContextError(error, requestId);
      if (contextFailure.status !== 503) {
        return context.json(contextFailure.body, contextFailure.status);
      }
      if (isCustomerReservationLifecycleConflictError(error)) {
        const failure = lifecycleConflictResponse(error, requestId);
        return context.json(failure.body, failure.status);
      }
      return context.json(
        errorBody(
          "CUSTOMER_RESERVATION_READ_FAILED",
          "预约详情暂时无法读取，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
  });

  app.post(
    "/api/v1/customer/reservations/:reservationId/simulated-payment",
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (!services.sandboxDatabase || !services.sessionSecret) {
        return context.json(
          errorBody(
            "CUSTOMER_RESERVATION_PAYMENT_UNAVAILABLE",
            "模拟支付暂时不可用；不会扣款，也没有留下部分状态。",
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
      if (session.role !== "customer") {
        await recordRoleContextDenial(
          services,
          session,
          requestId,
          "capability_denied",
        );
        return context.json(
          errorBody(
            "CUSTOMER_ROLE_REQUIRED",
            "请切换到顾客角色后确认自己的预约。",
            requestId,
          ),
          403,
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
            "请求来源无法验证；不会扣款，也不会改变预约。",
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
      const reservationId = context.req.param("reservationId");
      const idempotencyKey = context.req.header("Idempotency-Key");
      if (
        !UUID_V4_PATTERN.test(reservationId) ||
        !idempotencyKey ||
        !UUID_V4_PATTERN.test(idempotencyKey)
      ) {
        return context.json(
          errorBody(
            "CUSTOMER_RESERVATION_PAYMENT_REQUEST_INVALID",
            "模拟支付请求已失效，请刷新预约详情后重试。",
            requestId,
          ),
          400,
        );
      }
      const rawBody = await context.req.text();
      if (rawBody.trim() !== "" && rawBody.trim() !== "{}") {
        return context.json(
          errorBody(
            "CUSTOMER_RESERVATION_PAYMENT_REQUEST_INVALID",
            "模拟支付不接收支付凭证、账号或其他真实支付资料。",
            requestId,
          ),
          400,
        );
      }

      try {
        const result =
          await services.sandboxDatabase.simulateCustomerReservationPayment({
            contextVersion: session.contextVersion,
            idempotencyKey,
            personaId: session.personaId,
            requestId,
            reservationId,
            role: session.role,
            sandboxId: session.sandboxId,
          });
        return context.json({
          notice: "模拟支付，不会扣款，也不需要真实支付凭证。",
          payment: {
            ...result.payment,
            occurredAt: result.payment.occurredAt.toISOString(),
          },
          replayed: result.replayed,
          reservationId: result.reservationId,
          status: result.status,
        } satisfies CustomerReservationPaymentResponse);
      } catch (error) {
        const contextFailure = customerContextError(error, requestId);
        if (contextFailure.status !== 503) {
          return context.json(contextFailure.body, contextFailure.status);
        }
        if (isCustomerReservationLifecycleConflictError(error)) {
          const failure = lifecycleConflictResponse(error, requestId);
          return context.json(failure.body, failure.status);
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "CUSTOMER_RESERVATION_IDEMPOTENCY_CONFLICT"
        ) {
          return context.json(
            errorBody(
              "CUSTOMER_RESERVATION_IDEMPOTENCY_CONFLICT",
              "该提交标识已用于另一条预约，请刷新详情后重新提交。",
              requestId,
            ),
            409,
          );
        }
        return context.json(
          errorBody(
            "CUSTOMER_RESERVATION_PAYMENT_FAILED",
            "模拟支付未能完整完成；不会扣款，可使用原提交标识安全重试。",
            requestId,
          ),
          503,
        );
      }
    },
  );

  app.post(
    "/api/v1/customer/reservations/:reservationId/cancel",
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (!services.sandboxDatabase || !services.sessionSecret) {
        return context.json(
          errorBody(
            "CUSTOMER_RESERVATION_CANCEL_UNAVAILABLE",
            "取消预约暂时不可用，没有留下部分退款或券状态。",
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
      if (session.role !== "customer") {
        await recordRoleContextDenial(
          services,
          session,
          requestId,
          "capability_denied",
        );
        return context.json(
          errorBody(
            "CUSTOMER_ROLE_REQUIRED",
            "请切换到顾客角色后取消自己的预约。",
            requestId,
          ),
          403,
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
            "请求来源无法验证，预约、退款和体验券均未改变。",
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
      const reservationId = context.req.param("reservationId");
      const idempotencyKey = context.req.header("Idempotency-Key");
      const parsed: unknown = await context.req.json().catch(() => null);
      const body = isPlainRecord(parsed) ? parsed : null;
      const allowedKeys = new Set(["reason"]);
      const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
      if (
        !UUID_V4_PATTERN.test(reservationId) ||
        !idempotencyKey ||
        !UUID_V4_PATTERN.test(idempotencyKey) ||
        !body ||
        Object.keys(body).some((key) => !allowedKeys.has(key)) ||
        reason.length === 0 ||
        reason.length > 200 ||
        containsUnsafeReasonCharacter(reason)
      ) {
        return context.json(
          errorBody(
            "CUSTOMER_RESERVATION_CANCEL_REQUEST_INVALID",
            "请填写 1–200 字且不含控制字符的取消原因。",
            requestId,
          ),
          400,
        );
      }

      try {
        const request = body as unknown as CancelCustomerReservationRequest;
        const result = await services.sandboxDatabase.cancelCustomerReservation(
          {
            contextVersion: session.contextVersion,
            idempotencyKey,
            personaId: session.personaId,
            reason: request.reason.trim(),
            requestId,
            reservationId,
            role: session.role,
            sandboxId: session.sandboxId,
          },
        );
        return context.json({
          cancelledAt: result.cancelledAt.toISOString(),
          couponRestored: result.couponRestored,
          refund: result.refund
            ? {
                ...result.refund,
                occurredAt: result.refund.occurredAt.toISOString(),
              }
            : null,
          replayed: result.replayed,
          reservationId: result.reservationId,
          status: result.status,
        } satisfies CustomerReservationCancellationResponse);
      } catch (error) {
        const contextFailure = customerContextError(error, requestId);
        if (contextFailure.status !== 503) {
          return context.json(contextFailure.body, contextFailure.status);
        }
        if (isCustomerReservationLifecycleConflictError(error)) {
          const failure = lifecycleConflictResponse(error, requestId);
          return context.json(failure.body, failure.status);
        }
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "CUSTOMER_RESERVATION_IDEMPOTENCY_CONFLICT"
        ) {
          return context.json(
            errorBody(
              "CUSTOMER_RESERVATION_IDEMPOTENCY_CONFLICT",
              "该取消标识已用于另一组内容，请刷新详情后重新提交。",
              requestId,
            ),
            409,
          );
        }
        return context.json(
          errorBody(
            "CUSTOMER_RESERVATION_CANCEL_FAILED",
            "取消未能完整完成；没有留下部分退款或券状态，可使用原提交标识安全重试。",
            requestId,
          ),
          503,
        );
      }
    },
  );
}
