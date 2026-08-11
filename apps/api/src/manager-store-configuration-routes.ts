import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import type {
  ManagerPricePlanOverlapPreviewRequest,
  ManagerPricePlanOverlapPreviewResponse,
  ManagerStoreConfigurationCommandRequest,
  ManagerStoreConfigurationCommandResponse,
  ManagerStoreConfigurationResponse,
} from "@jingshu/contracts";
import type { ManagerStoreConfigurationConflictReason } from "@jingshu/database";
import {
  pricePlanClockRangesOverlap,
  pricePlanEffectiveRangesOverlap,
} from "@jingshu/domain";

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

function failure(error: unknown, requestId: string) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "MANAGER_STORE_CONFIGURATION_CONFLICT" &&
    "reason" in error
  ) {
    const reason = error.reason as ManagerStoreConfigurationConflictReason;
    const mapping: Record<
      ManagerStoreConfigurationConflictReason,
      { code: string; message: string; status: 404 | 409 | 422 }
    > = {
      "area-has-active-seats": {
        code: "STORE_AREA_ACTIVE_SEATS",
        message: "请先停用该区域内的全部有效座位，再归档区域。",
        status: 409,
      },
      "area-lifecycle-transition": {
        code: "STORE_AREA_LIFECYCLE_TRANSITION",
        message: "区域生命周期只能从草稿变为有效，再从有效变为归档。",
        status: 409,
      },
      "area-not-deletable": {
        code: "STORE_AREA_NOT_DELETABLE",
        message: "只有未被引用且不含座位的草稿区域可以删除。",
        status: 409,
      },
      "area-not-found": {
        code: "STORE_CONFIGURATION_NOT_FOUND",
        message: "没有找到当前门店可维护的配置对象。",
        status: 404,
      },
      "cross-store": {
        code: "STORE_CONFIGURATION_NOT_FOUND",
        message: "没有找到当前门店可维护的配置对象。",
        status: 404,
      },
      "duplicate-area-code": {
        code: "STORE_AREA_CODE_CONFLICT",
        message: "区域代码已存在，请使用另一个门店内代码。",
        status: 409,
      },
      "duplicate-seat-code": {
        code: "STORE_SEAT_CODE_CONFLICT",
        message: "座位编号在当前门店内必须唯一。",
        status: 409,
      },
      "idempotency-conflict": {
        code: "STORE_CONFIGURATION_IDEMPOTENCY_CONFLICT",
        message: "原提交标识已用于另一项配置，请刷新后重新提交。",
        status: 409,
      },
      "invalid-area": {
        code: "STORE_AREA_INVALID",
        message: "区域资料格式无效，请检查名称、代码和排序。",
        status: 422,
      },
      "invalid-business-hours": {
        code: "STORE_BUSINESS_HOURS_INVALID",
        message: "营业规则必须使用有效时间并从未来业务时间开始生效。",
        status: 422,
      },
      "invalid-profile": {
        code: "STORE_PROFILE_INVALID",
        message: "门店资料格式无效，虚构城市必须明确标注为虚构。",
        status: 422,
      },
      "invalid-price-plan": {
        code: "STORE_PRICE_PLAN_INVALID",
        message: "价格版本必须使用未来半小时时点、有效时段和整数分金额。",
        status: 422,
      },
      "invalid-seat": {
        code: "STORE_SEAT_INVALID",
        message: "座位资料格式无效，请检查编号和排序。",
        status: 422,
      },
      "invalid-store-product": {
        code: "STORE_PRODUCT_INVALID",
        message: "门店售价和低库存阈值必须使用非负整数。",
        status: 422,
      },
      "machine-profile-not-found": {
        code: "STORE_CONFIGURATION_NOT_FOUND",
        message: "没有找到当前沙箱可用的总部机型档案。",
        status: 404,
      },
      "price-plan-not-archivable": {
        code: "STORE_PRICE_PLAN_NOT_ARCHIVABLE",
        message: "当前生效的价格版本不能直接归档，请先创建未来接续版本。",
        status: 409,
      },
      "price-plan-not-found": {
        code: "STORE_CONFIGURATION_NOT_FOUND",
        message: "没有找到当前门店可维护的价格版本。",
        status: 404,
      },
      "price-plan-overlap": {
        code: "STORE_PRICE_PLAN_OVERLAP",
        message: "相同适用范围已经存在重叠的生效版本，请调整生效时间。",
        status: 409,
      },
      "referenced-area-immutable": {
        code: "STORE_AREA_REFERENCED",
        message: "该区域已经被业务引用，只能在清空有效座位后归档。",
        status: 409,
      },
      "referenced-seat-immutable": {
        code: "STORE_SEAT_REFERENCED",
        message: "该座位已经被业务引用，只能保留原资料并停用。",
        status: 409,
      },
      "seat-dependencies": {
        code: "STORE_SEAT_DEPENDENCIES",
        message: "请先处理该座位的有效预约和未关闭报修，再停用座位。",
        status: 409,
      },
      "seat-lifecycle-transition": {
        code: "STORE_SEAT_LIFECYCLE_TRANSITION",
        message: "座位生命周期只能从草稿变为有效，再从有效变为停用。",
        status: 409,
      },
      "seat-not-deletable": {
        code: "STORE_SEAT_NOT_DELETABLE",
        message: "只有未被业务引用的草稿座位可以删除。",
        status: 409,
      },
      "seat-not-found": {
        code: "STORE_CONFIGURATION_NOT_FOUND",
        message: "没有找到当前门店可维护的配置对象。",
        status: 404,
      },
      "store-product-archived": {
        code: "STORE_PRODUCT_ARCHIVED",
        message: "该门店商品配置已经归档，不能继续编辑。",
        status: 409,
      },
      "store-product-not-found": {
        code: "STORE_CONFIGURATION_NOT_FOUND",
        message: "没有找到当前门店可维护的商品配置。",
        status: 404,
      },
      "version-conflict": {
        code: "STORE_CONFIGURATION_VERSION_CONFLICT",
        message: "配置已被更新，请读取服务端最新版本后重新提交。",
        status: 409,
      },
    };
    const mapped = mapping[reason];
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
      body: errorBody(
        "ROLE_CONTEXT_UNAVAILABLE",
        "当前沙箱已失效，请重新开始演示。",
        requestId,
      ),
      status: 410 as const,
    };
  }
  return {
    body: errorBody(
      "STORE_CONFIGURATION_SERVICE_UNAVAILABLE",
      "门店配置服务暂不可用，当前页面不会伪造成功。",
      requestId,
    ),
    status: 503 as const,
  };
}

