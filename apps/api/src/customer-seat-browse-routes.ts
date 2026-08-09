import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  CUSTOMER_MACHINE_PROFILE_CODES,
  type CustomerMachineProfileCode,
  type CustomerSeatAvailabilityResponse,
  type CustomerStoreCatalogResponse,
} from "@jingshu/contracts";
import {
  type CustomerSeatBrowseValidationError,
  type CustomerSeatBrowseValidationReason,
} from "@jingshu/database";

import { readRoleSession } from "./role-session.js";
import {
  SESSION_COOKIE,
  errorBody,
  isRoleContextStale,
  isRoleContextUnavailable,
  recordRoleContextDenial,
  type AppServices,
} from "./route-support.js";

const machineProfileCodes = new Set<CustomerMachineProfileCode>(
  CUSTOMER_MACHINE_PROFILE_CODES,
);
const safeCodePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

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
      body: errorBody(
        "ROLE_CONTEXT_UNAVAILABLE",
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

export function registerCustomerSeatBrowseRoutes(
  app: Hono,
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
          immediateUsesCurrentSegment: true,
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
}
