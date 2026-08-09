export interface ApiHealth {
  readonly service: "jingshu-api";
  readonly status: "ready";
}

export const PUBLIC_ROLES = ["customer", "staff", "manager", "hq"] as const;

export type PublicRole = (typeof PUBLIC_ROLES)[number];

export const CUSTOMER_MACHINE_PROFILE_CODES = [
  "standard",
  "competitive",
  "flagship",
] as const;

export type CustomerMachineProfileCode =
  (typeof CUSTOMER_MACHINE_PROFILE_CODES)[number];
export type CustomerReservationMode = "future" | "immediate";
export type CustomerSeatAvailability =
  "available" | "in-use" | "maintenance" | "reserved";
export type CustomerReservationPriceRule =
  "weekday-base" | "weekday-evening" | "weekday-overnight" | "weekend";

export type CustomerReservationCouponIneligibleReason =
  | "business-kind"
  | "minimum-spend"
  | "store"
  | "time-window"
  | "unavailable"
  | "validity";

export interface CustomerReservationCouponOption {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly discountCents: number;
  readonly minimumSpendCents: number;
  readonly validUntil: string;
  readonly eligibility:
    | {
        readonly discountCents: number;
        readonly payableCents: number;
        readonly status: "eligible";
      }
    | {
        readonly reason: CustomerReservationCouponIneligibleReason;
        readonly status: "ineligible";
      };
}

export interface CustomerStoreCatalogResponse {
  readonly status: "ready";
  readonly city: string;
  readonly currentTime: string;
  readonly bookingRules: {
    readonly durationHours: { readonly maximum: 8; readonly minimum: 1 };
    readonly futureDays: 7;
    readonly halfHourAligned: true;
    readonly immediateUsesCurrentSegment: true;
  };
  readonly stores: ReadonlyArray<{
    readonly areas: ReadonlyArray<{
      readonly code: string;
      readonly displayName: string;
      readonly seatCount: number;
    }>;
    readonly businessHours: string;
    readonly closesAt: string;
    readonly closesNextDay: boolean;
    readonly code: string;
    readonly displayName: string;
    readonly isOpen24Hours: boolean;
    readonly machineProfiles: ReadonlyArray<{
      readonly baseHourlyCents: number;
      readonly code: CustomerMachineProfileCode;
      readonly displayName: string;
      readonly experienceDescription: string;
      readonly seatCount: number;
    }>;
    readonly opensAt: string;
    readonly seatCount: number;
  }>;
}

export interface CustomerSeatAvailabilityResponse {
  readonly status: "ready";
  readonly area: { readonly code: string; readonly displayName: string };
  readonly coupons: ReadonlyArray<CustomerReservationCouponOption>;
  readonly machineProfile: {
    readonly code: CustomerMachineProfileCode;
    readonly displayName: string;
    readonly experienceDescription: string;
  };
  readonly price: {
    readonly baseHourlyCents: number;
    readonly segments: ReadonlyArray<{
      readonly amountCents: number;
      readonly endsAt: string;
      readonly multiplierBasisPoints: number;
      readonly rule: CustomerReservationPriceRule;
      readonly startsAt: string;
    }>;
    readonly totalCents: number;
  };
  readonly seats: ReadonlyArray<{
    readonly availability: CustomerSeatAvailability;
    readonly code: string;
    readonly operationalStatus: "maintenance" | "normal";
  }>;
  readonly store: { readonly code: string; readonly displayName: string };
  readonly window: {
    readonly endsAt: string;
    readonly mode: CustomerReservationMode;
    readonly startsAt: string;
  };
}

export interface CreateCustomerPendingReservationRequest {
  readonly areaCode: string;
  readonly couponId: string | null;
  readonly durationHours: number;
  readonly machineProfileCode: CustomerMachineProfileCode;
  readonly mode: CustomerReservationMode;
  readonly requestedStartsAt?: string;
  readonly seatCode: string;
  readonly storeCode: string;
}

export interface CustomerPendingReservationResponse {
  readonly status: "pending-confirmation";
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly holdExpiresAt: string;
  readonly snapshot: {
    readonly area: { readonly code: string; readonly displayName: string };
    readonly coupon: {
      readonly code: string;
      readonly displayName: string;
      readonly discountCents: number;
    } | null;
    readonly machineProfile: {
      readonly code: CustomerMachineProfileCode;
      readonly displayName: string;
      readonly experienceDescription: string;
    };
    readonly price: {
      readonly discountCents: number;
      readonly payableCents: number;
      readonly segments: ReadonlyArray<{
        readonly amountCents: number;
        readonly endsAt: string;
        readonly multiplierBasisPoints: number;
        readonly rule: CustomerReservationPriceRule;
        readonly startsAt: string;
      }>;
      readonly subtotalCents: number;
    };
    readonly seat: { readonly code: string };
    readonly store: { readonly code: string; readonly displayName: string };
    readonly window: { readonly endsAt: string; readonly startsAt: string };
  };
}