function configurationRole(context: Context): "hq" | "manager" {
  return context.req.path.startsWith("/api/v1/hq/") ? "hq" : "manager";
}

function headquartersStoreId(context: Context): string | null {
  if (configurationRole(context) !== "hq") return null;
  const storeId = context.req.query("storeId");
  return storeId && UUID_V4_PATTERN.test(storeId) ? storeId : null;
}

async function configurationSession(
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
  const requiredRole = configurationRole(context);
  if (session.role !== requiredRole) {
    await recordRoleContextDenial(
      services,
      session,
      requestId,
      "capability_denied",
    );
    return {
      response: context.json(
        errorBody(
          requiredRole === "hq"
            ? "STORE_CONFIGURATION_HEADQUARTERS_REQUIRED"
            : "STORE_CONFIGURATION_MANAGER_REQUIRED",
          requiredRole === "hq"
            ? "请切换到总部运营角色配置固定三店。"
            : "请切换到店长角色维护所属门店配置。",
          requestId,
        ),
        403,
      ),
      session: null,
    };
  }
  return { response: null, session };
}

const exactKeys = (
  body: Record<string, unknown>,
  keys: ReadonlyArray<string>,
) => Object.keys(body).toSorted().join("|") === [...keys].toSorted().join("|");
const stringValue = (value: unknown) => typeof value === "string";
const stringWithin = (value: unknown, maximum: number, minimum = 1) =>
  typeof value === "string" &&
  value.length >= minimum &&
  value.length <= maximum;
const integerValue = (value: unknown) => Number.isInteger(value);
const restrictedStoreActions = new Set([
  "create-store",
  "deactivate-store",
  "delete-store",
  "disable-store",
  "set-store-status",
  "update-store-lifecycle",
  "update-store-status",
]);

