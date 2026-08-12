import { randomUUID } from "node:crypto";

import type { Context, Hono } from "hono";
import { getCookie } from "hono/cookie";
import type {
  CustomerJourneyResponse,
  CustomerMembershipResponse,
} from "@jingshu/contracts";

import { readRoleSession } from "./role-session.js";
import {
  SESSION_COOKIE,
  errorBody,
  isRoleContextStale,
  isRoleContextUnavailable,
  recordRoleContextDenial,
  roleContextUnavailableBody,
  type AppEnvironment,
  type AppServices,
} from "./route-support.js";

const tierLabels = {
  bronze: "青铜",
  gold: "黄金",
  silver: "白银",
} as const;

function customerReadFailure(error: unknown, requestId: string) {
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
      body: roleContextUnavailableBody(
        error,
        "当前演示角色或沙箱已失效，请返回公开入口重新选择。",
        requestId,
      ),
      status: 401 as const,
    };
  }
  return {
    body: errorBody(
      "CUSTOMER_MEMBERSHIP_SERVICE_UNAVAILABLE",
      "会员与行程暂时无法读取，请稍后安全重试。",
      requestId,
    ),
    status: 503 as const,
  };
}

export function registerCustomerMembershipRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  async function customerSession(context: Context, requestId: string) {
    const session = services.sessionSecret
      ? readRoleSession(
          getCookie(context, SESSION_COOKIE),
          services.sessionSecret,
          services.wallClock.now().getTime(),
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
            "请切换到顾客角色后查看会员与行程。",
            requestId,
          ),
          403,
        ),
        session: null,
      };
    }
    return { response: null, session };
  }

  app.get("/api/v1/customer/membership", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "CUSTOMER_MEMBERSHIP_SERVICE_UNAVAILABLE",
          "会员与体验券暂时无法读取，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
    if (new URL(context.req.url).search.length > 0) {
      return context.json(
        errorBody(
          "CUSTOMER_MEMBERSHIP_QUERY_INVALID",
          "会员档案只读取当前顾客，不接受顾客或沙箱标识。",
          requestId,
        ),
        400,
      );
    }
    const auth = await customerSession(context, requestId);
    if (!auth.session) return auth.response;
    try {
      const membership = await services.sandboxDatabase.readCustomerMembership({
        contextVersion: auth.session.contextVersion,
        personaId: auth.session.personaId,
        role: auth.session.role,
        sandboxId: auth.session.sandboxId,
      });
      return context.json({
        status: "ready",
        coupons: membership.coupons.map((coupon) => ({
          ...coupon,
          validFrom: coupon.validFrom.toISOString(),
          validUntil: coupon.validUntil.toISOString(),
        })),
        currentTime: membership.currentTime.toISOString(),
        growthEvents: membership.growthEvents.map((event) => ({
          ...event,
          businessOccurredAt: event.businessOccurredAt.toISOString(),
        })),
        profile: {
          customerDisplayName: membership.profile.customerDisplayName,
          growthPoints: membership.profile.growthPoints,
          lifetimeNondecreasing: true,
          nextTier:
            membership.profile.nextThreshold === null
              ? null
              : {
                  remainingGrowthPoints: membership.profile.remainingToNext,
                  threshold: membership.profile.nextThreshold,
                },
          operatorScope: "三店共享",
          tier: {
            code: membership.profile.tier,
            label: tierLabels[membership.profile.tier],
          },
        },
      } satisfies CustomerMembershipResponse);
    } catch (error) {
      const failure = customerReadFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });

  app.get("/api/v1/customer/journey", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");
    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "CUSTOMER_JOURNEY_SERVICE_UNAVAILABLE",
          "统一行程暂时无法读取，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
    if (new URL(context.req.url).search.length > 0) {
      return context.json(
        errorBody(
          "CUSTOMER_JOURNEY_QUERY_INVALID",
          "统一行程只读取当前顾客，不接受顾客或沙箱标识。",
          requestId,
        ),
        400,
      );
    }
    const auth = await customerSession(context, requestId);
    if (!auth.session) return auth.response;
    try {
      const journey = await services.sandboxDatabase.readCustomerJourney({
        contextVersion: auth.session.contextVersion,
        personaId: auth.session.personaId,
        role: auth.session.role,
        sandboxId: auth.session.sandboxId,
      });
      const serialize = (
        item: (typeof journey.groups.current)[number],
      ): CustomerJourneyResponse["groups"]["current"][number] => ({
        ...item,
        window: {
          endsAt: item.window.endsAt.toISOString(),
          startsAt: item.window.startsAt.toISOString(),
        },
      });
      return context.json({
        status: "ready",
        currentTime: journey.currentTime.toISOString(),
        groups: {
          current: journey.groups.current.map(serialize),
          future: journey.groups.future.map(serialize),
          history: journey.groups.history.map(serialize),
        },
      } satisfies CustomerJourneyResponse);
    } catch (error) {
      const failure = customerReadFailure(error, requestId);
      return context.json(failure.body, failure.status);
    }
  });
}