export const CUSTOMER_RESERVATION_STATUSES = [
  "pending-confirmation",
  "confirmed",
  "arrived",
  "in-use",
  "completed",
  "cancelled",
  "expired",
] as const;

export type CustomerReservationStatus =
  (typeof CUSTOMER_RESERVATION_STATUSES)[number];

export interface CustomerReservationDetailResponse {
  readonly actions: {
    readonly canCancel: boolean;
    readonly canSimulatePayment: boolean;
  };
  readonly arrivalWindow: {
    readonly closesAt: string;
    readonly opensAt: string;
  };
  readonly cancelledAt: string | null;
  readonly confirmedAt: string | null;
  readonly coupon:
    | (NonNullable<CustomerPendingReservationResponse["snapshot"]["coupon"]> & {
        readonly status: "available" | "expired" | "redeemed" | "reserved";
      })
    | null;
  readonly currentTime: string;
  readonly expiredAt: string | null;
  readonly holdExpiresAt: string | null;
  readonly payment: {
    readonly amountCents: number;
    readonly occurredAt: string;
    readonly simulated: true;
  } | null;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: string;
    readonly reason: string;
    readonly simulated: true;
  } | null;
  readonly related: {
    readonly orders: ReadonlyArray<never>;
    readonly repairs: ReadonlyArray<never>;
  };
  readonly reservationId: string;
  readonly snapshot: CustomerPendingReservationResponse["snapshot"];
  readonly status: CustomerReservationStatus;
  readonly terminalReason: string | null;
  readonly timeline: ReadonlyArray<{
    readonly data: unknown;
    readonly occurredAt: string;
    readonly type: string;
  }>;
}

export interface CustomerReservationPaymentResponse {
  readonly notice: "模拟支付，不会扣款，也不需要真实支付凭证。";
  readonly payment: {
    readonly amountCents: number;
    readonly occurredAt: string;
    readonly simulated: true;
  };
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly status: "confirmed";
}

export interface CancelCustomerReservationRequest {
  readonly reason: string;
}

export interface CustomerReservationCancellationResponse {
  readonly cancelledAt: string;
  readonly couponRestored: boolean;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: string;
    readonly reason: string;
    readonly simulated: true;
  } | null;
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly status: "cancelled";
}

export const DEMO_TIME_DUE_HANDLER_KINDS = [
  "pending-reservation-expiration",
  "pending-order-expiration",
  "reservation-no-show",
  "reservation-auto-completion",
  "attendance-absence",
  "handover-exception",
] as const;

export type DemoTimeDueHandlerKind =
  (typeof DEMO_TIME_DUE_HANDLER_KINDS)[number];
export type DemoTimeAdvanceMode = "next-event" | "half-hour";

export interface SandboxBusinessClockResponse {
  readonly advanceLimitMilliseconds: number;
  readonly advancedMilliseconds: number;
  readonly currentTime: string;
  readonly remainingAdvanceMilliseconds: number;
  readonly timeZone: "Asia/Shanghai";
}

export interface DemoTimeImpactResponse {
  readonly count: number;
  readonly kind: DemoTimeDueHandlerKind;
}

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
    readonly businessClock: SandboxBusinessClockResponse;
  };
  readonly freshness: {
    readonly mode: "manual";
    readonly observedAt: string;
  };
}

export interface DemoTimePreviewResponse {
  readonly status: "ready";
  readonly clock: SandboxBusinessClockResponse;
  readonly halfHour: {
    readonly afterTime: string | null;
    readonly impacts: ReadonlyArray<DemoTimeImpactResponse>;
  };
  readonly nextEvent: {
    readonly afterTime: string;
    readonly impacts: ReadonlyArray<DemoTimeImpactResponse>;
  } | null;
}

export interface DemoTimeAdvancedResponse {
  readonly status: "advanced";
  readonly replayed: boolean;
  readonly mode: DemoTimeAdvanceMode;
  readonly beforeTime: string;
  readonly afterTime: string;
  readonly clock: Omit<SandboxBusinessClockResponse, "currentTime">;
  readonly impacts: ReadonlyArray<DemoTimeImpactResponse>;
}

export interface SandboxResetReadyResponse {
  readonly status: "ready";
  readonly replayed: boolean;
  readonly previousSandboxInvalidated: true;
  readonly result: {
    readonly targetRole: "customer";
    readonly persona: {
      readonly displayName: string;
    };
    readonly sandbox: {
      readonly schemaVersion: string;
      readonly seedVersion: string;
      readonly expiresAt: string;
      readonly businessClock: SandboxBusinessClockResponse;
    };
  };
  /** The latest signed session context, which may change after the reset result. */
  readonly context: RoleContextReadyResponse;
}

export interface ApiErrorResponse {
  readonly error: {
    readonly code: string;
    readonly currentStatus?: CustomerReservationStatus;
    readonly message: string;
    readonly requestId: string;
  };
}