function parseCommand(
  body: unknown,
): ManagerStoreConfigurationCommandRequest | null {
  if (!isPlainRecord(body) || !stringValue(body.action)) return null;
  const base =
    stringValue(body.storeId) &&
    UUID_V4_PATTERN.test(body.storeId) &&
    integerValue(body.expectedVersion) &&
    Number(body.expectedVersion) > 0;
  if (!base) return null;
  switch (body.action) {
    case "update-store-profile":
      return exactKeys(body, [
        "action",
        "displayName",
        "expectedVersion",
        "fictitiousCity",
        "introduction",
        "storeId",
      ]) &&
        stringWithin(body.displayName, 60) &&
        stringWithin(body.fictitiousCity, 40) &&
        stringWithin(body.introduction, 500)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    case "schedule-business-hours": {
      const parsed = stringValue(body.effectiveFrom)
        ? new Date(body.effectiveFrom)
        : null;
      return exactKeys(body, [
        "action",
        "closesAt",
        "closesNextDay",
        "daySet",
        "effectiveFrom",
        "expectedVersion",
        "isOpen24Hours",
        "opensAt",
        "storeId",
      ]) &&
        stringValue(body.closesAt) &&
        typeof body.closesNextDay === "boolean" &&
        ["all", "weekdays", "weekends"].includes(String(body.daySet)) &&
        parsed !== null &&
        !Number.isNaN(parsed.getTime()) &&
        typeof body.isOpen24Hours === "boolean" &&
        stringValue(body.opensAt)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    }
    case "create-area":
      return exactKeys(body, [
        "action",
        "code",
        "displayName",
        "expectedVersion",
        "lifecycleStatus",
        "sortOrder",
        "storeId",
      ]) &&
        stringWithin(body.code, 40) &&
        stringWithin(body.displayName, 60) &&
        ["active", "draft"].includes(String(body.lifecycleStatus)) &&
        integerValue(body.sortOrder)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    case "update-area":
      return exactKeys(body, [
        "action",
        "areaId",
        "displayName",
        "expectedVersion",
        "lifecycleStatus",
        "sortOrder",
        "storeId",
      ]) &&
        stringValue(body.areaId) &&
        UUID_V4_PATTERN.test(body.areaId) &&
        stringWithin(body.displayName, 60) &&
        ["active", "archived", "draft"].includes(
          String(body.lifecycleStatus),
        ) &&
        integerValue(body.sortOrder)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    case "delete-area":
      return exactKeys(body, [
        "action",
        "areaId",
        "expectedVersion",
        "storeId",
      ]) &&
        stringValue(body.areaId) &&
        UUID_V4_PATTERN.test(body.areaId)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    case "delete-seat":
      return exactKeys(body, [
        "action",
        "expectedVersion",
        "seatId",
        "storeId",
      ]) &&
        stringValue(body.seatId) &&
        UUID_V4_PATTERN.test(body.seatId)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    case "create-seat":
      return exactKeys(body, [
        "action",
        "areaId",
        "code",
        "expectedVersion",
        "lifecycleStatus",
        "machineProfileId",
        "sortOrder",
        "storeId",
      ]) &&
        stringValue(body.areaId) &&
        UUID_V4_PATTERN.test(body.areaId) &&
        stringWithin(body.code, 20) &&
        ["active", "draft"].includes(String(body.lifecycleStatus)) &&
        stringValue(body.machineProfileId) &&
        UUID_V4_PATTERN.test(body.machineProfileId) &&
        integerValue(body.sortOrder)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    case "create-price-plan": {
      const parsed = stringValue(body.effectiveFrom)
        ? new Date(body.effectiveFrom)
        : null;
      return exactKeys(body, [
        "action",
        "areaId",
        "effectiveFrom",
        "endsAt",
        "endsNextDay",
        "expectedVersion",
        "machineProfileId",
        "startsAt",
        "storeId",
        "weekdayHalfHourCents",
        "weekendHalfHourCents",
      ]) &&
        stringValue(body.areaId) &&
        UUID_V4_PATTERN.test(body.areaId) &&
        parsed !== null &&
        !Number.isNaN(parsed.getTime()) &&
        stringValue(body.endsAt) &&
        typeof body.endsNextDay === "boolean" &&
        stringValue(body.machineProfileId) &&
        UUID_V4_PATTERN.test(body.machineProfileId) &&
        stringValue(body.startsAt) &&
        integerValue(body.weekdayHalfHourCents) &&
        integerValue(body.weekendHalfHourCents)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    }
    case "archive-price-plan":
      return exactKeys(body, [
        "action",
        "expectedVersion",
        "pricePlanId",
        "storeId",
      ]) &&
        stringValue(body.pricePlanId) &&
        UUID_V4_PATTERN.test(body.pricePlanId)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    case "update-store-product":
      return exactKeys(body, [
        "action",
        "expectedVersion",
        "listed",
        "lowStockThreshold",
        "storeId",
        "storeProductId",
        "unitPriceCents",
      ]) &&
        typeof body.listed === "boolean" &&
        integerValue(body.lowStockThreshold) &&
        stringValue(body.storeProductId) &&
        UUID_V4_PATTERN.test(body.storeProductId) &&
        integerValue(body.unitPriceCents)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    case "archive-store-product":
      return exactKeys(body, [
        "action",
        "expectedVersion",
        "storeId",
        "storeProductId",
      ]) &&
        stringValue(body.storeProductId) &&
        UUID_V4_PATTERN.test(body.storeProductId)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    case "update-seat":
      return exactKeys(body, [
        "action",
        "areaId",
        "code",
        "expectedVersion",
        "lifecycleStatus",
        "machineProfileId",
        "seatId",
        "sortOrder",
        "storeId",
      ]) &&
        stringValue(body.areaId) &&
        UUID_V4_PATTERN.test(body.areaId) &&
        stringWithin(body.code, 20) &&
        ["active", "draft", "inactive"].includes(
          String(body.lifecycleStatus),
        ) &&
        stringValue(body.machineProfileId) &&
        UUID_V4_PATTERN.test(body.machineProfileId) &&
        stringValue(body.seatId) &&
        UUID_V4_PATTERN.test(body.seatId) &&
        integerValue(body.sortOrder)
        ? (body as unknown as ManagerStoreConfigurationCommandRequest)
        : null;
    default:
      return null;
  }
}

