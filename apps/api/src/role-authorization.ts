import type { PublicRole, RoleCapability } from "@jingshu/contracts";

export type { RoleCapability } from "@jingshu/contracts";

export interface RoleAuthorizationContext {
  readonly personaId: string;
  readonly role: PublicRole;
  readonly sandboxId: string;
  readonly storeIds: ReadonlyArray<string>;
}

export interface RoleAuthorizationRequest {
  readonly capability: RoleCapability;
  readonly ownerPersonaId?: string;
  readonly sandboxId: string;
  readonly storeId?: string;
}

const grantedCapabilities = {
  customer: ["customer:manage-own-records"],
  staff: ["store:perform-frontline"],
  manager: [
    "store:perform-frontline",
    "store:adjust-inventory",
    "store:configure",
    "store:manage-people",
    "audit:view",
  ],
  hq: [
    "store:configure",
    "chain:compare",
    "chain:configure",
    "chain:maintain-catalogs",
    "audit:view",
  ],
} as const satisfies Record<PublicRole, ReadonlyArray<RoleCapability>>;

export function listRoleCapabilities(
  context: RoleAuthorizationContext,
): ReadonlyArray<RoleCapability> {
  return [...grantedCapabilities[context.role]];
}

export function authorizeRoleCapability(
  context: RoleAuthorizationContext,
  request: RoleAuthorizationRequest,
): boolean {
  if (request.sandboxId !== context.sandboxId) return false;

  if (
    !grantedCapabilities[context.role].includes(request.capability as never)
  ) {
    return false;
  }

  if (request.capability === "customer:manage-own-records") {
    return request.ownerPersonaId === context.personaId;
  }

  if (
    request.capability === "chain:compare" ||
    request.capability === "chain:configure" ||
    request.capability === "chain:maintain-catalogs"
  ) {
    return true;
  }

  return (
    typeof request.storeId === "string" &&
    context.storeIds.includes(request.storeId)
  );
}
