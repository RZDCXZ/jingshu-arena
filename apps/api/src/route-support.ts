import { timingSafeEqual } from "node:crypto";

import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import {
  PUBLIC_ROLES,
  type ApiErrorResponse,
  type PublicRole,
  type RoleAccessTargetKind,
  type RoleContextReadyResponse,
} from "@jingshu/contracts";
import type {
  DatabaseRoleContext,
  PublicSandboxDatabase,
} from "@jingshu/database";

import { listRoleCapabilities } from "./role-authorization.js";
import type { readRoleSession } from "./role-session.js";

export const SESSION_COOKIE = "jingshu_session";
export const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const publicRoles = new Set<PublicRole>(PUBLIC_ROLES);

export interface AppServices {
  allowedOrigins: ReadonlySet<string>;
  sandboxDatabase?: PublicSandboxDatabase;
  secureCookies: boolean;
  sessionSecret?: string;
}

export function csrfTokensMatch(
  expected: string,
  supplied: string | undefined,
) {
  if (!supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

export function errorBody(
  code: string,
  message: string,
  requestId: string,
): ApiErrorResponse {
  return { error: { code, message, requestId } };
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPublicRole(value: unknown): value is PublicRole {
  return typeof value === "string" && publicRoles.has(value as PublicRole);
}

export function isRoleContextStale(
  error: unknown,
): error is { code: "ROLE_CONTEXT_STALE" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ROLE_CONTEXT_STALE"
  );
}

export function isRoleContextUnavailable(
  error: unknown,
): error is { code: "ROLE_CONTEXT_UNAVAILABLE" } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ROLE_CONTEXT_UNAVAILABLE"
  );
}

export function roleContextBody(
  context: DatabaseRoleContext,
  csrfToken: string,
): RoleContextReadyResponse {
  const labels = {
    customer: "顾客",
    staff: "店员",
    manager: "店长",
    hq: "总部运营",
  } as const;

  return {
    status: "ready",
    csrfToken,
    contextVersion: context.contextVersion,
    role: { id: context.role, label: labels[context.role] },
    persona: {
      displayName: context.persona.displayName,
      protected: true,
    },
    storeScope: {
      kind: context.storeScope.kind,
      label: context.persona.scope,
      stores: context.storeScope.stores.map((store) => ({
        code: store.code,
        displayName: store.displayName,
      })),
    },
    capabilities: listRoleCapabilities({
      personaId: context.persona.id,
      role: context.role,
      sandboxId: context.sandboxId,
      storeIds: context.storeScope.stores.map((store) => store.id),
    }),
    sandbox: {
      schemaVersion: context.schemaVersion,
      seedVersion: context.seedVersion,
      expiresAt: context.expiresAt.toISOString(),
      businessClock: {
        advanceLimitMilliseconds:
          context.businessClock.advanceLimitMilliseconds,
        advancedMilliseconds: context.businessClock.advancedMilliseconds,
        currentTime: context.businessClock.currentTime.toISOString(),
        remainingAdvanceMilliseconds:
          context.businessClock.remainingAdvanceMilliseconds,
        timeZone: context.businessClock.timeZone,
      },
    },
    freshness: {
      mode: "manual",
      observedAt: new Date().toISOString(),
    },
  };
}

export function setRoleSessionCookie(
  context: Context,
  token: string,
  services: AppServices,
) {
  setCookie(context, SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "Lax",
    secure: services.secureCookies,
  });
}

export async function recordRoleContextDenial(
  services: AppServices,
  session: NonNullable<ReturnType<typeof readRoleSession>>,
  requestId: string,
  reason:
    | "context_version_stale"
    | "csrf_context_mismatch"
    | "capability_denied"
    | "forged_context_fields"
    | "invalid_origin",
  target?: {
    id: string;
    kind: RoleAccessTargetKind;
  },
) {
  await services.sandboxDatabase?.recordRoleContextDenial({
    ...(target
      ? {
          action: "role_capability.check" as const,
          objectId: target.id,
          objectType:
            target.kind === "persona" ? ("demo_persona" as const) : target.kind,
        }
      : {}),
    sandboxId: session.sandboxId,
    contextVersion: session.contextVersion,
    role: session.role,
    personaId: session.personaId,
    storeId:
      session.role === "staff" || session.role === "manager"
        ? (session.storeIds[0] ?? null)
        : null,
    requestId,
    reason,
  });
}