function parsePricePlanOverlapPreview(
  body: unknown,
): ManagerPricePlanOverlapPreviewRequest | null {
  if (
    !isPlainRecord(body) ||
    !exactKeys(body, [
      "areaId",
      "effectiveFrom",
      "endsAt",
      "endsNextDay",
      "machineProfileId",
      "startsAt",
    ]) ||
    !stringValue(body.areaId) ||
    !UUID_V4_PATTERN.test(body.areaId) ||
    !stringValue(body.machineProfileId) ||
    !UUID_V4_PATTERN.test(body.machineProfileId) ||
    !stringValue(body.effectiveFrom) ||
    !stringValue(body.startsAt) ||
    !stringValue(body.endsAt) ||
    typeof body.endsNextDay !== "boolean"
  ) {
    return null;
  }
  const halfHour = /^(?:[01]\d|2[0-3]):(?:00|30)$/u;
  const effectiveFrom = new Date(body.effectiveFrom);
  const rangeValid = body.endsNextDay
    ? body.endsAt <= body.startsAt
    : body.endsAt > body.startsAt;
  return halfHour.test(body.startsAt) &&
    halfHour.test(body.endsAt) &&
    rangeValid &&
    !Number.isNaN(effectiveFrom.getTime())
    ? (body as unknown as ManagerPricePlanOverlapPreviewRequest)
    : null;
}

