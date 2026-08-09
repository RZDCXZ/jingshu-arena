export interface ApiHealth {
  readonly service: "jingshu-api";
  readonly status: "ready";
}

export const PUBLIC_ROLES = ["customer", "staff", "manager", "hq"] as const;

export type PublicRole = (typeof PUBLIC_ROLES)[number];

export const ROLE_CAPABILITIES = [
  "customer:manage-own-records",
  "store:perform-frontline",
  "store:adjust-inventory",
  "store:configure",
  "store:manage-people",
  "chain:compare",
  "chain:configure",
  "audit:view",
] as const;

export type RoleCapability = (typeof ROLE_CAPABILITIES)[number];

export const ROLE_ACCESS_TARGET_KINDS = [
  "persona",
  "sandbox",
  "store",
] as const;

export type RoleAccessTargetKind = (typeof ROLE_ACCESS_TARGET_KINDS)[number];

export interface RoleAccessCheckRequest {
  readonly capability: RoleCapability;
  readonly target: {
    readonly id: string;
    readonly kind: RoleAccessTargetKind;
  };
}

export interface RoleAccessAllowedResponse {
  readonly status: "allowed";
  readonly capability: RoleCapability;
  readonly target: {
    readonly kind: RoleAccessTargetKind;
  };
}

export interface PublicSandboxReadyResponse {
  readonly status: "ready";
  readonly replayed: boolean;
  readonly role: PublicRole;
  readonly persona: {
    readonly displayName: string;
    readonly scope: string;
  };
  readonly world: {
    readonly schemaVersion: string;
    readonly seedVersion: string;
    readonly expiresAt: string;
    readonly operator: {
      readonly displayName: string;
      readonly city: string;
    };
    readonly stores: ReadonlyArray<{
      readonly code: string;
      readonly displayName: string;
      readonly seatCount: number;
      readonly businessHours: string;
    }>;
  };
}

export interface RoleContextReadyResponse {
  readonly status: "ready";
  readonly csrfToken: string;
  readonly contextVersion: number;
  readonly role: {
    readonly id: PublicRole;
    readonly label: "顾客" | "店员" | "店长" | "总部运营";
  };
  readonly persona: {
    readonly displayName: string;
    readonly protected: true;
  };
  readonly storeScope: {
    readonly kind: "customer" | "store" | "all-stores";
    readonly label: string;
    readonly stores: ReadonlyArray<{
      readonly code: string;
      readonly displayName: string;
    }>;
  };
  readonly capabilities: ReadonlyArray<RoleCapability>;
  readonly sandbox: {
    readonly schemaVersion: string;
    readonly seedVersion: string;
    readonly expiresAt: string;
  };
  readonly freshness: {
    readonly mode: "manual";
    readonly observedAt: string;
  };
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}
