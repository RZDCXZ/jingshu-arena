export interface ApiHealth {
  readonly service: "jingshu-api";
  readonly status: "ready";
}

export const PUBLIC_ROLES = ["customer", "staff", "manager", "hq"] as const;

export type PublicRole = (typeof PUBLIC_ROLES)[number];

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

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly requestId: string;
  };
}