export function registerManagerStoreConfigurationRoutes(
  app: Hono,
  services: AppServices,
) {
  app.on(
    "GET",
    ["/api/v1/manager/store-configuration", "/api/v1/hq/store-configuration"],
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (!services.sandboxDatabase || !services.sessionSecret) {
        const mapped = failure(null, requestId);
        return context.json(mapped.body, mapped.status);
      }
      const auth = await configurationSession(context, services, requestId);
      if (!auth.session) return auth.response;
      const role = configurationRole(context);
      const storeId = headquartersStoreId(context);
      if (role === "hq" && !storeId) {
        return context.json(
          errorBody(
            "STORE_CONFIGURATION_STORE_REQUIRED",
            "请选择服务端授权的固定门店后再读取配置。",
            requestId,
          ),
          422,
        );
      }
      try {
        const result =
          await services.sandboxDatabase.readManagerStoreConfiguration({
            contextVersion: auth.session.contextVersion,
            personaId: auth.session.personaId,
            requestId,
            role,
            sandboxId: auth.session.sandboxId,
            ...(storeId ? { storeId } : {}),
          });
        return context.json({
          ...result,
          businessHours: {
            ...result.businessHours,
            effective: result.businessHours.effective.map((hours) => ({
              ...hours,
              effectiveFrom: hours.effectiveFrom.toISOString(),
            })),
            scheduled: result.businessHours.scheduled.map((hours) => ({
              ...hours,
              effectiveFrom: hours.effectiveFrom.toISOString(),
            })),
          },
          pricePlans: result.pricePlans.map((plan) => ({
            ...plan,
            effectiveFrom: plan.effectiveFrom.toISOString(),
            effectiveUntil: plan.effectiveUntil?.toISOString() ?? null,
          })),
          currentTime: result.currentTime.toISOString(),
          status: "ready",
        } satisfies ManagerStoreConfigurationResponse);
      } catch (error) {
        const mapped = failure(error, requestId);
        return context.json(mapped.body, mapped.status);
      }
    },
  );

  app.on(
    "POST",
    [
      "/api/v1/manager/store-configuration/price-overlap-preview",
      "/api/v1/hq/store-configuration/price-overlap-preview",
    ],
    bodyLimit({
      maxSize: 2 * 1024,
      onError: (context) => {
        const requestId = randomUUID();
        context.header("X-Request-Id", requestId);
        context.header("Cache-Control", "no-store");
        return context.json(
          errorBody(
            "STORE_PRICE_PREVIEW_BODY_TOO_LARGE",
            "价格重叠检查请求超过允许大小。",
            requestId,
          ),
          413,
        );
      },
    }),
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (!services.sandboxDatabase || !services.sessionSecret) {
        const mapped = failure(null, requestId);
        return context.json(mapped.body, mapped.status);
      }
      const auth = await configurationSession(context, services, requestId);
      if (!auth.session) return auth.response;
      const role = configurationRole(context);
      const storeId = headquartersStoreId(context);
      if (role === "hq" && !storeId) {
        return context.json(
          errorBody(
            "STORE_CONFIGURATION_STORE_REQUIRED",
            "请选择服务端授权的固定门店后再检查价格版本。",
            requestId,
          ),
          422,
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
            "STORE_CONFIGURATION_ORIGIN_INVALID",
            "请求来源无法验证，价格重叠检查未执行。",
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
            "STORE_CONFIGURATION_CSRF_INVALID",
            "页面上下文已经变化，价格重叠检查未执行。",
            requestId,
          ),
          403,
        );
      }
      const body = parsePricePlanOverlapPreview(
        await context.req.json().catch(() => null),
      );
      if (!body) {
        return context.json(
          errorBody(
            "STORE_PRICE_PREVIEW_INVALID",
            "请使用有效的区域、机型、半小时时段和生效时间检查重叠。",
            requestId,
          ),
          422,
        );
      }
      try {
        const configuration =
          await services.sandboxDatabase.readManagerStoreConfiguration({
            contextVersion: auth.session.contextVersion,
            personaId: auth.session.personaId,
            requestId,
            role,
            sandboxId: auth.session.sandboxId,
            ...(storeId ? { storeId } : {}),
          });
        const effectiveFrom = new Date(body.effectiveFrom);
        const overlap = configuration.pricePlans.find(
          (
            plan,
          ): plan is typeof plan & {
            status: "current" | "scheduled";
          } => {
            if (
              plan.status === "archived" ||
              plan.status === "historical" ||
              plan.area.areaId !== body.areaId ||
              plan.machineProfile.machineProfileId !== body.machineProfileId ||
              !pricePlanClockRangesOverlap(plan, body)
            ) {
              return false;
            }
            const exactScope =
              plan.startsAt === body.startsAt &&
              plan.endsAt === body.endsAt &&
              plan.endsNextDay === body.endsNextDay;
            return exactScope
              ? plan.effectiveFrom.getTime() >= effectiveFrom.getTime()
              : pricePlanEffectiveRangesOverlap(plan, {
                  effectiveFrom,
                  effectiveUntil: null,
                });
          },
        );
        return context.json({
          overlap: overlap
            ? {
                pricePlanId: overlap.pricePlanId,
                status: overlap.status,
                version: overlap.version,
              }
            : null,
          status: "ready",
        } satisfies ManagerPricePlanOverlapPreviewResponse);
      } catch (error) {
        const mapped = failure(error, requestId);
        return context.json(mapped.body, mapped.status);
      }
    },
  );

  app.on(
    "POST",
    [
      "/api/v1/manager/store-configuration/commands",
      "/api/v1/hq/store-configuration/commands",
    ],
    bodyLimit({
      maxSize: 4 * 1024,
      onError: (context) => {
        const requestId = randomUUID();
        context.header("X-Request-Id", requestId);
        context.header("Cache-Control", "no-store");
        return context.json(
          errorBody(
            "STORE_CONFIGURATION_BODY_TOO_LARGE",
            "门店配置请求超过允许大小，配置没有改变。",
            requestId,
          ),
          413,
        );
      },
    }),
    async (context) => {
      const requestId = randomUUID();
      context.header("X-Request-Id", requestId);
      context.header("Cache-Control", "no-store");
      if (!services.sandboxDatabase || !services.sessionSecret) {
        const mapped = failure(null, requestId);
        return context.json(mapped.body, mapped.status);
      }
      const auth = await configurationSession(context, services, requestId);
      if (!auth.session) return auth.response;
      if (!services.allowedOrigins.has(context.req.header("Origin") ?? "")) {
        await recordRoleContextDenial(
          services,
          auth.session,
          requestId,
          "invalid_origin",
        );
        return context.json(
          errorBody(
            "STORE_CONFIGURATION_ORIGIN_INVALID",
            "请求来源无法验证，配置没有改变。",
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
            "STORE_CONFIGURATION_CSRF_INVALID",
            "页面上下文已经变化，配置没有改变。",
            requestId,
          ),
          403,
        );
      }
      const rawBody = await context.req.json().catch(() => null);
      if (
        isPlainRecord(rawBody) &&
        stringValue(rawBody.action) &&
        restrictedStoreActions.has(rawBody.action)
      ) {
        await recordRoleContextDenial(
          services,
          auth.session,
          requestId,
          "capability_denied",
          auth.session.storeIds[0]
            ? { id: auth.session.storeIds[0], kind: "store" }
            : undefined,
        );
      }
      const idempotencyKey = context.req.header("Idempotency-Key");
      if (!idempotencyKey || !UUID_V4_PATTERN.test(idempotencyKey)) {
        return context.json(
          errorBody(
            "STORE_CONFIGURATION_IDEMPOTENCY_REQUIRED",
            "配置提交需要有效且稳定的提交标识。",
            requestId,
          ),
          422,
        );
      }
      const body = parseCommand(rawBody);
      if (!body) {
        return context.json(
          errorBody(
            "STORE_CONFIGURATION_COMMAND_INVALID",
            "请使用门店资料、营业规则、区域、座位、价格或门店商品专用表单提交。",
            requestId,
          ),
          422,
        );
      }
      try {
        const result =
          await services.sandboxDatabase.executeManagerStoreConfigurationCommand(
            {
              ...body,
              ...(body.action === "schedule-business-hours" ||
              body.action === "create-price-plan"
                ? { effectiveFrom: new Date(body.effectiveFrom) }
                : {}),
              contextVersion: auth.session.contextVersion,
              idempotencyKey,
              personaId: auth.session.personaId,
              requestId,
              role: configurationRole(context),
              sandboxId: auth.session.sandboxId,
            } as Parameters<
              typeof services.sandboxDatabase.executeManagerStoreConfigurationCommand
            >[0],
          );
        return context.json(
          result satisfies ManagerStoreConfigurationCommandResponse,
        );
      } catch (error) {
        const mapped = failure(error, requestId);
        return context.json(mapped.body, mapped.status);
      }
    },
  );
}
