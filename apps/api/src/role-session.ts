import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { PUBLIC_ROLES, type PublicRole } from "@jingshu/contracts";
import type { DatabaseRoleContext } from "@jingshu/database";

const SESSION_TOKEN_VERSION = 2;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CSRF_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,}$/u;
const publicRoles = new Set<PublicRole>(PUBLIC_ROLES);

export interface RoleSessionPayload {
  readonly version: typeof SESSION_TOKEN_VERSION;
  readonly sandboxId: string;
  readonly contextVersion: number;
  readonly role: PublicRole;
  readonly personaId: string;
  readonly storeIds: ReadonlyArray<string>;
  readonly csrfToken: string;
  readonly expiresAt: string;
}

export interface LegacyRoleSessionPayload {
  readonly version: 1;
  readonly sandboxId: string;
  readonly role: PublicRole;
  readonly expiresAt: string;
}

function signSessionPayload(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret)
    .update("jingshu-role-session-v2\0")
    .update(payload)
    .digest();
}

function signLegacySessionPayload(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function isRoleSessionPayload(
  value: unknown,
  now: number,
): value is RoleSessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  const expiresAt =
    typeof payload.expiresAt === "string"
      ? Date.parse(payload.expiresAt)
      : Number.NaN;

  return (
    payload.version === SESSION_TOKEN_VERSION &&
    typeof payload.sandboxId === "string" &&
    UUID_V4_PATTERN.test(payload.sandboxId) &&
    typeof payload.contextVersion === "number" &&
    Number.isInteger(payload.contextVersion) &&
    payload.contextVersion > 0 &&
    typeof payload.role === "string" &&
    publicRoles.has(payload.role as PublicRole) &&
    typeof payload.personaId === "string" &&
    UUID_V4_PATTERN.test(payload.personaId) &&
    Array.isArray(payload.storeIds) &&
    payload.storeIds.length <= 3 &&
    payload.storeIds.every(
      (storeId) => typeof storeId === "string" && UUID_V4_PATTERN.test(storeId),
    ) &&
    typeof payload.csrfToken === "string" &&
    CSRF_TOKEN_PATTERN.test(payload.csrfToken) &&
    Number.isFinite(expiresAt) &&
    expiresAt > now
  );
}

function isLegacyRoleSessionPayload(
  value: unknown,
  now: number,
): value is LegacyRoleSessionPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const payload = value as Record<string, unknown>;
  const expiresAt =
    typeof payload.expiresAt === "string"
      ? Date.parse(payload.expiresAt)
      : Number.NaN;
  return (
    Object.keys(payload).length === 4 &&
    payload.version === 1 &&
    typeof payload.sandboxId === "string" &&
    UUID_V4_PATTERN.test(payload.sandboxId) &&
    typeof payload.role === "string" &&
    publicRoles.has(payload.role as PublicRole) &&
    Number.isFinite(expiresAt) &&
    expiresAt > now
  );
}

function readSignedPayload(
  token: string | undefined,
  secret: string,
  sign: (payload: string, signingSecret: string) => Buffer,
): unknown | null {
  if (!token || token.length > 4_096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) return null;

  try {
    const expectedSignature = sign(encodedPayload, secret);
    const suppliedSignature = Buffer.from(encodedSignature, "base64url");
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null;
    }
    return JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    return null;
  }
}

export function issueRoleSession(
  context: DatabaseRoleContext,
  secret: string,
): { token: string; payload: RoleSessionPayload } {
  const payload = {
    version: SESSION_TOKEN_VERSION,
    sandboxId: context.sandboxId,
    contextVersion: context.contextVersion,
    role: context.role,
    personaId: context.persona.id,
    storeIds: context.storeScope.stores.map((store) => store.id),
    csrfToken: randomBytes(32).toString("base64url"),
    expiresAt: context.expiresAt.toISOString(),
  } satisfies RoleSessionPayload;
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  const signature = signSessionPayload(encodedPayload, secret).toString(
    "base64url",
  );

  return { token: `${encodedPayload}.${signature}`, payload };
}

export function readRoleSession(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): RoleSessionPayload | null {
  const parsed = readSignedPayload(token, secret, signSessionPayload);
  return isRoleSessionPayload(parsed, now) ? parsed : null;
}

/**
 * Keep an authenticated but expired cookie distinguishable from an absent or
 * malformed one. The caller still treats the latter as an ordinary sign-in
 * requirement; only the former represents a terminal sandbox expiry.
 */
export function readRoleSessionEndReason(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): "expired" | undefined {
  const current = readSignedPayload(token, secret, signSessionPayload);
  if (isRoleSessionPayload(current, Number.NEGATIVE_INFINITY)) {
    return Date.parse(current.expiresAt) <= now ? "expired" : undefined;
  }

  const legacy = readSignedPayload(token, secret, signLegacySessionPayload);
  if (isLegacyRoleSessionPayload(legacy, Number.NEGATIVE_INFINITY)) {
    return Date.parse(legacy.expiresAt) <= now ? "expired" : undefined;
  }

  return undefined;
}

export function readRoleSessionWithLegacyFallback(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): RoleSessionPayload | LegacyRoleSessionPayload | null {
  const current = readRoleSession(token, secret, now);
  if (current) return current;
  const legacy = readSignedPayload(token, secret, signLegacySessionPayload);
  return isLegacyRoleSessionPayload(legacy, now) ? legacy : null;
}
