import { randomUUID } from "node:crypto";

import type { Hono } from "hono";
import { getCookie } from "hono/cookie";
import type { ApiErrorResponse, DemoStoryResponse } from "@jingshu/contracts";

import { readRoleSession, readRoleSessionEndReason } from "./role-session.js";
import {
  SESSION_COOKIE,
  errorBody,
  isRoleContextStale,
  isRoleContextUnavailable,
  roleContextUnavailableBody,
  type AppEnvironment,
  type AppServices,
} from "./route-support.js";

function roleContextError(
  error: unknown,
  requestId: string,
): { body: ApiErrorResponse; status: 401 | 409 } | null {
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
  return null;
}

export function registerDemoStoryRoutes(
  app: Hono<AppEnvironment>,
  services: AppServices,
) {
  app.get("/api/v1/demo/story", async (context) => {
    const requestId = randomUUID();
    context.header("X-Request-Id", requestId);
    context.header("Cache-Control", "no-store");

    if (!services.sandboxDatabase || !services.sessionSecret) {
      return context.json(
        errorBody(
          "DEMO_STORY_SERVICE_UNAVAILABLE",
          "主演示清单暂时无法读取，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
    const now = services.wallClock.now().getTime();
    const session = readRoleSession(
      getCookie(context, SESSION_COOKIE),
      services.sessionSecret,
      now,
    );
    if (!session) {
      return context.json(
        errorBody(
          "ROLE_CONTEXT_REQUIRED",
          "演示角色上下文已失效，请返回公开入口重新选择。",
          requestId,
          readRoleSessionEndReason(
            getCookie(context, SESSION_COOKIE),
            services.sessionSecret,
            now,
          ),
        ),
        401,
      );
    }

    try {
      const story = await services.sandboxDatabase.readDemoStory({
        contextVersion: session.contextVersion,
        personaId: session.personaId,
        role: session.role,
        sandboxId: session.sandboxId,
      });
      let priorStepComplete = true;
      let completedCount = 0;
      const steps = story.steps.map((step) => {
        const completed = priorStepComplete && step.satisfied;
        const state: DemoStoryResponse["steps"][number]["state"] = completed
          ? "completed"
          : priorStepComplete
            ? "current"
            : "blocked";
        if (completed) completedCount += 1;
        priorStepComplete = completed;
        return {
          evidence: step.evidence.map((evidence) => ({
            ...evidence,
            occurredAt: evidence.occurredAt.toISOString(),
          })),
          id: step.id,
          state,
        };
      });
      return context.json({
        completedCount,
        resetAt: story.resetAt?.toISOString() ?? null,
        status: "ready",
        steps,
      } satisfies DemoStoryResponse);
    } catch (error) {
      const roleError = roleContextError(error, requestId);
      if (roleError) return context.json(roleError.body, roleError.status);
      return context.json(
        errorBody(
          "DEMO_STORY_SERVICE_UNAVAILABLE",
          "主演示清单暂时无法读取，请稍后安全重试。",
          requestId,
        ),
        503,
      );
    }
  });
}
