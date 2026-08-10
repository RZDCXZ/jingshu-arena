import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import type { PoolClient } from "pg";
import type {
  FrontlineReservationAction,
  PublicRole,
  StaffOrderAction,
  StaffOrderStageFilter,
  StaffReservationAnomalyFilter,
  StaffReservationTimeFilter,
} from "@jingshu/contracts";
import {
  businessDayRange,
  buildPublicSandboxSeed,
  decideCustomerOrderLifecycle,
  type CustomerReservationMode,
  decideReservationLifecycle,
  decideFrontlineReservationLifecycle,
  decideStaffOrderFulfillment,
  deriveExperienceCouponStatus,
  deriveSeatAvailability,
  evaluateReservationCoupon,
  memberTierForGrowth,
  priceCustomerOrder,
  type CustomerOrderStatus,
  type MachineProfileCode,
  priceReservationWindow,
  reservationGrowthAward,
  type ReservationPriceRule,
  type ReservationCouponEligibility,
  type ReservationStatus,
  resolveCustomerReservationWindow,
  type SeatAvailability,
  sandboxBusinessTimeAt,
  SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
  SANDBOX_BUSINESS_TIME_ZONE,
} from "@jingshu/domain";

import {
  CustomerOrderConflictError,
  CustomerReservationCreateConflictError,
  CustomerReservationIdempotencyConflictError,
  CustomerReservationLifecycleConflictError,
  CustomerSeatBrowseValidationError,
  FrontlineReservationConflictError,
  StaffOrderConflictError,
  PublicSandboxIdempotencyConflictError,
  PublicSandboxOwnershipConflictError,
  RoleContextStaleError,
  RoleContextUnavailableError,
} from "./errors.js";
import {
  createSandboxDemoToolMethods,
  type DatabaseBusinessClock,
  type DemoTimeDueHandlerRegistry,
  type SandboxDemoToolMethods,
  type WallClock,
} from "./sandbox-demo-tools.js";

const { Pool } = pg;

const SANDBOX_LIFETIME_MS = 24 * 60 * 60 * 1000;
const publicSandboxSeed = buildPublicSandboxSeed();

export interface CreatePublicSandboxInput {
  creationKey: string;
  selectedRole: PublicRole;
  visitorKey: string;
}

export interface PublicSandboxResult {
  replayed: boolean;
  sandboxId: string;
  schemaVersion: string;
  seedVersion: string;
  expiresAt: Date;
  selectedRole: PublicRole;
  persona: {
    displayName: string;
    protected: boolean;
    scope: string;
  };
  operator: {
    displayName: string;
    city: string;
  };
  stores: Array<{
    code: string;
    displayName: string;
    seatCount: number;
    businessHours: string;
  }>;
  roleContext: DatabaseRoleContext;
}

export interface ReadRoleContextInput {
  sandboxId: string;
  contextVersion: number;
  role: PublicRole;
  personaId: string;
}

export type CustomerBrowseContextInput = ReadRoleContextInput;

export interface DatabaseCustomerStoreCatalog {
  readonly city: string;
  readonly currentTime: Date;
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
      readonly code: MachineProfileCode;
      readonly displayName: string;
      readonly experienceDescription: string;
      readonly seatCount: number;
    }>;
    readonly opensAt: string;
    readonly seatCount: number;
  }>;
}

export interface ReadCustomerSeatAvailabilityInput extends CustomerBrowseContextInput {
  readonly areaCode: string;
  readonly durationHours: number;
  readonly machineProfileCode: MachineProfileCode;
  readonly mode: CustomerReservationMode;
  readonly requestedStartsAt?: Date;
  readonly storeCode: string;
}

export interface DatabaseCustomerSeatAvailability {
  readonly area: { readonly code: string; readonly displayName: string };
  readonly machineProfile: {
    readonly code: MachineProfileCode;
    readonly displayName: string;
    readonly experienceDescription: string;
  };
  readonly price: {
    readonly baseHourlyCents: number;
    readonly segments: ReadonlyArray<{
      readonly amountCents: number;
      readonly endsAt: Date;
      readonly multiplierBasisPoints: number;
      readonly rule: ReservationPriceRule;
      readonly startsAt: Date;
    }>;
    readonly totalCents: number;
  };
  readonly coupons: ReadonlyArray<{
    readonly id: string;
    readonly code: string;
    readonly displayName: string;
    readonly discountCents: number;
    readonly minimumSpendCents: number;
    readonly validUntil: Date;
    readonly eligibility: ReservationCouponEligibility;
  }>;
  readonly seats: ReadonlyArray<{
    readonly availability: SeatAvailability;
    readonly code: string;
    readonly operationalStatus: "maintenance" | "normal";
  }>;
  readonly store: { readonly code: string; readonly displayName: string };
  readonly window: {
    readonly endsAt: Date;
    readonly mode: CustomerReservationMode;
    readonly startsAt: Date;
  };
}

export interface CreateCustomerPendingReservationInput extends CustomerBrowseContextInput {
  readonly areaCode: string;
  readonly couponId: string | null;
  readonly durationHours: number;
  readonly idempotencyKey: string;
  readonly machineProfileCode: MachineProfileCode;
  readonly mode: CustomerReservationMode;
  readonly requestId: string;
  readonly requestedStartsAt?: Date;
  readonly seatCode: string;
  readonly storeCode: string;
}

export interface DatabaseCustomerPendingReservation {
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly status: "pending-confirmation";
  readonly holdExpiresAt: Date;
  readonly snapshot: {
    readonly area: { readonly code: string; readonly displayName: string };
    readonly coupon: {
      readonly code: string;
      readonly displayName: string;
      readonly discountCents: number;
    } | null;
    readonly machineProfile: {
      readonly code: MachineProfileCode;
      readonly displayName: string;
      readonly experienceDescription: string;
    };
    readonly price: {
      readonly discountCents: number;
      readonly payableCents: number;
      readonly segments: ReadonlyArray<{
        readonly amountCents: number;
        readonly endsAt: Date;
        readonly multiplierBasisPoints: number;
        readonly rule: ReservationPriceRule;
        readonly startsAt: Date;
      }>;
      readonly subtotalCents: number;
    };
    readonly seat: { readonly code: string };
    readonly store: { readonly code: string; readonly displayName: string };
    readonly window: { readonly endsAt: Date; readonly startsAt: Date };
  };
}

export interface ReadCustomerReservationDetailInput extends CustomerBrowseContextInput {
  readonly reservationId: string;
}

export interface SimulateCustomerReservationPaymentInput extends ReadCustomerReservationDetailInput {
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export interface CancelCustomerReservationInput extends ReadCustomerReservationDetailInput {
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly requestId: string;
}

export interface DatabaseCustomerReservationPayment {
  readonly payment: {
    readonly amountCents: number;
    readonly occurredAt: Date;
    readonly simulated: true;
  };
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly status: "confirmed";
}

export interface DatabaseCustomerReservationCancellation {
  readonly cancelledAt: Date;
  readonly couponRestored: boolean;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: Date;
    readonly reason: "customer-cancelled-before-start";
    readonly simulated: true;
  } | null;
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly status: "cancelled";
}

export interface ReadCustomerOrderCatalogInput extends CustomerBrowseContextInput {
  readonly reservationId: string;
}

export interface ReadCustomerOrderDetailInput extends CustomerBrowseContextInput {
  readonly orderId: string;
}

export interface CreateCustomerPendingOrderInput extends ReadCustomerOrderCatalogInput {
  readonly couponId: string | null;
  readonly idempotencyKey: string;
  readonly lines: ReadonlyArray<{
    readonly productId: string;
    readonly quantity: number;
  }>;
  readonly requestId: string;
}

export interface SimulateCustomerOrderPaymentInput extends ReadCustomerOrderDetailInput {
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export interface CancelCustomerOrderInput extends ReadCustomerOrderDetailInput {
  readonly idempotencyKey: string;
  readonly reason: string;
  readonly requestId: string;
}

export interface DatabaseCustomerOrderCatalog {
  readonly coupons: ReadonlyArray<{
    readonly code: string;
    readonly discountCents: number;
    readonly displayName: string;
    readonly eligibility:
      | { readonly status: "eligible" }
      | {
          readonly reason: "minimum-spend" | "time-window" | "unavailable";
          readonly status: "ineligible";
        };
    readonly id: string;
    readonly minimumSpendCents: number;
    readonly validUntil: Date;
  }>;
  readonly currentTime: Date;
  readonly products: ReadonlyArray<{
    readonly availableQuantity: number;
    readonly category: "drink" | "meal" | "snack" | "supply";
    readonly description: string;
    readonly id: string;
    readonly lowStock: boolean;
    readonly name: string;
    readonly onHandQuantity: number;
    readonly reservedQuantity: number;
    readonly unitPriceCents: number;
  }>;
  readonly reservation: {
    readonly reservationId: string;
    readonly seat: { readonly code: string };
    readonly status: "arrived" | "in-use";
    readonly store: { readonly code: string; readonly displayName: string };
  };
}

export interface CustomerOrderSnapshot {
  readonly coupon: {
    readonly code: string;
    readonly discountCents: number;
    readonly displayName: string;
  } | null;
  readonly discountCents: number;
  readonly lines: ReadonlyArray<{
    readonly lineTotalCents: number;
    readonly productId: string;
    readonly productName: string;
    readonly quantity: number;
    readonly unitPriceCents: number;
  }>;
  readonly payableCents: number;
  readonly reservation: {
    readonly reservationId: string;
    readonly seatCode: string;
    readonly storeCode: string;
    readonly storeDisplayName: string;
  };
  readonly subtotalCents: number;
}

export interface DatabaseCustomerPendingOrder {
  readonly holdExpiresAt: Date;
  readonly orderId: string;
  readonly replayed: boolean;
  readonly snapshot: CustomerOrderSnapshot;
  readonly status: "pending-simulated-payment";
}

export interface DatabaseCustomerOrderPayment {
  readonly orderId: string;
  readonly payment: {
    readonly amountCents: number;
    readonly doesNotCharge: true;
    readonly occurredAt: Date;
    readonly simulated: true;
  };
  readonly replayed: boolean;
  readonly status: "simulated-paid";
}

export interface DatabaseCustomerOrderCancellation {
  readonly cancelledAt: Date;
  readonly couponRestored: boolean;
  readonly orderId: string;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: Date;
    readonly reason: string;
    readonly simulated: true;
  } | null;
  readonly replayed: boolean;
  readonly status: "cancelled";
}

export interface DatabaseCustomerOrderDetail {
  readonly actions: {
    readonly canCancel: boolean;
    readonly canSimulatePayment: boolean;
  };
  readonly cancelledAt: Date | null;
  readonly coupon:
    | (NonNullable<CustomerOrderSnapshot["coupon"]> & {
        readonly status: "available" | "expired" | "redeemed" | "reserved";
      })
    | null;
  readonly currentTime: Date;
  readonly events: ReadonlyArray<{
    readonly data: unknown;
    readonly occurredAt: Date;
    readonly type: string;
  }>;
  readonly expiredAt: Date | null;
  readonly holdExpiresAt: Date;
  readonly inventory: ReadonlyArray<{
    readonly availableQuantity: number;
    readonly onHandQuantity: number;
    readonly productId: string;
    readonly reservedQuantity: number;
    readonly reservedForOrderQuantity: number;
  }>;
  readonly orderId: string;
  readonly payment: DatabaseCustomerOrderPayment["payment"] | null;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: Date;
    readonly reason: string;
    readonly simulated: true;
  } | null;
  readonly snapshot: CustomerOrderSnapshot;
  readonly status: CustomerOrderStatus;
  readonly terminalReason: string | null;
}

export interface DatabaseCustomerReservationDetail {
  readonly actions: {
    readonly canCancel: boolean;
    readonly canSimulatePayment: boolean;
  };
  readonly arrivalWindow: {
    readonly closesAt: Date;
    readonly opensAt: Date;
  };
  readonly cancelledAt: Date | null;
  readonly confirmedAt: Date | null;
  readonly coupon:
    | (DatabaseCustomerPendingReservation["snapshot"]["coupon"] & {
        readonly status: "available" | "expired" | "redeemed" | "reserved";
      })
    | null;
  readonly currentTime: Date;
  readonly events: ReadonlyArray<{
    readonly data: unknown;
    readonly occurredAt: Date;
    readonly type: string;
  }>;
  readonly expiredAt: Date | null;
  readonly holdExpiresAt: Date | null;
  readonly payment: {
    readonly amountCents: number;
    readonly occurredAt: Date;
    readonly simulated: true;
  } | null;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: Date;
    readonly reason: string;
    readonly simulated: true;
  } | null;
  readonly related: {
    readonly orders: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly status: CustomerOrderStatus;
    }>;
    readonly repairs: ReadonlyArray<never>;
  };
  readonly reservationId: string;
  readonly snapshot: DatabaseCustomerPendingReservation["snapshot"];
  readonly status: ReservationStatus;
  readonly terminalReason: string | null;
}

export interface DatabaseCustomerMembership {
  readonly coupons: ReadonlyArray<{
    readonly businessKind: "order" | "reservation";
    readonly code: string;
    readonly discountCents: number;
    readonly displayName: string;
    readonly id: string;
    readonly minimumSpendCents: number;
    readonly releaseCondition: string;
    readonly status: "available" | "expired" | "redeemed" | "reserved";
    readonly store: {
      readonly code: string;
      readonly displayName: string;
    } | null;
    readonly transaction: {
      readonly id: string;
      readonly kind: "order" | "reservation";
      readonly label: string;
      readonly status: string;
    } | null;
    readonly validFrom: Date;
    readonly validUntil: Date;
  }>;
  readonly currentTime: Date;
  readonly growthEvents: ReadonlyArray<{
    readonly businessOccurredAt: Date;
    readonly finalSimulatedAmountCents: number;
    readonly growthPoints: number;
    readonly id: string;
    readonly label: string;
    readonly source: {
      readonly id: string | null;
      readonly kind: "order" | "reservation" | "seed-baseline";
    };
  }>;
  readonly profile: {
    readonly customerDisplayName: string;
    readonly growthPoints: number;
    readonly nextThreshold: 500 | 1_500 | null;
    readonly remainingToNext: number;
    readonly tier: "bronze" | "gold" | "silver";
  };
}

export interface DatabaseCustomerJourneyReservation {
  readonly area: { readonly code: string; readonly displayName: string };
  readonly coupon: {
    readonly discountCents: number;
    readonly displayName: string;
  } | null;
  readonly growthAward: { readonly growthPoints: number } | null;
  readonly machineProfile: {
    readonly code: MachineProfileCode;
    readonly displayName: string;
  };
  readonly payableCents: number;
  readonly refund: {
    readonly amountCents: number;
    readonly reason: string;
  } | null;
  readonly related: {
    readonly orders: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly status: string;
    }>;
    readonly repairs: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly status: string;
    }>;
  };
  readonly reservationId: string;
  readonly seat: { readonly code: string };
  readonly status: ReservationStatus;
  readonly store: { readonly code: string; readonly displayName: string };
  readonly terminalReason: string | null;
  readonly window: { readonly endsAt: Date; readonly startsAt: Date };
}

export interface DatabaseCustomerJourney {
  readonly currentTime: Date;
  readonly groups: {
    readonly current: ReadonlyArray<DatabaseCustomerJourneyReservation>;
    readonly future: ReadonlyArray<DatabaseCustomerJourneyReservation>;
    readonly history: ReadonlyArray<DatabaseCustomerJourneyReservation>;
  };
}

export type FrontlineRole = "manager" | "staff";

export interface ReadStaffReservationWorkbenchInput extends ReadRoleContextInput {
  readonly role: FrontlineRole;
}

export interface ReadStaffReservationListInput extends ReadStaffReservationWorkbenchInput {
  readonly anomaly: StaffReservationAnomalyFilter;
  readonly areaCode: string | null;
  readonly machineProfileCode: MachineProfileCode | null;
  readonly search: string;
  readonly status: ReservationStatus | null;
  readonly time: StaffReservationTimeFilter;
}

export interface ReadStaffReservationDetailInput extends ReadStaffReservationWorkbenchInput {
  readonly reservationId: string;
}

export interface ExecuteStaffReservationCommandInput extends ReadStaffReservationDetailInput {
  readonly action: FrontlineReservationAction;
  readonly idempotencyKey: string;
  readonly reason: string | null;
  readonly requestId: string;
}

export interface ReadStaffOrderQueueInput extends ReadStaffReservationWorkbenchInput {
  readonly stage: StaffOrderStageFilter;
}

export interface ReadStaffOrderDetailInput extends ReadStaffReservationWorkbenchInput {
  readonly orderId: string;
}

export interface ExecuteStaffOrderCommandInput extends ReadStaffOrderDetailInput {
  readonly action: StaffOrderAction;
  readonly idempotencyKey: string;
  readonly reason: string | null;
  readonly requestId: string;
}

export interface DatabaseStaffOrderSummary {
  readonly amountCents: number;
  readonly couponLabel: string | null;
  readonly customerDisplayName: string;
  readonly itemSummary: string;
  readonly orderId: string;
  readonly reservation: {
    readonly reservationId: string;
    readonly seatCode: string;
    readonly status: ReservationStatus;
  };
  readonly stageEnteredAt: Date;
  readonly status: CustomerOrderStatus;
  readonly waitingMinutes: number;
}

export interface DatabaseStaffOrderQueue {
  readonly counts: Record<
    "exception" | "preparing" | "ready-for-pickup" | "simulated-paid",
    number
  >;
  readonly currentTime: Date;
  readonly rows: ReadonlyArray<DatabaseStaffOrderSummary>;
  readonly stage: StaffOrderStageFilter;
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface DatabaseStaffOrderDetail {
  readonly actions: {
    readonly canCancel: boolean;
    readonly primary: {
      readonly kind: Exclude<StaffOrderAction, "cancel">;
      readonly label: "开始制作" | "标记待取" | "完成订单";
    } | null;
  };
  readonly coupon: DatabaseCustomerOrderDetail["coupon"];
  readonly currentTime: Date;
  readonly events: DatabaseCustomerOrderDetail["events"];
  readonly growth: {
    readonly finalSimulatedAmountCents: number;
    readonly growthPoints: number;
  } | null;
  readonly inventory: ReadonlyArray<{
    readonly inventoryItemId: string;
    readonly onHandQuantity: number;
    readonly productId: string;
    readonly quantity: number;
    readonly reservationStatus: "active" | "released" | "sold" | "wasted";
  }>;
  readonly order: DatabaseStaffOrderSummary;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: Date;
    readonly reason: string;
    readonly simulated: true;
  } | null;
  readonly snapshot: CustomerOrderSnapshot;
}

export interface DatabaseStaffOrderCommand {
  readonly action: StaffOrderAction;
  readonly couponRestored: boolean;
  readonly growthPoints: number;
  readonly inventoryEffect: "release" | "retain" | "sale" | "waste";
  readonly occurredAt: Date;
  readonly orderId: string;
  readonly replayed: boolean;
  readonly simulatedRefundCents: number;
  readonly status: CustomerOrderStatus;
}

export interface DatabaseStaffReservationSummary {
  readonly anomaly: {
    readonly code: "seat-maintenance";
    readonly label: string;
  } | null;
  readonly area: { readonly code: string; readonly displayName: string };
  readonly arrivalWindow: {
    readonly closesAt: Date;
    readonly opensAt: Date;
  };
  readonly customer: { readonly displayName: string };
  readonly machineProfile: {
    readonly code: MachineProfileCode;
    readonly displayName: string;
  };
  readonly payableCents: number;
  readonly reservationId: string;
  readonly seat: { readonly code: string };
  readonly status: ReservationStatus;
  readonly window: { readonly endsAt: Date; readonly startsAt: Date };
}

export interface DatabaseStaffReservationWorkbench {
  readonly businessDay: {
    readonly endsAt: Date;
    readonly key: string;
    readonly startsAt: Date;
  };
  readonly currentTime: Date;
  readonly queues: {
    readonly anomalies: ReadonlyArray<DatabaseStaffReservationSummary>;
    readonly arrivalWindow: ReadonlyArray<DatabaseStaffReservationSummary>;
    readonly arrived: ReadonlyArray<DatabaseStaffReservationSummary>;
    readonly inUse: ReadonlyArray<DatabaseStaffReservationSummary>;
  };
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface DatabaseStaffReservationList {
  readonly businessDay: DatabaseStaffReservationWorkbench["businessDay"];
  readonly currentTime: Date;
  readonly filterOptions: {
    readonly areas: ReadonlyArray<{
      readonly code: string;
      readonly displayName: string;
    }>;
    readonly machineProfiles: ReadonlyArray<{
      readonly code: MachineProfileCode;
      readonly displayName: string;
    }>;
  };
  readonly rows: ReadonlyArray<DatabaseStaffReservationSummary>;
  readonly store: DatabaseStaffReservationWorkbench["store"];
}

export interface DatabaseStaffReservationDetail {
  readonly actions: {
    readonly canCancel: boolean;
    readonly primary: {
      readonly kind: Exclude<FrontlineReservationAction, "cancel">;
      readonly label: "办理到店" | "开始使用" | "提前结束";
      readonly requiresReason: boolean;
    } | null;
  };
  readonly arrivedAt: Date | null;
  readonly auditAvailable: boolean;
  readonly cancelledAt: Date | null;
  readonly completedAt: Date | null;
  readonly currentTime: Date;
  readonly events: DatabaseCustomerReservationDetail["events"];
  readonly refund: DatabaseCustomerReservationDetail["refund"];
  readonly related: DatabaseCustomerReservationDetail["related"];
  readonly reservation: DatabaseStaffReservationSummary;
  readonly snapshot: DatabaseCustomerPendingReservation["snapshot"];
  readonly startedAt: Date | null;
  readonly terminalReason: string | null;
}

export interface DatabaseStaffReservationCommand {
  readonly action: FrontlineReservationAction;
  readonly occurredAt: Date;
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly status: ReservationStatus;
}

export interface ReadCurrentRoleContextInput {
  sandboxId: string;
  claimRole?: PublicRole;
  fence?: {
    contextVersion: number;
    personaId: string;
    requestId: string;
    role: PublicRole;
  };
}

export interface SwitchRoleContextInput extends ReadRoleContextInput {
  targetRole: PublicRole;
  requestId: string;
}

export interface RecordRoleContextDenialInput extends ReadRoleContextInput {
  action?: "role_capability.check" | "role_context.write";
  objectId?: string | null;
  objectType?: "demo_persona" | "role_context" | "sandbox" | "store";
  requestId: string;
  reason:
    | "capability_denied"
    | "context_version_stale"
    | "csrf_context_mismatch"
    | "forged_context_fields"
    | "invalid_origin";
  storeId: string | null;
}

export interface DatabaseRoleContext {
  sandboxId: string;
  schemaVersion: string;
  seedVersion: string;
  expiresAt: Date;
  businessClock: DatabaseBusinessClock;
  contextVersion: number;
  role: PublicRole;
  persona: {
    id: string;
    displayName: string;
    protected: true;
    scope: string;
    storeId: string | null;
  };
  storeScope: {
    kind: "customer" | "store" | "all-stores";
    stores: Array<{
      id: string;
      code: string;
      displayName: string;
    }>;
  };
}

export interface PublicSandboxDatabase extends SandboxDemoToolMethods {
  cancelCustomerOrder(
    input: CancelCustomerOrderInput,
  ): Promise<DatabaseCustomerOrderCancellation>;
  cancelCustomerReservation(
    input: CancelCustomerReservationInput,
  ): Promise<DatabaseCustomerReservationCancellation>;
  create(input: CreatePublicSandboxInput): Promise<PublicSandboxResult>;
  executeStaffReservationCommand(
    input: ExecuteStaffReservationCommandInput,
  ): Promise<DatabaseStaffReservationCommand>;
  executeStaffOrderCommand(
    input: ExecuteStaffOrderCommandInput,
  ): Promise<DatabaseStaffOrderCommand>;
  createCustomerPendingReservation(
    input: CreateCustomerPendingReservationInput,
  ): Promise<DatabaseCustomerPendingReservation>;
  createCustomerPendingOrder(
    input: CreateCustomerPendingOrderInput,
  ): Promise<DatabaseCustomerPendingOrder>;
  simulateCustomerOrderPayment(
    input: SimulateCustomerOrderPaymentInput,
  ): Promise<DatabaseCustomerOrderPayment>;
  simulateCustomerReservationPayment(
    input: SimulateCustomerReservationPaymentInput,
  ): Promise<DatabaseCustomerReservationPayment>;
  readCurrentRoleContext(
    input: ReadCurrentRoleContextInput,
  ): Promise<DatabaseRoleContext>;
  readStaffReservationDetail(
    input: ReadStaffReservationDetailInput,
  ): Promise<DatabaseStaffReservationDetail>;
  readStaffReservationList(
    input: ReadStaffReservationListInput,
  ): Promise<DatabaseStaffReservationList>;
  readStaffReservationWorkbench(
    input: ReadStaffReservationWorkbenchInput,
  ): Promise<DatabaseStaffReservationWorkbench>;
  readStaffOrderDetail(
    input: ReadStaffOrderDetailInput,
  ): Promise<DatabaseStaffOrderDetail>;
  readStaffOrderQueue(
    input: ReadStaffOrderQueueInput,
  ): Promise<DatabaseStaffOrderQueue>;
  readCustomerSeatAvailability(
    input: ReadCustomerSeatAvailabilityInput,
  ): Promise<DatabaseCustomerSeatAvailability>;
  readCustomerReservationDetail(
    input: ReadCustomerReservationDetailInput,
  ): Promise<DatabaseCustomerReservationDetail>;
  readCustomerOrderCatalog(
    input: ReadCustomerOrderCatalogInput,
  ): Promise<DatabaseCustomerOrderCatalog>;
  readCustomerOrderDetail(
    input: ReadCustomerOrderDetailInput,
  ): Promise<DatabaseCustomerOrderDetail>;
  readCustomerMembership(
    input: CustomerBrowseContextInput,
  ): Promise<DatabaseCustomerMembership>;
  readCustomerJourney(
    input: CustomerBrowseContextInput,
  ): Promise<DatabaseCustomerJourney>;
  readCustomerStoreCatalog(
    input: CustomerBrowseContextInput,
  ): Promise<DatabaseCustomerStoreCatalog>;
  readRoleContext(input: ReadRoleContextInput): Promise<DatabaseRoleContext>;
  switchRoleContext(
    input: SwitchRoleContextInput,
  ): Promise<DatabaseRoleContext>;
  recordRoleContextDenial(input: RecordRoleContextDenialInput): Promise<void>;
  close(): Promise<void>;
}

export interface PublicSandboxDatabaseOptions {
  readonly dueHandlers?: DemoTimeDueHandlerRegistry;
  readonly wallClock?: WallClock;
}

const storeSeeds = publicSandboxSeed.stores;
const personaSeeds = publicSandboxSeed.personas;
const productSeeds = [
  {
    category: "drink",
    code: "pulse-sparkling-water",
    description: "低糖 · 冰柜取用",
    name: "脉冲气泡水",
  },
  {
    category: "snack",
    code: "night-voyage-chips",
    description: "海盐味 · 柜台取货",
    name: "夜航薯片",
  },
  {
    category: "meal",
    code: "heatwave-noodles",
    description: "微辣 · 柜台冲泡",
    name: "热浪杯面",
  },
  {
    category: "snack",
    code: "jump-energy-bar",
    description: "可可味 · 独立包装",
    name: "跃迁能量棒",
  },
  {
    category: "supply",
    code: "peripheral-wipe",
    description: "单片装 · 无香型",
    name: "外设清洁湿巾",
  },
  {
    category: "supply",
    code: "wake-mint",
    description: "小盒装 · 无糖",
    name: "清醒薄荷糖",
  },
  {
    category: "drink",
    code: "midnight-iced-tea",
    description: "无糖茶饮 · 冷藏取用",
    name: "午夜冰茶",
  },
  {
    category: "drink",
    code: "circuit-coffee",
    description: "轻焙咖啡 · 冷藏取用",
    name: "回路咖啡",
  },
  {
    category: "drink",
    code: "cloud-mineral-water",
    description: "常温或冷藏 · 瓶装",
    name: "云端矿泉水",
  },
  {
    category: "snack",
    code: "crisp-seaweed",
    description: "原味 · 独立包装",
    name: "脆浪海苔",
  },
  {
    category: "snack",
    code: "star-popcorn",
    description: "焦糖味 · 柜台取货",
    name: "星轨爆米花",
  },
  {
    category: "meal",
    code: "orbit-rice-roll",
    description: "菌菇风味 · 加热取用",
    name: "轨道饭团",
  },
] as const;

interface SandboxRow {
  id: string;
  schema_version: string;
  seed_version: string;
  expires_at: Date;
  business_time_anchor_at: Date;
  business_time_anchor_wall_at: Date;
  business_time_advance_ms: number;
  invalidated_at: Date | null;
  role_context_role: PublicRole | null;
  role_context_version: number;
}

const SANDBOX_ROW_COLUMNS = `id, schema_version, seed_version, expires_at,
  invalidated_at, role_context_role, role_context_version,
  business_time_anchor_at, business_time_anchor_wall_at,
  business_time_advance_ms`;

interface PersonaRow {
  id: string;
  display_name: string;
  protected: boolean;
  role: PublicRole;
  scope: string;
  store_id: string | null;
}

interface OperatorRow {
  display_name: string;
  city: string;
}

interface StoreRow {
  id: string;
  code: string;
  display_name: string;
  seat_count: number;
  opens_at: string;
  closes_at: string;
  closes_next_day: boolean;
  is_open_24_hours: boolean;
}

interface AreaCatalogRow {
  code: string;
  display_name: string;
  seat_count: number;
  store_id: string;
}

interface MachineCatalogRow {
  base_hourly_cents: number;
  code: MachineProfileCode;
  display_name: string;
  experience_description: string;
  seat_count: number;
  store_id: string;
}

interface AreaSelectionRow {
  code: string;
  display_name: string;
  id: string;
}

interface MachineSelectionRow {
  base_hourly_cents: number;
  code: MachineProfileCode;
  display_name: string;
  experience_description: string;
  id: string;
}

interface SeatBrowseRow {
  code: string;
  id: string;
  operational_status: "maintenance" | "normal";
}

interface ReservationBrowseRow {
  ends_at: Date;
  seat_id: string;
  starts_at: Date;
  status: "arrived" | "confirmed" | "in-use" | "pending-confirmation";
}

interface ExperienceCouponRow {
  business_kind: "order" | "reservation";
  code: string;
  discount_cents: number;
  display_name: string;
  eligible_end_minutes: number;
  eligible_start_minutes: number;
  id: string;
  minimum_spend_cents: number;
  status: "available" | "expired" | "redeemed" | "reserved";
  store_code: string | null;
  valid_from: Date;
  valid_until: Date;
}

interface MembershipCouponRow extends ExperienceCouponRow {
  order_id: string | null;
  order_store_display_name: string | null;
  order_status: CustomerOrderStatus | null;
  reserved_order_id: string | null;
  reserved_reservation_id: string | null;
  reservation_id: string | null;
  reservation_status: ReservationStatus | null;
  store_display_name: string | null;
}

interface MembershipProfileRow {
  customer_display_name: string;
  growth_points: number;
  id: string;
}

interface MembershipGrowthEventRow {
  business_occurred_at: Date;
  final_simulated_amount_cents: number;
  growth_points: number;
  id: string;
  source_id: string | null;
  source_kind: "order" | "reservation" | "seed-baseline";
  store_display_name: string | null;
}

interface CustomerJourneyRow {
  growth_points: number | null;
  id: string;
  price_snapshot: ReservationSnapshotRecord;
  refund_amount_cents: number | null;
  refund_reason: string | null;
  status: ReservationStatus;
  terminal_reason: string | null;
}

interface ReservationSnapshotRecord {
  area: { code: string; displayName: string };
  coupon: {
    code: string;
    discountCents: number;
    displayName: string;
  } | null;
  machineProfile: {
    code: MachineProfileCode;
    displayName: string;
    experienceDescription: string;
  };
  price: {
    discountCents: number;
    payableCents: number;
    segments: Array<{
      amountCents: number;
      endsAt: string;
      multiplierBasisPoints: number;
      rule: ReservationPriceRule;
      startsAt: string;
    }>;
    subtotalCents: number;
  };
  seat: { code: string };
  store: { code: string; displayName: string };
  window: { endsAt: string; startsAt: string };
}

interface PendingReservationRow {
  hold_expires_at: Date;
  id: string;
  price_snapshot: ReservationSnapshotRecord;
  status: "pending-confirmation";
}

interface CustomerReservationDetailRow {
  cancelled_business_at: Date | null;
  confirmed_business_at: Date | null;
  coupon_status: "available" | "expired" | "redeemed" | "reserved" | null;
  expired_business_at: Date | null;
  hold_expires_at: Date | null;
  id: string;
  price_snapshot: ReservationSnapshotRecord | null;
  refund_amount_cents: number | null;
  refund_business_occurred_at: Date | null;
  refund_reason: string | null;
  simulated_payment_cents: number | null;
  starts_at: Date;
  status: ReservationStatus;
  store_id: string;
  terminal_reason: string | null;
}

interface ReservationEventRow {
  business_occurred_at: Date;
  event_data: unknown;
  event_type: string;
}

interface ReservationLifecycleCommandRow {
  payload_hash: string;
  result_data: {
    payment: {
      amountCents: number;
      occurredAt: string;
      simulated: true;
    };
    reservationId: string;
    status: "confirmed";
  };
}

interface ReservationCancelCommandRow {
  payload_hash: string;
  result_data: {
    cancelledAt: string;
    couponRestored: boolean;
    refund: {
      amountCents: number;
      occurredAt: string;
      reason: "customer-cancelled-before-start";
      simulated: true;
    } | null;
    reservationId: string;
    status: "cancelled";
  };
}

interface StaffReservationRow {
  area_code: string;
  area_display_name: string;
  arrived_business_at: Date | null;
  cancelled_business_at: Date | null;
  completed_business_at: Date | null;
  customer_display_name: string;
  customer_persona_id: string;
  ends_at: Date;
  id: string;
  machine_profile_code: MachineProfileCode;
  machine_profile_display_name: string;
  price_snapshot: ReservationSnapshotRecord;
  refund_amount_cents: number | null;
  refund_business_occurred_at: Date | null;
  refund_reason: string | null;
  sandbox_id: string;
  seat_code: string;
  seat_operational_status: "maintenance" | "normal";
  starts_at: Date;
  started_business_at: Date | null;
  status: ReservationStatus;
  store_code: string;
  store_display_name: string;
  store_id: string;
  terminal_reason: string | null;
  hold_expires_at: Date | null;
  coupon_id: string | null;
}

interface FrontlineContext {
  readonly actorStoreId: string;
  readonly sandbox: SandboxRow;
}

interface FrontlineCommandRow {
  command_type: FrontlineReservationAction;
  payload_hash: string;
  result_data: {
    action: FrontlineReservationAction;
    occurredAt: string;
    reservationId: string;
    status: ReservationStatus;
  };
}

interface CreationRequestRow {
  payload_hash: string;
  sandbox_id: string;
  selected_role: PublicRole;
  visitor_key_hash: string | null;
}

interface OrderReservationContextRow {
  id: string;
  seat_code: string;
  seat_id: string;
  status: ReservationStatus;
  store_code: string;
  store_display_name: string;
  store_id: string;
}

interface OrderCatalogProductRow {
  available_quantity: number;
  category: DatabaseCustomerOrderCatalog["products"][number]["category"];
  description: string;
  id: string;
  inventory_item_id: string;
  low_stock_threshold: number;
  name: string;
  on_hand_quantity: number;
  reserved_quantity: number;
  unit_price_cents: number;
}

interface OrderCouponRow {
  business_kind: "order" | "reservation";
  code: string;
  discount_cents: number;
  display_name: string;
  eligible_end_minutes: number;
  eligible_start_minutes: number;
  id: string;
  minimum_spend_cents: number;
  status: "available" | "expired" | "redeemed" | "reserved";
  store_id: string | null;
  valid_from: Date;
  valid_until: Date;
}

interface CustomerOrderRow {
  cancelled_business_at: Date | null;
  coupon_status: "available" | "expired" | "redeemed" | "reserved" | null;
  expired_business_at: Date | null;
  hold_expires_at: Date;
  id: string;
  order_snapshot: CustomerOrderSnapshot;
  paid_business_at: Date | null;
  refund_amount_cents: number | null;
  refund_business_occurred_at: Date | null;
  refund_reason: string | null;
  reservation_status: ReservationStatus;
  simulated_payment_cents: number | null;
  status: CustomerOrderStatus;
  store_id: string;
  terminal_reason: string | null;
}

interface OrderInventoryDetailRow {
  on_hand_quantity: number;
  product_id: string;
  quantity: number;
  reserved_quantity: number;
}

interface OrderEventRow {
  business_occurred_at: Date;
  event_data: unknown;
  event_type: string;
}

interface RelatedOrderRow {
  id: string;
  label: string;
  status: CustomerOrderStatus;
}

async function readRelatedOrders(
  client: PoolClient,
  sandboxId: string,
  reservationId: string,
): Promise<ReadonlyArray<RelatedOrderRow>> {
  const result = await client.query<RelatedOrderRow>(
    `select orders.id, orders.status,
            coalesce(orders.order_snapshot->'lines'->0->>'productName',
              '柜台商品订单') as label
       from customer_orders orders
      where orders.sandbox_id = $1 and orders.reservation_id = $2
      order by orders.created_business_at, orders.id`,
    [sandboxId, reservationId],
  );
  return result.rows;
}

interface OrderCommandRow {
  payload_hash: string;
  result_data: {
    holdExpiresAt: string;
    orderId: string;
    snapshot: CustomerOrderSnapshot;
    status: "pending-simulated-payment";
  };
}

interface OrderPaymentCommandRow {
  payload_hash: string;
  result_data: {
    orderId: string;
    payment: {
      amountCents: number;
      doesNotCharge: true;
      occurredAt: string;
      simulated: true;
    };
    status: "simulated-paid";
  };
}

interface OrderCancelCommandRow {
  payload_hash: string;
  result_data: {
    cancelledAt: string;
    couponRestored: boolean;
    orderId: string;
    refund: {
      amountCents: number;
      occurredAt: string;
      reason: string;
      simulated: true;
    } | null;
    status: "cancelled";
  };
}

interface StaffOrderRow {
  cancelled_business_at: Date | null;
  coupon_status: "available" | "expired" | "redeemed" | "reserved" | null;
  customer_persona_id: string;
  customer_display_name: string;
  id: string;
  order_snapshot: CustomerOrderSnapshot;
  paid_business_at: Date | null;
  preparing_business_at: Date | null;
  ready_business_at: Date | null;
  reservation_id: string;
  reservation_status: ReservationStatus;
  seat_code: string;
  status: CustomerOrderStatus;
  store_id: string;
}

interface StaffOrderInventoryRow {
  inventory_item_id: string;
  on_hand_quantity: number;
  product_id: string;
  quantity: number;
  status: "active" | "released" | "sold" | "wasted";
}

interface StaffOrderCommandRow {
  payload_hash: string;
  result_data: {
    action: StaffOrderAction;
    couponRestored: boolean;
    growthPoints: number;
    inventoryEffect: "release" | "retain" | "sale" | "waste";
    occurredAt: string;
    orderId: string;
    simulatedRefundCents: number;
    status: CustomerOrderStatus;
  };
}

function pendingOrderFromStored(
  value: OrderCommandRow["result_data"],
  replayed: boolean,
): DatabaseCustomerPendingOrder {
  return {
    ...value,
    holdExpiresAt: new Date(value.holdExpiresAt),
    replayed,
  };
}

function orderPaymentFromStored(
  value: OrderPaymentCommandRow["result_data"],
  replayed: boolean,
): DatabaseCustomerOrderPayment {
  return {
    ...value,
    payment: {
      ...value.payment,
      occurredAt: new Date(value.payment.occurredAt),
    },
    replayed,
  };
}

function orderCancellationFromStored(
  value: OrderCancelCommandRow["result_data"],
  replayed: boolean,
): DatabaseCustomerOrderCancellation {
  return {
    ...value,
    cancelledAt: new Date(value.cancelledAt),
    refund: value.refund
      ? { ...value.refund, occurredAt: new Date(value.refund.occurredAt) }
      : null,
    replayed,
  };
}

const orderClockFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: SANDBOX_BUSINESS_TIME_ZONE,
});

function orderClockMinutes(value: Date): number {
  const parts = Object.fromEntries(
    orderClockFormatter
      .formatToParts(value)
      .filter((part) => part.type === "hour" || part.type === "minute")
      .map((part) => [part.type, Number(part.value)]),
  );
  return (parts.hour ?? 0) * 60 + (parts.minute ?? 0);
}

function orderCouponAvailability(
  coupon: OrderCouponRow,
  input: { currentTime: Date; storeId: string; subtotalCents?: number },
): DatabaseCustomerOrderCatalog["coupons"][number]["eligibility"] {
  const status = deriveExperienceCouponStatus({
    now: input.currentTime,
    status: coupon.status,
    validUntil: coupon.valid_until,
  });
  if (
    coupon.business_kind !== "order" ||
    status !== "available" ||
    input.currentTime < coupon.valid_from ||
    (coupon.store_id !== null && coupon.store_id !== input.storeId)
  ) {
    return { reason: "unavailable", status: "ineligible" };
  }
  const minutes = orderClockMinutes(input.currentTime);
  if (
    minutes < coupon.eligible_start_minutes ||
    minutes >= coupon.eligible_end_minutes
  ) {
    return { reason: "time-window", status: "ineligible" };
  }
  if (
    input.subtotalCents !== undefined &&
    input.subtotalCents < coupon.minimum_spend_cents
  ) {
    return { reason: "minimum-spend", status: "ineligible" };
  }
  return { status: "eligible" };
}

async function readEligibleOrderReservation(
  client: PoolClient,
  input: ReadCustomerOrderCatalogInput,
  lock = false,
): Promise<OrderReservationContextRow> {
  const result = await client.query<OrderReservationContextRow>(
    `select reservation.id, reservation.store_id, reservation.seat_id,
            reservation.status, store.code as store_code,
            store.display_name as store_display_name, seat.code as seat_code
       from reservations reservation
       join stores store on store.id = reservation.store_id
       join seats seat on seat.id = reservation.seat_id
      where reservation.sandbox_id = $1
        and reservation.customer_persona_id = $2
        and reservation.id = $3${lock ? " for update of reservation" : ""}`,
    [input.sandboxId, input.personaId, input.reservationId],
  );
  const row = result.rows[0];
  if (!row || (row.status !== "arrived" && row.status !== "in-use")) {
    throw new CustomerOrderConflictError("reservation-ineligible", row?.status);
  }
  return row;
}

async function releaseOrderHold(
  client: PoolClient,
  input: {
    businessTime: Date;
    eventType: string;
    nextStatus: "cancelled" | "expired";
    expectedStatus?: "pending-simulated-payment" | "simulated-paid";
    orderId: string;
    reason: string;
    recordedAt: Date;
    sandboxId: string;
  },
): Promise<boolean> {
  const released = await client.query(
    `update inventory_items item
        set reserved_quantity = item.reserved_quantity - hold.quantity
       from order_inventory_reservations hold
      where hold.sandbox_id = $1 and hold.order_id = $2
        and hold.status = 'active' and item.id = hold.inventory_item_id`,
    [input.sandboxId, input.orderId],
  );
  await client.query(
    `update order_inventory_reservations
        set status = 'released', released_business_at = $3
      where sandbox_id = $1 and order_id = $2 and status = 'active'`,
    [input.sandboxId, input.orderId, input.businessTime],
  );
  const coupon = await client.query(
    `update experience_coupons
        set status = 'available', reserved_order_id = null, reserved_until = null
      where sandbox_id = $1 and reserved_order_id = $2
        and status in ('reserved', 'redeemed')`,
    [input.sandboxId, input.orderId],
  );
  const updated = await client.query(
    `update customer_orders
        set status = $3::text,
            cancelled_business_at = case when $3::text = 'cancelled' then $4::timestamptz else null end,
            expired_business_at = case when $3::text = 'expired' then $4::timestamptz else null end,
            terminal_reason = $5
      where sandbox_id = $1 and id = $2 and status = $6`,
    [
      input.sandboxId,
      input.orderId,
      input.nextStatus,
      input.businessTime,
      input.reason,
      input.expectedStatus ?? "pending-simulated-payment",
    ],
  );
  if (updated.rowCount === 1) {
    await client.query(
      `insert into order_business_events (
         id, sandbox_id, order_id, event_type, event_data,
         business_occurred_at, recorded_at
       ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        randomUUID(),
        input.sandboxId,
        input.orderId,
        input.eventType,
        JSON.stringify({
          couponRestored: coupon.rowCount === 1,
          inventoryReservationCount: released.rowCount ?? 0,
          reason: input.reason,
        }),
        input.businessTime,
        input.recordedAt,
      ],
    );
  }
  return updated.rowCount === 1;
}

async function processCustomerOrderDeadlines(
  client: PoolClient,
  input: {
    orderId?: string;
    recordedAt: Date;
    reservationId?: string;
    sandboxId: string;
    targetBusinessTime: Date;
  },
): Promise<number> {
  const due = await client.query<{
    hold_expires_at: Date;
    id: string;
    reservation_status: ReservationStatus;
  }>(
    `select orders.id, orders.hold_expires_at,
            reservation.status as reservation_status
       from customer_orders orders
       join reservations reservation on reservation.id = orders.reservation_id
      where orders.sandbox_id = $1
        and orders.status = 'pending-simulated-payment'
        and (orders.hold_expires_at <= $2
          or reservation.status in ('completed', 'cancelled', 'expired'))
        and ($3::uuid is null or orders.id = $3)
        and ($4::uuid is null or orders.reservation_id = $4)
      order by orders.hold_expires_at, orders.id
      for update of orders skip locked`,
    [
      input.sandboxId,
      input.targetBusinessTime,
      input.orderId ?? null,
      input.reservationId ?? null,
    ],
  );
  let processed = 0;
  for (const order of due.rows) {
    const reservationTerminal = ["completed", "cancelled", "expired"].includes(
      order.reservation_status,
    );
    const changed = await releaseOrderHold(client, {
      businessTime: reservationTerminal
        ? input.targetBusinessTime
        : order.hold_expires_at,
      eventType: reservationTerminal
        ? "order.cancelled-by-reservation"
        : "order.pending-expired",
      nextStatus: reservationTerminal ? "cancelled" : "expired",
      orderId: order.id,
      reason: reservationTerminal
        ? "related-reservation-terminal-before-payment"
        : "pending-payment-timeout",
      recordedAt: input.recordedAt,
      sandboxId: input.sandboxId,
    });
    if (changed) processed += 1;
  }
  return processed;
}

async function countDueCustomerOrders(
  client: PoolClient,
  input: {
    currentBusinessTime: Date;
    sandboxId: string;
    targetBusinessTime: Date;
  },
): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from customer_orders
      where sandbox_id = $1 and status = 'pending-simulated-payment'
        and hold_expires_at > $2 and hold_expires_at <= $3`,
    [input.sandboxId, input.currentBusinessTime, input.targetBusinessTime],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function nextCustomerOrderDeadline(
  client: PoolClient,
  input: { currentBusinessTime: Date; sandboxId: string },
): Promise<Date | null> {
  const result = await client.query<{ due_at: Date | null }>(
    `select min(hold_expires_at) as due_at from customer_orders
      where sandbox_id = $1 and status = 'pending-simulated-payment'
        and hold_expires_at > $2`,
    [input.sandboxId, input.currentBusinessTime],
  );
  return result.rows[0]?.due_at ?? null;
}

async function readCustomerOrderDetailWithClient(
  client: PoolClient,
  input: ReadCustomerOrderDetailInput,
  currentTime: Date,
  lock = false,
): Promise<{ detail: DatabaseCustomerOrderDetail; storeId: string }> {
  const result = await client.query<CustomerOrderRow>(
    `select orders.id, orders.store_id, orders.status,
            orders.hold_expires_at, orders.order_snapshot,
            orders.simulated_payment_cents, orders.paid_business_at,
            orders.cancelled_business_at, orders.expired_business_at,
            orders.terminal_reason, coupon.status as coupon_status,
            reservation.status as reservation_status,
            refund.amount_cents as refund_amount_cents,
            refund.business_occurred_at as refund_business_occurred_at,
            refund.reason as refund_reason
       from customer_orders orders
       join reservations reservation on reservation.id = orders.reservation_id
       left join experience_coupons coupon on coupon.id = orders.coupon_id
       left join order_simulated_refunds refund on refund.order_id = orders.id
      where orders.sandbox_id = $1
        and orders.customer_persona_id = $2 and orders.id = $3${lock ? " for update of orders" : ""}`,
    [input.sandboxId, input.personaId, input.orderId],
  );
  const row = result.rows[0];
  if (!row) throw new CustomerOrderConflictError("not-found");
  const inventory = await client.query<OrderInventoryDetailRow>(
    `select item.product_id, item.on_hand_quantity, item.reserved_quantity,
            hold.quantity
       from order_inventory_reservations hold
       join inventory_items item on item.id = hold.inventory_item_id
      where hold.sandbox_id = $1 and hold.order_id = $2
      order by item.code`,
    [input.sandboxId, input.orderId],
  );
  const events = await client.query<OrderEventRow>(
    `select event_type, event_data, business_occurred_at
       from order_business_events
      where sandbox_id = $1 and order_id = $2
      order by sequence`,
    [input.sandboxId, input.orderId],
  );
  const live =
    row.status === "pending-simulated-payment" &&
    currentTime.getTime() < row.hold_expires_at.getTime();
  const snapshot = row.order_snapshot;
  return {
    detail: {
      actions: {
        canCancel: live || row.status === "simulated-paid",
        canSimulatePayment: live,
      },
      cancelledAt: row.cancelled_business_at,
      coupon:
        snapshot.coupon && row.coupon_status
          ? { ...snapshot.coupon, status: row.coupon_status }
          : null,
      currentTime,
      events: events.rows.map((event) => ({
        data: event.event_data,
        occurredAt: event.business_occurred_at,
        type: event.event_type,
      })),
      expiredAt: row.expired_business_at,
      holdExpiresAt: row.hold_expires_at,
      inventory: inventory.rows.map((item) => ({
        availableQuantity: item.on_hand_quantity - item.reserved_quantity,
        onHandQuantity: item.on_hand_quantity,
        productId: item.product_id,
        reservedForOrderQuantity: item.quantity,
        reservedQuantity: item.reserved_quantity,
      })),
      orderId: row.id,
      payment:
        row.simulated_payment_cents !== null && row.paid_business_at
          ? {
              amountCents: row.simulated_payment_cents,
              doesNotCharge: true,
              occurredAt: row.paid_business_at,
              simulated: true,
            }
          : null,
      refund:
        row.refund_amount_cents !== null &&
        row.refund_business_occurred_at &&
        row.refund_reason
          ? {
              amountCents: row.refund_amount_cents,
              occurredAt: row.refund_business_occurred_at,
              reason: row.refund_reason,
              simulated: true,
            }
          : null,
      snapshot,
      status: row.status,
      terminalReason: row.terminal_reason,
    },
    storeId: row.store_id,
  };
}

async function recordCustomerOrderDenial(
  client: PoolClient,
  input: {
    readonly action: string;
    readonly businessTime: Date;
    readonly currentStatus: CustomerOrderStatus;
    readonly orderId: string;
    readonly personaId: string;
    readonly reason: string;
    readonly recordedAt: Date;
    readonly requestId: string;
    readonly sandboxId: string;
    readonly storeId: string;
  },
) {
  await client.query(
    `insert into audit_events (
       id, sandbox_id, store_id, persona_id, role, action, object_type,
       object_id, result, reason, request_id, before_data, after_data,
       business_occurred_at, recorded_at
     ) values ($1, $2, $3, $4, 'customer', $5, 'order', $6, 'denied', $7,
       $8, $9::jsonb, $10::jsonb, $11, $12)`,
    [
      randomUUID(),
      input.sandboxId,
      input.storeId,
      input.personaId,
      input.action,
      input.orderId,
      input.reason,
      input.requestId,
      JSON.stringify({ status: input.currentStatus }),
      JSON.stringify({ status: input.currentStatus }),
      input.businessTime,
      input.recordedAt,
    ],
  );
}

function formatBusinessHours(store: StoreRow): string {
  if (store.is_open_24_hours) return "24 小时";

  const opensAt = store.opens_at.slice(0, 5);
  const closesAt =
    store.closes_at === "00:00:00" ? "24:00" : store.closes_at.slice(0, 5);
  return `${opensAt}–${store.closes_next_day ? "次日 " : ""}${closesAt}`;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function reservationSnapshot(
  value: ReservationSnapshotRecord,
): DatabaseCustomerPendingReservation["snapshot"] {
  return {
    ...value,
    price: {
      ...value.price,
      segments: value.price.segments.map((segment) => ({
        ...segment,
        endsAt: new Date(segment.endsAt),
        startsAt: new Date(segment.startsAt),
      })),
    },
    window: {
      endsAt: new Date(value.window.endsAt),
      startsAt: new Date(value.window.startsAt),
    },
  };
}

function pendingReservationResult(
  row: PendingReservationRow,
  replayed: boolean,
): DatabaseCustomerPendingReservation {
  return {
    holdExpiresAt: row.hold_expires_at,
    replayed,
    reservationId: row.id,
    snapshot: reservationSnapshot(row.price_snapshot),
    status: row.status,
  };
}

async function readCustomerReservationDetailWithClient(
  client: PoolClient,
  input: ReadCustomerReservationDetailInput,
  currentTime: Date,
  lock = false,
): Promise<{ detail: DatabaseCustomerReservationDetail; storeId: string }> {
  const result = await client.query<CustomerReservationDetailRow>(
    `select reservation.id, reservation.store_id, reservation.status,
            reservation.starts_at, reservation.hold_expires_at,
            reservation.price_snapshot, reservation.simulated_payment_cents,
            reservation.confirmed_business_at,
            reservation.cancelled_business_at,
            reservation.expired_business_at, reservation.terminal_reason,
            coupon.status as coupon_status,
            refund.amount_cents as refund_amount_cents,
            refund.reason as refund_reason,
            refund.business_occurred_at as refund_business_occurred_at
       from reservations reservation
       left join experience_coupons coupon on coupon.id = reservation.coupon_id
       left join reservation_simulated_refunds refund
         on refund.reservation_id = reservation.id
      where reservation.sandbox_id = $1
        and reservation.customer_persona_id = $2
        and reservation.id = $3${lock ? " for update of reservation" : ""}`,
    [input.sandboxId, input.personaId, input.reservationId],
  );
  const row = result.rows[0];
  if (!row || !row.price_snapshot) {
    throw new CustomerReservationLifecycleConflictError("not-found");
  }
  const events = await client.query<ReservationEventRow>(
    `select event_type, event_data, business_occurred_at
      from reservation_business_events
      where sandbox_id = $1 and reservation_id = $2
      order by sequence`,
    [input.sandboxId, input.reservationId],
  );
  const snapshot = reservationSnapshot(row.price_snapshot);
  const relatedOrders = await readRelatedOrders(
    client,
    input.sandboxId,
    input.reservationId,
  );
  const pendingIsLive =
    row.status === "pending-confirmation" &&
    row.hold_expires_at !== null &&
    currentTime.getTime() < row.hold_expires_at.getTime();
  const confirmedCanCancel =
    row.status === "confirmed" &&
    currentTime.getTime() < row.starts_at.getTime();
  const detail: DatabaseCustomerReservationDetail = {
    actions: {
      canCancel: pendingIsLive || confirmedCanCancel,
      canSimulatePayment: pendingIsLive,
    },
    arrivalWindow: {
      closesAt: new Date(row.starts_at.getTime() + 15 * 60 * 1_000),
      opensAt: new Date(row.starts_at.getTime() - 30 * 60 * 1_000),
    },
    cancelledAt: row.cancelled_business_at,
    confirmedAt: row.confirmed_business_at,
    coupon:
      snapshot.coupon && row.coupon_status
        ? { ...snapshot.coupon, status: row.coupon_status }
        : null,
    currentTime,
    events: events.rows.map((event) => ({
      data: event.event_data,
      occurredAt: event.business_occurred_at,
      type: event.event_type,
    })),
    expiredAt: row.expired_business_at,
    holdExpiresAt: row.hold_expires_at,
    payment:
      row.simulated_payment_cents !== null && row.confirmed_business_at
        ? {
            amountCents: row.simulated_payment_cents,
            occurredAt: row.confirmed_business_at,
            simulated: true,
          }
        : null,
    refund:
      row.refund_amount_cents !== null &&
      row.refund_business_occurred_at &&
      row.refund_reason
        ? {
            amountCents: row.refund_amount_cents,
            occurredAt: row.refund_business_occurred_at,
            reason: row.refund_reason,
            simulated: true,
          }
        : null,
    related: { orders: relatedOrders, repairs: [] },
    reservationId: row.id,
    snapshot,
    status: row.status,
    terminalReason: row.terminal_reason,
  };
  return { detail, storeId: row.store_id };
}

function paymentFromStored(
  value: ReservationLifecycleCommandRow["result_data"],
  replayed: boolean,
): DatabaseCustomerReservationPayment {
  return {
    ...value,
    payment: {
      ...value.payment,
      occurredAt: new Date(value.payment.occurredAt),
    },
    replayed,
  };
}

function cancellationFromStored(
  value: ReservationCancelCommandRow["result_data"],
  replayed: boolean,
): DatabaseCustomerReservationCancellation {
  return {
    ...value,
    cancelledAt: new Date(value.cancelledAt),
    refund: value.refund
      ? { ...value.refund, occurredAt: new Date(value.refund.occurredAt) }
      : null,
    replayed,
  };
}

async function recordReservationLifecycleDenial(
  client: PoolClient,
  input: {
    action: "reservation.cancel" | "reservation.simulate-payment";
    businessTime: Date;
    currentStatus: ReservationStatus;
    personaId: string;
    reason: CustomerReservationLifecycleConflictError["reason"];
    recordedAt: Date;
    requestId: string;
    reservationId: string;
    sandboxId: string;
    storeId: string;
  },
): Promise<void> {
  await client.query(
    `insert into audit_events (
       id, sandbox_id, store_id, persona_id, role, action, object_type,
       object_id, result, reason, request_id, before_data, after_data,
       business_occurred_at, recorded_at
     ) values ($1, $2, $3, $4, 'customer', $5, 'reservation', $6,
       'denied', $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
    [
      randomUUID(),
      input.sandboxId,
      input.storeId,
      input.personaId,
      input.action,
      input.reservationId,
      input.reason,
      input.requestId,
      JSON.stringify({ status: input.currentStatus }),
      JSON.stringify({ status: input.currentStatus }),
      input.businessTime,
      input.recordedAt,
    ],
  );
}

type ReservationExpiryKind = "no-show" | "pending";

interface DueReservationRow {
  coupon_id: string | null;
  customer_persona_id: string;
  due_at: Date;
  id: string;
  price_snapshot: ReservationSnapshotRecord;
  status: "confirmed" | "pending-confirmation";
  store_id: string;
}

function reservationExpiryDefinition(kind: ReservationExpiryKind) {
  return kind === "pending"
    ? {
        auditReason: "pending-confirmation-timeout",
        couponStatus: "reserved",
        eventType: "reservation.pending-expired",
        status: "pending-confirmation",
        terminalReason: "pending-confirmation-timeout",
      }
    : {
        auditReason: "confirmed-no-show",
        couponStatus: "redeemed",
        eventType: "reservation.no-show-expired",
        status: "confirmed",
        terminalReason: "confirmed-no-show",
      };
}

function reservationDueExpression(kind: ReservationExpiryKind): string {
  return kind === "pending"
    ? "reservation.hold_expires_at"
    : "reservation.starts_at + interval '15 minutes'";
}

async function countDueReservationExpirations(
  client: PoolClient,
  input: {
    currentBusinessTime: Date;
    kind: ReservationExpiryKind;
    sandboxId: string;
    targetBusinessTime: Date;
  },
): Promise<number> {
  const definition = reservationExpiryDefinition(input.kind);
  const dueExpression = reservationDueExpression(input.kind);
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from reservations reservation
      where reservation.sandbox_id = $1 and reservation.status = $2
        and reservation.price_snapshot is not null
        and ${dueExpression} > $3 and ${dueExpression} <= $4`,
    [
      input.sandboxId,
      definition.status,
      input.currentBusinessTime,
      input.targetBusinessTime,
    ],
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function nextReservationExpiration(
  client: PoolClient,
  input: {
    currentBusinessTime: Date;
    kind: ReservationExpiryKind;
    sandboxId: string;
  },
): Promise<Date | null> {
  const definition = reservationExpiryDefinition(input.kind);
  const dueExpression = reservationDueExpression(input.kind);
  const result = await client.query<{ due_at: Date | null }>(
    `select min(${dueExpression}) as due_at from reservations reservation
      where reservation.sandbox_id = $1 and reservation.status = $2
        and reservation.price_snapshot is not null
        and ${dueExpression} > $3`,
    [input.sandboxId, definition.status, input.currentBusinessTime],
  );
  return result.rows[0]?.due_at ?? null;
}

async function processDueReservationExpirations(
  client: PoolClient,
  input: {
    kind: ReservationExpiryKind;
    recordedAt: Date;
    reservationId?: string;
    sandboxId: string;
    targetBusinessTime: Date;
  },
): Promise<number> {
  const definition = reservationExpiryDefinition(input.kind);
  const dueExpression = reservationDueExpression(input.kind);
  const due = await client.query<DueReservationRow>(
    `select reservation.id, reservation.sandbox_id, reservation.store_id,
            reservation.customer_persona_id, reservation.status,
            reservation.coupon_id, reservation.price_snapshot,
            ${dueExpression} as due_at
       from reservations reservation
      where reservation.sandbox_id = $1 and reservation.status = $2
        and reservation.price_snapshot is not null
        and ${dueExpression} <= $3
        and ($4::uuid is null or reservation.id = $4)
      order by ${dueExpression}, reservation.id
      for update of reservation skip locked`,
    [
      input.sandboxId,
      definition.status,
      input.targetBusinessTime,
      input.reservationId ?? null,
    ],
  );

  for (const row of due.rows) {
    const snapshot = row.price_snapshot;
    const decision = decideReservationLifecycle({
      action: input.kind === "pending" ? "expire-hold" : "expire-no-show",
      businessTime: row.due_at,
      hasCoupon: row.coupon_id !== null,
      holdExpiresAt:
        input.kind === "pending" ? row.due_at : new Date(row.due_at),
      payableCents: snapshot.price.payableCents,
      startsAt: new Date(snapshot.window.startsAt),
      status: row.status,
    });
    if (decision.status !== "ready") {
      throw new Error("A due reservation did not have a legal expiry result.");
    }
    if (decision.couponEffect) {
      const restored = await client.query(
        `update experience_coupons
            set status = 'available', reserved_reservation_id = null,
                reserved_until = null
          where sandbox_id = $1 and id = $2 and reserved_reservation_id = $3
            and status = $4`,
        [input.sandboxId, row.coupon_id, row.id, definition.couponStatus],
      );
      if (restored.rowCount !== 1) {
        throw new Error("A due reservation coupon could not be restored.");
      }
    }
    if (input.kind === "no-show") {
      await client.query(
        `insert into reservation_simulated_refunds (
           id, sandbox_id, reservation_id, amount_cents, reason,
           business_occurred_at, recorded_at
         ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          input.sandboxId,
          row.id,
          decision.simulatedRefundCents,
          definition.terminalReason,
          row.due_at,
          input.recordedAt,
        ],
      );
    }
    await client.query(
      `update reservations
          set status = 'expired', expired_business_at = $3,
              terminal_reason = $4
        where sandbox_id = $1 and id = $2 and status = $5`,
      [
        input.sandboxId,
        row.id,
        row.due_at,
        definition.terminalReason,
        definition.status,
      ],
    );
    await processCustomerOrderDeadlines(client, {
      recordedAt: input.recordedAt,
      reservationId: row.id,
      sandboxId: input.sandboxId,
      targetBusinessTime: row.due_at,
    });
    await client.query(
      `insert into reservation_business_events (
         id, sandbox_id, reservation_id, event_type, event_data,
         business_occurred_at, recorded_at
       ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
      [
        randomUUID(),
        input.sandboxId,
        row.id,
        definition.eventType,
        JSON.stringify({
          couponRestored: row.coupon_id !== null,
          simulatedRefundCents: decision.simulatedRefundCents,
        }),
        row.due_at,
        input.recordedAt,
      ],
    );
    await client.query(
      `insert into audit_events (
         id, sandbox_id, store_id, persona_id, role, action, object_type,
         object_id, result, reason, request_id, before_data, after_data,
         business_occurred_at, recorded_at
       ) values ($1, $2, $3, $4, 'customer', 'reservation.expire',
         'reservation', $5, 'allowed', $6, $7, $8::jsonb, $9::jsonb,
         $10, $11)`,
      [
        randomUUID(),
        input.sandboxId,
        row.store_id,
        row.customer_persona_id,
        row.id,
        definition.auditReason,
        randomUUID(),
        JSON.stringify({ status: row.status }),
        JSON.stringify({
          simulatedRefundCents: decision.simulatedRefundCents,
          status: "expired",
        }),
        row.due_at,
        input.recordedAt,
      ],
    );
  }
  return due.rowCount ?? 0;
}

function reservationDueHandlers(): DemoTimeDueHandlerRegistry {
  return {
    "pending-reservation-expiration": {
      nextDueAt: (context) =>
        nextReservationExpiration(context.client, {
          currentBusinessTime: context.currentBusinessTime,
          kind: "pending",
          sandboxId: context.sandboxId,
        }),
      previewDue: (context) =>
        countDueReservationExpirations(context.client, {
          currentBusinessTime: context.currentBusinessTime,
          kind: "pending",
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        }),
      processDue: (context) =>
        processDueReservationExpirations(context.client, {
          kind: "pending",
          recordedAt: context.recordedAt,
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        }),
    },
    "pending-order-expiration": {
      nextDueAt: (context) =>
        nextCustomerOrderDeadline(context.client, {
          currentBusinessTime: context.currentBusinessTime,
          sandboxId: context.sandboxId,
        }),
      previewDue: (context) =>
        countDueCustomerOrders(context.client, {
          currentBusinessTime: context.currentBusinessTime,
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        }),
      processDue: (context) =>
        processCustomerOrderDeadlines(context.client, {
          recordedAt: context.recordedAt,
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        }),
    },
    "reservation-no-show": {
      nextDueAt: (context) =>
        nextReservationExpiration(context.client, {
          currentBusinessTime: context.currentBusinessTime,
          kind: "no-show",
          sandboxId: context.sandboxId,
        }),
      previewDue: (context) =>
        countDueReservationExpirations(context.client, {
          currentBusinessTime: context.currentBusinessTime,
          kind: "no-show",
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        }),
      processDue: (context) =>
        processDueReservationExpirations(context.client, {
          kind: "no-show",
          recordedAt: context.recordedAt,
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        }),
    },
    "reservation-auto-completion": {
      nextDueAt: async (context) => {
        const result = await context.client.query<{ due_at: Date | null }>(
          `select min(ends_at) as due_at from reservations
            where sandbox_id = $1 and status = 'in-use'
              and price_snapshot is not null and ends_at > $2`,
          [context.sandboxId, context.currentBusinessTime],
        );
        return result.rows[0]?.due_at ?? null;
      },
      previewDue: async (context) => {
        const result = await context.client.query<{ count: string }>(
          `select count(*)::text as count from reservations
            where sandbox_id = $1 and status = 'in-use'
              and price_snapshot is not null
              and ends_at > $2 and ends_at <= $3`,
          [
            context.sandboxId,
            context.currentBusinessTime,
            context.targetBusinessTime,
          ],
        );
        return Number(result.rows[0]?.count ?? 0);
      },
      processDue: (context) =>
        processDueReservationAutoCompletions(context.client, {
          recordedAt: context.recordedAt,
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        }),
    },
  };
}

async function awardCompletedReservationGrowth(
  client: PoolClient,
  input: {
    readonly businessOccurredAt: Date;
    readonly customerPersonaId: string;
    readonly payableCents: number;
    readonly recordedAt: Date;
    readonly reservationId: string;
    readonly sandboxId: string;
  },
): Promise<number> {
  const existing = await client.query<{ exists: boolean }>(
    `select exists(
       select 1 from member_growth_events
        where sandbox_id = $1 and customer_persona_id = $2
          and source_kind = 'reservation' and source_id = $3
     ) as exists`,
    [input.sandboxId, input.customerPersonaId, input.reservationId],
  );
  const refunds = await client.query<{ amount_cents: number }>(
    `select coalesce(sum(amount_cents), 0)::integer as amount_cents
       from reservation_simulated_refunds
      where sandbox_id = $1 and reservation_id = $2`,
    [input.sandboxId, input.reservationId],
  );
  const award = reservationGrowthAward({
    alreadyAwarded: existing.rows[0]?.exists ?? false,
    payableCents: input.payableCents,
    refundedCents: refunds.rows[0]?.amount_cents ?? 0,
    status: "completed",
  });
  if (!award) return 0;
  const profile = await client.query<{ id: string }>(
    `select id from member_profiles
      where sandbox_id = $1 and customer_persona_id = $2
      for update`,
    [input.sandboxId, input.customerPersonaId],
  );
  const profileId = profile.rows[0]?.id;
  if (!profileId) {
    throw new Error(
      "The completed reservation customer has no member profile.",
    );
  }
  const inserted = await client.query(
    `insert into member_growth_events (
       id, sandbox_id, member_profile_id, customer_persona_id, source_kind,
       source_id, final_simulated_amount_cents, growth_points,
       business_occurred_at, recorded_at
     ) values ($1, $2, $3, $4, 'reservation', $5, $6, $7, $8, $9)
     on conflict do nothing`,
    [
      randomUUID(),
      input.sandboxId,
      profileId,
      input.customerPersonaId,
      input.reservationId,
      award.finalSimulatedAmountCents,
      award.growthPoints,
      input.businessOccurredAt,
      input.recordedAt,
    ],
  );
  if (inserted.rowCount !== 1) return 0;
  await client.query(
    `update member_profiles set growth_points = growth_points + $3
      where sandbox_id = $1 and id = $2`,
    [input.sandboxId, profileId, award.growthPoints],
  );
  return award.growthPoints;
}

async function processDueReservationAutoCompletions(
  client: PoolClient,
  input: {
    readonly recordedAt: Date;
    readonly reservationId?: string;
    readonly sandboxId: string;
    readonly targetBusinessTime: Date;
  },
): Promise<number> {
  const due = await client.query<{
    customer_persona_id: string;
    ends_at: Date;
    id: string;
    price_snapshot: ReservationSnapshotRecord;
    store_id: string;
  }>(
    `select id, store_id, customer_persona_id, ends_at, price_snapshot
       from reservations
      where sandbox_id = $1 and status = 'in-use'
        and price_snapshot is not null and ends_at <= $2
        and ($3::uuid is null or id = $3)
      order by ends_at, id
      for update skip locked`,
    [input.sandboxId, input.targetBusinessTime, input.reservationId ?? null],
  );
  for (const row of due.rows) {
    const snapshot = row.price_snapshot;
    const decision = decideFrontlineReservationLifecycle({
      action: "complete-auto",
      businessTime: row.ends_at,
      endsAt: new Date(snapshot.window.endsAt),
      hasCoupon: snapshot.coupon !== null,
      holdExpiresAt: null,
      payableCents: snapshot.price.payableCents,
      startsAt: new Date(snapshot.window.startsAt),
      status: "in-use",
    });
    if (decision.status !== "ready") {
      throw new Error("A due in-use reservation could not be auto-completed.");
    }
    await client.query(
      `update reservations
          set status = 'completed', completed_business_at = $3,
              terminal_reason = 'planned-end-auto-completed'
        where sandbox_id = $1 and id = $2 and status = 'in-use'`,
      [input.sandboxId, row.id, row.ends_at],
    );
    await processCustomerOrderDeadlines(client, {
      recordedAt: input.recordedAt,
      reservationId: row.id,
      sandboxId: input.sandboxId,
      targetBusinessTime: row.ends_at,
    });
    const growthPoints = await awardCompletedReservationGrowth(client, {
      businessOccurredAt: row.ends_at,
      customerPersonaId: row.customer_persona_id,
      payableCents: snapshot.price.payableCents,
      recordedAt: input.recordedAt,
      reservationId: row.id,
      sandboxId: input.sandboxId,
    });
    await client.query(
      `insert into reservation_business_events (
         id, sandbox_id, reservation_id, event_type, event_data,
         business_occurred_at, recorded_at
       ) values ($1, $2, $3, 'reservation.auto-completed', $4::jsonb, $5, $6)`,
      [
        randomUUID(),
        input.sandboxId,
        row.id,
        JSON.stringify({ growthPoints, reason: "planned-end" }),
        row.ends_at,
        input.recordedAt,
      ],
    );
    await client.query(
      `insert into audit_events (
         id, sandbox_id, store_id, persona_id, role, action, object_type,
         object_id, result, reason, request_id, before_data, after_data,
         business_occurred_at, recorded_at
       ) values ($1, $2, $3, $4, 'customer', 'reservation.complete-auto',
         'reservation', $5, 'allowed', 'planned-end', $6, $7::jsonb,
         $8::jsonb, $9, $10)`,
      [
        randomUUID(),
        input.sandboxId,
        row.store_id,
        row.customer_persona_id,
        row.id,
        randomUUID(),
        JSON.stringify({ status: "in-use" }),
        JSON.stringify({ status: "completed" }),
        row.ends_at,
        input.recordedAt,
      ],
    );
  }
  return due.rowCount ?? 0;
}

function reservationCouponEligibility(input: {
  coupon: ExperienceCouponRow;
  endsAt: Date;
  now: Date;
  startsAt: Date;
  storeCode: string;
  subtotalCents: number;
}): ReservationCouponEligibility {
  return evaluateReservationCoupon({
    businessKind: "reservation",
    coupon: {
      businessKind: input.coupon.business_kind,
      discountCents: input.coupon.discount_cents,
      eligibleEndMinutes: input.coupon.eligible_end_minutes,
      eligibleStartMinutes: input.coupon.eligible_start_minutes,
      minimumSpendCents: input.coupon.minimum_spend_cents,
      status: input.coupon.status,
      storeCode: input.coupon.store_code,
      validFrom: input.coupon.valid_from,
      validUntil: input.coupon.valid_until,
    },
    endsAt: input.endsAt,
    now: input.now,
    startsAt: input.startsAt,
    storeCode: input.storeCode,
    subtotalCents: input.subtotalCents,
  });
}

function businessTimeForSandbox(sandbox: SandboxRow, wallTime: Date): Date {
  return sandboxBusinessTimeAt({
    advancedMilliseconds: sandbox.business_time_advance_ms,
    businessAnchor: sandbox.business_time_anchor_at,
    wallAnchor: sandbox.business_time_anchor_wall_at,
    wallTime,
  });
}

async function assertCustomerBrowseContext(
  client: PoolClient,
  input: CustomerBrowseContextInput,
  wallTime: Date,
): Promise<SandboxRow> {
  const sandbox = await client.query<SandboxRow>(
    `select ${SANDBOX_ROW_COLUMNS}
       from sandboxes where id = $1`,
    [input.sandboxId],
  );
  const sandboxRow = sandbox.rows[0];
  if (
    !sandboxRow ||
    sandboxRow.invalidated_at !== null ||
    sandboxRow.expires_at.getTime() <= wallTime.getTime()
  ) {
    throw new RoleContextUnavailableError();
  }
  if (
    input.role !== "customer" ||
    sandboxRow.role_context_role !== "customer" ||
    sandboxRow.role_context_version !== input.contextVersion
  ) {
    throw new RoleContextStaleError();
  }
  const persona = await client.query<{ id: string }>(
    `select id from demo_personas
      where sandbox_id = $1 and id = $2 and role = 'customer' and protected = true`,
    [input.sandboxId, input.personaId],
  );
  if (!persona.rows[0]) throw new RoleContextUnavailableError();
  return sandboxRow;
}

async function assertFrontlineContext(
  client: PoolClient,
  input: ReadStaffReservationWorkbenchInput,
  wallTime: Date,
): Promise<FrontlineContext> {
  const sandbox = await client.query<SandboxRow>(
    `select ${SANDBOX_ROW_COLUMNS}
       from sandboxes where id = $1`,
    [input.sandboxId],
  );
  const sandboxRow = sandbox.rows[0];
  if (
    !sandboxRow ||
    sandboxRow.invalidated_at !== null ||
    sandboxRow.expires_at.getTime() <= wallTime.getTime()
  ) {
    throw new RoleContextUnavailableError();
  }
  if (
    (input.role !== "staff" && input.role !== "manager") ||
    sandboxRow.role_context_role !== input.role ||
    sandboxRow.role_context_version !== input.contextVersion
  ) {
    throw new RoleContextStaleError();
  }
  const persona = await client.query<{ store_id: string | null }>(
    `select store_id from demo_personas
      where sandbox_id = $1 and id = $2 and role = $3 and protected = true`,
    [input.sandboxId, input.personaId, input.role],
  );
  const actorStoreId = persona.rows[0]?.store_id;
  if (!actorStoreId) throw new RoleContextUnavailableError();
  return { actorStoreId, sandbox: sandboxRow };
}

async function readStaffReservationRows(
  client: PoolClient,
  input: {
    readonly reservationId?: string;
    readonly sandboxId: string;
    readonly lock?: boolean;
  },
): Promise<ReadonlyArray<StaffReservationRow>> {
  const result = await client.query<StaffReservationRow>(
    `select reservation.id, reservation.sandbox_id, reservation.store_id,
            reservation.customer_persona_id, reservation.status,
            reservation.starts_at, reservation.ends_at,
            reservation.hold_expires_at, reservation.price_snapshot,
            reservation.coupon_id, reservation.arrived_business_at,
            reservation.started_business_at,
            reservation.completed_business_at,
            reservation.cancelled_business_at, reservation.terminal_reason,
            customer.display_name as customer_display_name,
            store.code as store_code, store.display_name as store_display_name,
            area.code as area_code, area.display_name as area_display_name,
            machine.code as machine_profile_code,
            machine.display_name as machine_profile_display_name,
            seat.code as seat_code,
            seat.operational_status as seat_operational_status,
            refund.amount_cents as refund_amount_cents,
            refund.reason as refund_reason,
            refund.business_occurred_at as refund_business_occurred_at
       from reservations reservation
       join demo_personas customer on customer.id = reservation.customer_persona_id
       join stores store on store.id = reservation.store_id
       join seats seat on seat.id = reservation.seat_id
       join store_areas area on area.id = seat.area_id
       join machine_profiles machine on machine.id = seat.machine_profile_id
       left join reservation_simulated_refunds refund
         on refund.reservation_id = reservation.id
      where reservation.sandbox_id = $1
        and reservation.price_snapshot is not null
        and ($2::uuid is null or reservation.id = $2)
      order by reservation.starts_at, reservation.id
      ${input.lock ? "for update of reservation" : ""}`,
    [input.sandboxId, input.reservationId ?? null],
  );
  return result.rows;
}

function staffReservationSummary(
  row: StaffReservationRow,
): DatabaseStaffReservationSummary {
  return {
    anomaly:
      row.seat_operational_status === "maintenance"
        ? { code: "seat-maintenance", label: "座位维护中" }
        : null,
    area: { code: row.area_code, displayName: row.area_display_name },
    arrivalWindow: {
      closesAt: new Date(row.starts_at.getTime() + 15 * 60 * 1_000),
      opensAt: new Date(row.starts_at.getTime() - 30 * 60 * 1_000),
    },
    customer: { displayName: row.customer_display_name },
    machineProfile: {
      code: row.machine_profile_code,
      displayName: row.machine_profile_display_name,
    },
    payableCents: row.price_snapshot.price.payableCents,
    reservationId: row.id,
    seat: { code: row.seat_code },
    status: row.status,
    window: { endsAt: row.ends_at, startsAt: row.starts_at },
  };
}

function frontlinePrimaryAction(
  row: StaffReservationRow,
  currentTime: Date,
): DatabaseStaffReservationDetail["actions"]["primary"] {
  const now = currentTime.getTime();
  const startsAt = row.starts_at.getTime();
  if (
    row.status === "confirmed" &&
    now >= startsAt - 30 * 60 * 1_000 &&
    now <= startsAt + 15 * 60 * 1_000
  ) {
    return { kind: "arrive", label: "办理到店", requiresReason: false };
  }
  if (
    row.status === "arrived" &&
    now >= startsAt &&
    now < row.ends_at.getTime()
  ) {
    return { kind: "start-use", label: "开始使用", requiresReason: false };
  }
  if (row.status === "in-use" && now < row.ends_at.getTime()) {
    return { kind: "complete-early", label: "提前结束", requiresReason: true };
  }
  return null;
}

function canFrontlineCancel(row: StaffReservationRow, currentTime: Date) {
  if (row.status === "pending-confirmation") {
    return Boolean(
      row.hold_expires_at &&
      currentTime.getTime() < row.hold_expires_at.getTime(),
    );
  }
  return row.status === "confirmed" || row.status === "arrived";
}

async function staffReservationDetailFromRow(
  client: PoolClient,
  row: StaffReservationRow,
  currentTime: Date,
  role: FrontlineRole,
): Promise<DatabaseStaffReservationDetail> {
  const events = await client.query<ReservationEventRow>(
    `select event_type, event_data, business_occurred_at
       from reservation_business_events
      where sandbox_id = $1 and reservation_id = $2
      order by sequence`,
    [row.sandbox_id, row.id],
  );
  const relatedOrders = await readRelatedOrders(client, row.sandbox_id, row.id);
  return {
    actions: {
      canCancel: canFrontlineCancel(row, currentTime),
      primary: frontlinePrimaryAction(row, currentTime),
    },
    arrivedAt: row.arrived_business_at,
    auditAvailable: role === "manager",
    cancelledAt: row.cancelled_business_at,
    completedAt: row.completed_business_at,
    currentTime,
    events: events.rows.map((event) => ({
      data: event.event_data,
      occurredAt: event.business_occurred_at,
      type: event.event_type,
    })),
    refund:
      row.refund_amount_cents !== null &&
      row.refund_business_occurred_at &&
      row.refund_reason
        ? {
            amountCents: row.refund_amount_cents,
            occurredAt: row.refund_business_occurred_at,
            reason: row.refund_reason,
            simulated: true,
          }
        : null,
    related: { orders: relatedOrders, repairs: [] },
    reservation: staffReservationSummary(row),
    snapshot: reservationSnapshot(row.price_snapshot),
    startedAt: row.started_business_at,
    terminalReason: row.terminal_reason,
  };
}

async function processFrontlineReservationDeadlines(
  client: PoolClient,
  input: {
    readonly currentTime: Date;
    readonly recordedAt: Date;
    readonly reservationId?: string;
    readonly sandboxId: string;
  },
) {
  await processDueReservationExpirations(client, {
    kind: "pending",
    recordedAt: input.recordedAt,
    ...(input.reservationId ? { reservationId: input.reservationId } : {}),
    sandboxId: input.sandboxId,
    targetBusinessTime: input.currentTime,
  });
  await processDueReservationExpirations(client, {
    kind: "no-show",
    recordedAt: input.recordedAt,
    ...(input.reservationId ? { reservationId: input.reservationId } : {}),
    sandboxId: input.sandboxId,
    targetBusinessTime: input.currentTime,
  });
  await processDueReservationAutoCompletions(client, {
    recordedAt: input.recordedAt,
    ...(input.reservationId ? { reservationId: input.reservationId } : {}),
    sandboxId: input.sandboxId,
    targetBusinessTime: input.currentTime,
  });
  await processCustomerOrderDeadlines(client, {
    recordedAt: input.recordedAt,
    ...(input.reservationId ? { reservationId: input.reservationId } : {}),
    sandboxId: input.sandboxId,
    targetBusinessTime: input.currentTime,
  });
}

async function readFrontlineStore(
  client: PoolClient,
  sandboxId: string,
  storeId: string,
): Promise<{ code: string; displayName: string }> {
  const result = await client.query<{ code: string; display_name: string }>(
    `select code, display_name from stores
      where sandbox_id = $1 and id = $2`,
    [sandboxId, storeId],
  );
  const row = result.rows[0];
  if (!row) throw new RoleContextUnavailableError();
  return { code: row.code, displayName: row.display_name };
}

async function recordFrontlineReservationDenial(
  client: PoolClient,
  input: {
    readonly action: FrontlineReservationAction;
    readonly actorStoreId: string;
    readonly businessTime: Date;
    readonly currentStatus: ReservationStatus | null;
    readonly personaId: string;
    readonly reason: string;
    readonly recordedAt: Date;
    readonly requestId: string;
    readonly reservationId: string;
    readonly role: FrontlineRole;
    readonly sandboxId: string;
  },
) {
  await client.query(
    `insert into audit_events (
       id, sandbox_id, store_id, persona_id, role, action, object_type,
       object_id, result, reason, request_id, before_data, after_data,
       business_occurred_at, recorded_at
     ) values ($1, $2, $3, $4, $5, $6, 'reservation', $7, 'denied',
       $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
    [
      randomUUID(),
      input.sandboxId,
      input.actorStoreId,
      input.personaId,
      input.role,
      `reservation.${input.action}`,
      input.reservationId,
      input.reason,
      input.requestId,
      JSON.stringify({ status: input.currentStatus }),
      JSON.stringify({ status: input.currentStatus }),
      input.businessTime,
      input.recordedAt,
    ],
  );
}

function frontlineCommandFromStored(
  value: FrontlineCommandRow["result_data"],
  replayed: boolean,
): DatabaseStaffReservationCommand {
  return {
    ...value,
    occurredAt: new Date(value.occurredAt),
    replayed,
  };
}

async function readStaffOrderRows(
  client: PoolClient,
  input: {
    readonly lock?: boolean;
    readonly orderId?: string;
    readonly sandboxId: string;
    readonly storeId: string;
  },
): Promise<ReadonlyArray<StaffOrderRow>> {
  const result = await client.query<StaffOrderRow>(
    `select orders.id, orders.store_id, orders.customer_persona_id,
            orders.status, orders.order_snapshot,
            orders.paid_business_at, orders.preparing_business_at,
            orders.ready_business_at, orders.cancelled_business_at,
            reservation.id as reservation_id,
            reservation.status as reservation_status, seat.code as seat_code,
            customer.display_name as customer_display_name,
            coupon.status as coupon_status
       from customer_orders orders
       join reservations reservation on reservation.id = orders.reservation_id
       join seats seat on seat.id = orders.seat_id
       join demo_personas customer on customer.id = orders.customer_persona_id
       left join experience_coupons coupon on coupon.id = orders.coupon_id
      where orders.sandbox_id = $1 and orders.store_id = $2
        and ($3::uuid is null or orders.id = $3)
      order by coalesce(orders.ready_business_at,
        orders.preparing_business_at, orders.paid_business_at,
        orders.created_business_at), orders.id
      ${input.lock ? "for update of orders" : ""}`,
    [input.sandboxId, input.storeId, input.orderId ?? null],
  );
  return result.rows;
}

function staffOrderSummary(
  row: StaffOrderRow,
  currentTime: Date,
): DatabaseStaffOrderSummary {
  const stageEnteredAt =
    row.ready_business_at ??
    row.preparing_business_at ??
    row.paid_business_at ??
    currentTime;
  return {
    amountCents: row.order_snapshot.payableCents,
    couponLabel: row.order_snapshot.coupon?.displayName ?? null,
    customerDisplayName: row.customer_display_name,
    itemSummary: row.order_snapshot.lines
      .map((line) => `${line.productName} × ${line.quantity}`)
      .join(" · "),
    orderId: row.id,
    reservation: {
      reservationId: row.reservation_id,
      seatCode: row.seat_code,
      status: row.reservation_status,
    },
    stageEnteredAt,
    status: row.status,
    waitingMinutes: Math.max(
      0,
      Math.floor((currentTime.getTime() - stageEnteredAt.getTime()) / 60_000),
    ),
  };
}

function staffOrderActions(status: CustomerOrderStatus) {
  const primaryByStatus: Partial<
    Record<
      CustomerOrderStatus,
      NonNullable<DatabaseStaffOrderDetail["actions"]["primary"]>
    >
  > = {
    "simulated-paid": { kind: "start-preparing", label: "开始制作" },
    preparing: { kind: "mark-ready", label: "标记待取" },
    "ready-for-pickup": { kind: "complete", label: "完成订单" },
  };
  const primary = primaryByStatus[status];
  return {
    canCancel:
      status === "pending-simulated-payment" ||
      status === "simulated-paid" ||
      status === "preparing" ||
      status === "ready-for-pickup",
    primary: primary ?? null,
  };
}

async function readStaffOrderDetailWithClient(
  client: PoolClient,
  input: ReadStaffOrderDetailInput,
  storeId: string,
  currentTime: Date,
  lock = false,
): Promise<DatabaseStaffOrderDetail> {
  const row = (
    await readStaffOrderRows(client, {
      lock,
      orderId: input.orderId,
      sandboxId: input.sandboxId,
      storeId,
    })
  )[0];
  if (!row) throw new StaffOrderConflictError("not-found");
  const inventory = await client.query<StaffOrderInventoryRow>(
    `select hold.inventory_item_id, hold.quantity, hold.status,
            item.on_hand_quantity, config.product_id
       from order_inventory_reservations hold
       join inventory_items item on item.id = hold.inventory_item_id
       join store_products config on config.inventory_item_id = item.id
      where hold.sandbox_id = $1 and hold.order_id = $2
      order by hold.id`,
    [input.sandboxId, input.orderId],
  );
  const events = await client.query<OrderEventRow>(
    `select event_type, event_data, business_occurred_at
       from order_business_events
      where sandbox_id = $1 and order_id = $2 order by sequence`,
    [input.sandboxId, input.orderId],
  );
  const refund = await client.query<{
    amount_cents: number;
    business_occurred_at: Date;
    reason: string;
  }>(
    `select amount_cents, reason, business_occurred_at
       from order_simulated_refunds
      where sandbox_id = $1 and order_id = $2`,
    [input.sandboxId, input.orderId],
  );
  const growth = await client.query<{
    final_simulated_amount_cents: number;
    growth_points: number;
  }>(
    `select final_simulated_amount_cents, growth_points
       from member_growth_events
      where sandbox_id = $1 and source_kind = 'order' and source_id = $2`,
    [input.sandboxId, input.orderId],
  );
  const refundRow = refund.rows[0];
  const growthRow = growth.rows[0];
  return {
    actions: staffOrderActions(row.status),
    coupon:
      row.order_snapshot.coupon && row.coupon_status
        ? { ...row.order_snapshot.coupon, status: row.coupon_status }
        : null,
    currentTime,
    events: events.rows.map((event) => ({
      data: event.event_data,
      occurredAt: event.business_occurred_at,
      type: event.event_type,
    })),
    growth: growthRow
      ? {
          finalSimulatedAmountCents: growthRow.final_simulated_amount_cents,
          growthPoints: growthRow.growth_points,
        }
      : null,
    inventory: inventory.rows.map((item) => ({
      inventoryItemId: item.inventory_item_id,
      onHandQuantity: item.on_hand_quantity,
      productId: item.product_id,
      quantity: item.quantity,
      reservationStatus: item.status,
    })),
    order: staffOrderSummary(row, currentTime),
    refund: refundRow
      ? {
          amountCents: refundRow.amount_cents,
          occurredAt: refundRow.business_occurred_at,
          reason: refundRow.reason,
          simulated: true,
        }
      : null,
    snapshot: row.order_snapshot,
  };
}

async function recordStaffOrderDenial(
  client: PoolClient,
  input: ExecuteStaffOrderCommandInput & {
    readonly actorStoreId: string;
    readonly businessTime: Date;
    readonly currentStatus: CustomerOrderStatus | null;
    readonly denialReason: string;
    readonly recordedAt: Date;
  },
) {
  await client.query(
    `insert into audit_events (
       id, sandbox_id, store_id, persona_id, role, action, object_type,
       object_id, result, reason, request_id, before_data, after_data,
       business_occurred_at, recorded_at
     ) values ($1, $2, $3, $4, $5, $6, 'order', $7, 'denied', $8, $9,
       $10::jsonb, $11::jsonb, $12, $13)`,
    [
      randomUUID(),
      input.sandboxId,
      input.actorStoreId,
      input.personaId,
      input.role,
      `order.${input.action}`,
      input.orderId,
      input.denialReason,
      input.requestId,
      JSON.stringify({ status: input.currentStatus }),
      JSON.stringify({ status: input.currentStatus }),
      input.businessTime,
      input.recordedAt,
    ],
  );
}

function staffOrderCommandFromStored(
  value: StaffOrderCommandRow["result_data"],
  replayed: boolean,
): DatabaseStaffOrderCommand {
  return { ...value, occurredAt: new Date(value.occurredAt), replayed };
}

function buildRoleContext(
  sandbox: SandboxRow,
  persona: PersonaRow,
  stores: ReadonlyArray<StoreRow>,
  wallTime: Date,
): DatabaseRoleContext {
  const scopedStores =
    persona.role === "customer" || persona.role === "hq"
      ? stores
      : persona.role === "staff" || persona.role === "manager"
        ? stores.filter((store) => store.id === persona.store_id)
        : [];

  return {
    sandboxId: sandbox.id,
    schemaVersion: sandbox.schema_version,
    seedVersion: sandbox.seed_version,
    expiresAt: sandbox.expires_at,
    businessClock: {
      advanceLimitMilliseconds: SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
      advancedMilliseconds: sandbox.business_time_advance_ms,
      currentTime: businessTimeForSandbox(sandbox, wallTime),
      remainingAdvanceMilliseconds:
        SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS -
        sandbox.business_time_advance_ms,
      timeZone: SANDBOX_BUSINESS_TIME_ZONE,
    },
    contextVersion: sandbox.role_context_version,
    role: persona.role,
    persona: {
      id: persona.id,
      displayName: persona.display_name,
      protected: true,
      scope: persona.scope,
      storeId: persona.store_id,
    },
    storeScope: {
      kind:
        persona.role === "customer"
          ? "customer"
          : persona.role === "hq"
            ? "all-stores"
            : "store",
      stores: scopedStores.map((store) => ({
        id: store.id,
        code: store.code,
        displayName: store.display_name,
      })),
    },
  };
}

async function readSandboxResult(
  client: PoolClient,
  sandboxId: string,
  creationRole: PublicRole,
  replayed: boolean,
  wallTime: Date,
): Promise<PublicSandboxResult> {
  const sandbox = await client.query<SandboxRow>(
    `select ${SANDBOX_ROW_COLUMNS}
       from sandboxes where id = $1 for update`,
    [sandboxId],
  );
  let sandboxRow = sandbox.rows[0];
  if (!sandboxRow || sandboxRow.invalidated_at !== null) {
    throw new Error("The public sandbox transaction returned incomplete data.");
  }
  if (sandboxRow.role_context_role === null) {
    const claimed = await client.query<SandboxRow>(
      `update sandboxes
          set role_context_role = $2
        where id = $1 and role_context_role is null
      returning ${SANDBOX_ROW_COLUMNS}`,
      [sandboxId, creationRole],
    );
    sandboxRow = claimed.rows[0] ?? sandboxRow;
  }
  const currentRole = sandboxRow.role_context_role;
  if (!currentRole) {
    throw new Error("The public sandbox role context could not be claimed.");
  }
  const operator = await client.query<OperatorRow>(
    `select display_name, city from operators where sandbox_id = $1`,
    [sandboxId],
  );
  const stores = await client.query<StoreRow>(
    `select id, code, display_name, seat_count, opens_at, closes_at,
            closes_next_day, is_open_24_hours
       from stores where sandbox_id = $1 order by code`,
    [sandboxId],
  );
  const personas = await client.query<PersonaRow>(
    `select id, display_name, protected, role, scope, store_id
       from demo_personas where sandbox_id = $1 and role = any($2::text[])`,
    [sandboxId, [creationRole, currentRole]],
  );

  const operatorRow = operator.rows[0];
  const creationPersonaRow = personas.rows.find(
    (persona) => persona.role === creationRole,
  );
  const currentPersonaRow = personas.rows.find(
    (persona) => persona.role === currentRole,
  );
  if (!operatorRow || !creationPersonaRow || !currentPersonaRow) {
    throw new Error("The public sandbox transaction returned incomplete data.");
  }

  const storeOrder = new Map<string, number>(
    storeSeeds.map((store, index) => [store.code, index]),
  );
  const orderedStores = stores.rows.toSorted(
    (left, right) =>
      (storeOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
      (storeOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER),
  );

  const roleContext = buildRoleContext(
    sandboxRow,
    currentPersonaRow,
    orderedStores,
    wallTime,
  );

  return {
    replayed,
    sandboxId: sandboxRow.id,
    schemaVersion: sandboxRow.schema_version,
    seedVersion: sandboxRow.seed_version,
    expiresAt: sandboxRow.expires_at,
    selectedRole: creationRole,
    persona: {
      displayName: creationPersonaRow.display_name,
      protected: creationPersonaRow.protected,
      scope: creationPersonaRow.scope,
    },
    operator: {
      displayName: operatorRow.display_name,
      city: operatorRow.city,
    },
    stores: orderedStores.map((store) => ({
      code: store.code,
      displayName: store.display_name,
      seatCount: store.seat_count,
      businessHours: formatBusinessHours(store),
    })),
    roleContext,
  };
}

async function materializePublicSandbox(input: {
  client: PoolClient;
  expiresAt: Date;
  sandboxId: string;
  selectedRole: PublicRole;
  wallTime: Date;
}): Promise<PublicSandboxResult> {
  const operatorId = randomUUID();
  await input.client.query(
    `insert into sandboxes (
       id, schema_version, seed_version, expires_at, role_context_role,
       business_time_anchor_at, business_time_anchor_wall_at
     ) values ($1, $2, $3, $4, $5, $6, $6)`,
    [
      input.sandboxId,
      publicSandboxSeed.schemaVersion,
      publicSandboxSeed.seedVersion,
      input.expiresAt,
      input.selectedRole,
      input.wallTime,
    ],
  );
  await input.client.query(
    `insert into operators (id, sandbox_id, display_name, city)
     values ($1, $2, $3, $4)`,
    [
      operatorId,
      input.sandboxId,
      publicSandboxSeed.operator.displayName,
      publicSandboxSeed.operator.city,
    ],
  );

  const seededStores = storeSeeds.map((store) => ({
    ...store,
    id: randomUUID(),
  }));
  const storeIds = new Map(seededStores.map((store) => [store.code, store.id]));
  await input.client.query(
    `insert into stores (
       id, sandbox_id, operator_id, code, display_name, seat_count,
       opens_at, closes_at, closes_next_day, is_open_24_hours
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[],
       $6::integer[], $7::time[], $8::time[], $9::boolean[], $10::boolean[]
     )`,
    [
      seededStores.map((store) => store.id),
      seededStores.map(() => input.sandboxId),
      seededStores.map(() => operatorId),
      seededStores.map((store) => store.code),
      seededStores.map((store) => store.displayName),
      seededStores.map((store) => store.seatCount),
      seededStores.map((store) => store.opensAt),
      seededStores.map((store) => store.closesAt),
      seededStores.map((store) => store.closesNextDay),
      seededStores.map((store) => store.isOpen24Hours),
    ],
  );

  const seededPersonas = personaSeeds.map((persona) => ({
    ...persona,
    id: randomUUID(),
    storeId: persona.storeCode
      ? (storeIds.get(persona.storeCode) ?? null)
      : null,
  }));
  await input.client.query(
    `insert into demo_personas (
       id, sandbox_id, store_id, role, display_name, scope, protected
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[],
       $5::text[], $6::text[], $7::boolean[]
     )`,
    [
      seededPersonas.map((persona) => persona.id),
      seededPersonas.map(() => input.sandboxId),
      seededPersonas.map((persona) => persona.storeId),
      seededPersonas.map((persona) => persona.role),
      seededPersonas.map((persona) => persona.displayName),
      seededPersonas.map((persona) => persona.scope),
      seededPersonas.map((persona) => persona.protected),
    ],
  );

  const seededMachineProfiles = publicSandboxSeed.machineProfiles.map(
    (profile) => ({ ...profile, id: randomUUID() }),
  );
  const machineProfileIds = new Map<MachineProfileCode, string>(
    seededMachineProfiles.map((profile) => [profile.code, profile.id]),
  );
  await input.client.query(
    `insert into machine_profiles (
       id, sandbox_id, code, display_name, experience_description
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[]
     )`,
    [
      seededMachineProfiles.map((profile) => profile.id),
      seededMachineProfiles.map(() => input.sandboxId),
      seededMachineProfiles.map((profile) => profile.code),
      seededMachineProfiles.map((profile) => profile.displayName),
      seededMachineProfiles.map((profile) => profile.experienceDescription),
    ],
  );

  const seededAreas = seededStores.flatMap((store) =>
    store.areas.map((area, areaIndex) => ({
      ...area,
      id: randomUUID(),
      sortOrder: areaIndex,
      storeCode: store.code,
      storeId: store.id,
    })),
  );
  await input.client.query(
    `insert into store_areas (
       id, sandbox_id, store_id, code, display_name, sort_order
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::integer[]
     )`,
    [
      seededAreas.map((area) => area.id),
      seededAreas.map(() => input.sandboxId),
      seededAreas.map((area) => area.storeId),
      seededAreas.map((area) => area.code),
      seededAreas.map((area) => area.displayName),
      seededAreas.map((area) => area.sortOrder),
    ],
  );

  const maintenanceSeatKeys = new Set([
    "apex-new:A-06",
    "prism-flagship:A-09",
    "starbridge-standard:A-08",
  ]);
  const seededSeats = seededAreas.flatMap((area) => {
    const profileSequence = publicSandboxSeed.machineProfiles.flatMap(
      (profile) =>
        Array.from(
          { length: area.machineProfileSeatCounts[profile.code] },
          () => profile.code,
        ),
    );
    if (profileSequence.length !== area.seatCount) {
      throw new Error("The deterministic area machine counts are incomplete.");
    }
    const areaPrefix = String.fromCharCode(65 + area.sortOrder);
    return profileSequence.map((machineProfileCode, seatIndex) => {
      const code = `${areaPrefix}-${String(seatIndex + 1).padStart(2, "0")}`;
      return {
        areaId: area.id,
        code,
        id: randomUUID(),
        machineProfileCode,
        machineProfileId: machineProfileIds.get(machineProfileCode),
        operationalStatus: maintenanceSeatKeys.has(`${area.storeCode}:${code}`)
          ? ("maintenance" as const)
          : ("normal" as const),
        sortOrder: area.sortOrder * 100 + seatIndex,
        storeCode: area.storeCode,
        storeId: area.storeId,
      };
    });
  });
  if (seededSeats.some((seat) => !seat.machineProfileId)) {
    throw new Error(
      "The deterministic seat seed references an unknown machine profile.",
    );
  }
  await input.client.query(
    `insert into seats (
       id, sandbox_id, store_id, area_id, machine_profile_id, code,
       sort_order, operational_status
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::text[], $7::integer[], $8::text[]
     )`,
    [
      seededSeats.map((seat) => seat.id),
      seededSeats.map(() => input.sandboxId),
      seededSeats.map((seat) => seat.storeId),
      seededSeats.map((seat) => seat.areaId),
      seededSeats.map((seat) => seat.machineProfileId),
      seededSeats.map((seat) => seat.code),
      seededSeats.map((seat) => seat.sortOrder),
      seededSeats.map((seat) => seat.operationalStatus),
    ],
  );

  const priceEffectiveFrom = new Date(
    input.wallTime.getTime() - 14 * 24 * 60 * 60 * 1_000,
  );
  const seededPricePlans = seededAreas.flatMap((area) => {
    const store = seededStores.find((item) => item.id === area.storeId);
    if (!store)
      throw new Error("The deterministic price plan store is missing.");
    return publicSandboxSeed.machineProfiles
      .filter((profile) => area.machineProfileSeatCounts[profile.code] > 0)
      .map((profile) => ({
        areaId: area.id,
        baseHourlyCents: store.baseHourlyCents[profile.code],
        id: randomUUID(),
        machineProfileId: machineProfileIds.get(profile.code),
        storeId: store.id,
      }));
  });
  await input.client.query(
    `insert into price_plans (
       id, sandbox_id, store_id, area_id, machine_profile_id, version,
       base_hourly_cents, effective_from, status
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::integer[], $7::integer[], $8::timestamptz[], $9::text[]
     )`,
    [
      seededPricePlans.map((plan) => plan.id),
      seededPricePlans.map(() => input.sandboxId),
      seededPricePlans.map((plan) => plan.storeId),
      seededPricePlans.map((plan) => plan.areaId),
      seededPricePlans.map((plan) => plan.machineProfileId),
      seededPricePlans.map(() => 1),
      seededPricePlans.map((plan) => plan.baseHourlyCents),
      seededPricePlans.map(() => priceEffectiveFrom),
      seededPricePlans.map(() => "active"),
    ],
  );

  const seededProducts = productSeeds.map((product) => ({
    ...product,
    id: randomUUID(),
  }));
  await input.client.query(
    `insert into products (
       id, sandbox_id, code, name, description, category
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::text[]
     )`,
    [
      seededProducts.map((product) => product.id),
      seededProducts.map(() => input.sandboxId),
      seededProducts.map((product) => product.code),
      seededProducts.map((product) => product.name),
      seededProducts.map((product) => product.description),
      seededProducts.map((product) => product.category),
    ],
  );
  const flagshipProductCodes = new Set(
    productSeeds.slice(0, 6).map((product) => product.code),
  );
  const storeListedProducts: Readonly<Record<string, ReadonlySet<string>>> = {
    "apex-new": new Set([
      "pulse-sparkling-water",
      "cloud-mineral-water",
      "jump-energy-bar",
      "crisp-seaweed",
      "peripheral-wipe",
      "wake-mint",
    ]),
    "prism-flagship": flagshipProductCodes,
    "starbridge-standard": new Set([
      "midnight-iced-tea",
      "circuit-coffee",
      "cloud-mineral-water",
      "crisp-seaweed",
      "star-popcorn",
      "orbit-rice-roll",
    ]),
  };
  const flagshipQuantities = [18, 7, 9, 3, 12, 20] as const;
  const basePrices = [
    800, 1_000, 1_200, 900, 600, 500, 700, 1_100, 400, 700, 900, 1_000,
  ] as const;
  const seededProductInventory = seededStores.flatMap((store) =>
    seededProducts.map((product, index) => ({
      code: product.code,
      displayName: product.name,
      id: randomUUID(),
      listed: storeListedProducts[store.code]?.has(product.code) ?? false,
      lowStockThreshold: index === 3 ? 3 : 4,
      onHandQuantity:
        store.code === "prism-flagship" && index < flagshipQuantities.length
          ? (flagshipQuantities[index] ?? 8)
          : 8 + ((index + store.code.length) % 9),
      productId: product.id,
      storeId: store.id,
      unitPriceCents:
        (basePrices[index] ?? 800) +
        (store.code === "prism-flagship"
          ? 0
          : store.code === "starbridge-standard"
            ? -100
            : -50),
    })),
  );
  const spareSeeds = seededStores.flatMap((store) =>
    [
      { code: "spare-headset", displayName: "维修耳机", quantity: 6 },
      { code: "spare-key-switch", displayName: "键盘轴体", quantity: 24 },
      { code: "spare-mouse", displayName: "维修鼠标", quantity: 5 },
    ].map((spare) => ({
      ...spare,
      id: randomUUID(),
      storeId: store.id,
    })),
  );
  await input.client.query(
    `insert into inventory_items (
       id, sandbox_id, store_id, product_id, kind, code, display_name,
       on_hand_quantity, reserved_quantity, low_stock_threshold
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[],
       $6::text[], $7::text[], $8::integer[], $9::integer[], $10::integer[]
     )`,
    [
      [
        ...seededProductInventory.map((item) => item.id),
        ...spareSeeds.map((item) => item.id),
      ],
      [...seededProductInventory, ...spareSeeds].map(() => input.sandboxId),
      [
        ...seededProductInventory.map((item) => item.storeId),
        ...spareSeeds.map((item) => item.storeId),
      ],
      [
        ...seededProductInventory.map((item) => item.productId),
        ...spareSeeds.map(() => null),
      ],
      [
        ...seededProductInventory.map(() => "product"),
        ...spareSeeds.map(() => "spare"),
      ],
      [
        ...seededProductInventory.map((item) => item.code),
        ...spareSeeds.map((item) => item.code),
      ],
      [
        ...seededProductInventory.map((item) => item.displayName),
        ...spareSeeds.map((item) => item.displayName),
      ],
      [
        ...seededProductInventory.map((item) => item.onHandQuantity),
        ...spareSeeds.map((item) => item.quantity),
      ],
      [...seededProductInventory, ...spareSeeds].map(() => 0),
      [
        ...seededProductInventory.map((item) => item.lowStockThreshold),
        ...spareSeeds.map(() => 2),
      ],
    ],
  );
  await input.client.query(
    `insert into store_products (
       id, sandbox_id, store_id, product_id, inventory_item_id, listed,
       unit_price_cents
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::boolean[], $7::integer[]
     )`,
    [
      seededProductInventory.map(() => randomUUID()),
      seededProductInventory.map(() => input.sandboxId),
      seededProductInventory.map((item) => item.storeId),
      seededProductInventory.map((item) => item.productId),
      seededProductInventory.map((item) => item.id),
      seededProductInventory.map((item) => item.listed),
      seededProductInventory.map((item) => item.unitPriceCents),
    ],
  );

  const customerPersona = seededPersonas.find(
    (persona) => persona.role === "customer",
  );
  const availabilityFixturePersona = seededPersonas.find(
    (persona) => persona.role === "hq",
  );
  const seatByKey = new Map(
    seededSeats.map((seat) => [`${seat.storeCode}:${seat.code}`, seat]),
  );
  const reservedSeat = seatByKey.get("prism-flagship:A-06");
  const inUseSeat = seatByKey.get("prism-flagship:A-07");
  if (
    !customerPersona ||
    !availabilityFixturePersona ||
    !reservedSeat ||
    !inUseSeat
  ) {
    throw new Error(
      "The deterministic reservation availability seed is incomplete.",
    );
  }
  const flagshipStore = seededStores.find(
    (store) => store.code === "prism-flagship",
  );
  if (!flagshipStore) {
    throw new Error("The reservation coupon seed store is missing.");
  }
  const couponValidFrom = new Date(
    input.wallTime.getTime() - 24 * 60 * 60 * 1_000,
  );
  const couponValidUntil = new Date(
    input.wallTime.getTime() + 30 * 24 * 60 * 60 * 1_000,
  );
  const couponExpiredAt = new Date(
    input.wallTime.getTime() - 24 * 60 * 60 * 1_000,
  );
  const seededCoupons = [
    {
      businessKind: "reservation",
      code: "reservation-six",
      discountCents: 600,
      displayName: "预约立减体验券",
      eligibleEndMinutes: 1_440,
      eligibleStartMinutes: 0,
      id: randomUUID(),
      minimumSpendCents: 2_000,
      status: "available",
      storeId: flagshipStore.id,
      validFrom: couponValidFrom,
      validUntil: couponValidUntil,
    },
    {
      businessKind: "order",
      code: "order-five",
      discountCents: 500,
      displayName: "商品立减体验券",
      eligibleEndMinutes: 1_440,
      eligibleStartMinutes: 0,
      id: randomUUID(),
      minimumSpendCents: 1_500,
      status: "available",
      storeId: null,
      validFrom: couponValidFrom,
      validUntil: couponValidUntil,
    },
    {
      businessKind: "reservation",
      code: "reservation-history-six",
      discountCents: 600,
      displayName: "历史预约体验券",
      eligibleEndMinutes: 1_440,
      eligibleStartMinutes: 0,
      id: randomUUID(),
      minimumSpendCents: 2_000,
      status: "redeemed",
      storeId: flagshipStore.id,
      validFrom: new Date(input.wallTime.getTime() - 30 * 24 * 60 * 60 * 1_000),
      validUntil: couponValidUntil,
    },
    {
      businessKind: "order",
      code: "order-history-expired",
      discountCents: 300,
      displayName: "历史商品体验券",
      eligibleEndMinutes: 1_440,
      eligibleStartMinutes: 0,
      id: randomUUID(),
      minimumSpendCents: 1_000,
      status: "expired",
      storeId: null,
      validFrom: new Date(input.wallTime.getTime() - 30 * 24 * 60 * 60 * 1_000),
      validUntil: couponExpiredAt,
    },
  ] as const;
  await input.client.query(
    `insert into experience_coupons (
       id, sandbox_id, customer_persona_id, store_id, code, display_name,
       business_kind, discount_cents, minimum_spend_cents,
       eligible_start_minutes, eligible_end_minutes, valid_from, valid_until,
       status
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[],
       $6::text[], $7::text[], $8::integer[], $9::integer[], $10::integer[],
       $11::integer[], $12::timestamptz[], $13::timestamptz[], $14::text[]
     )`,
    [
      seededCoupons.map((coupon) => coupon.id),
      seededCoupons.map(() => input.sandboxId),
      seededCoupons.map(() => customerPersona.id),
      seededCoupons.map((coupon) => coupon.storeId),
      seededCoupons.map((coupon) => coupon.code),
      seededCoupons.map((coupon) => coupon.displayName),
      seededCoupons.map((coupon) => coupon.businessKind),
      seededCoupons.map((coupon) => coupon.discountCents),
      seededCoupons.map((coupon) => coupon.minimumSpendCents),
      seededCoupons.map((coupon) => coupon.eligibleStartMinutes),
      seededCoupons.map((coupon) => coupon.eligibleEndMinutes),
      seededCoupons.map((coupon) => coupon.validFrom),
      seededCoupons.map((coupon) => coupon.validUntil),
      seededCoupons.map((coupon) => coupon.status),
    ],
  );
  const staffQueueCustomerNames = [
    "林澈",
    "陆远",
    "陈牧",
    "顾辰",
    "周屿",
    "许泽",
    "莫子昂",
    "叶岚",
  ] as const;
  const staffQueueCustomers = staffQueueCustomerNames.map((displayName) => ({
    displayName,
    id: randomUUID(),
  }));
  await input.client.query(
    `insert into demo_personas (
       id, sandbox_id, store_id, role, display_name, scope, protected
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[],
       $5::text[], $6::text[], $7::boolean[]
     )`,
    [
      staffQueueCustomers.map((persona) => persona.id),
      staffQueueCustomers.map(() => input.sandboxId),
      staffQueueCustomers.map(() => null),
      staffQueueCustomers.map(() => "customer"),
      staffQueueCustomers.map((persona) => persona.displayName),
      staffQueueCustomers.map(() => "合成预约顾客"),
      staffQueueCustomers.map(() => false),
    ],
  );
  const customerPersonas = [customerPersona, ...staffQueueCustomers];
  const seededMemberProfiles = customerPersonas.map((persona) => ({
    customerPersonaId: persona.id,
    growthPoints: persona.id === customerPersona.id ? 860 : 0,
    id: randomUUID(),
  }));
  await input.client.query(
    `insert into member_profiles (
       id, sandbox_id, customer_persona_id, growth_points
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::integer[]
     )`,
    [
      seededMemberProfiles.map((profile) => profile.id),
      seededMemberProfiles.map(() => input.sandboxId),
      seededMemberProfiles.map((profile) => profile.customerPersonaId),
      seededMemberProfiles.map((profile) => profile.growthPoints),
    ],
  );
  const currentSegmentStart = new Date(
    Math.floor(input.wallTime.getTime() / (30 * 60 * 1_000)) *
      (30 * 60 * 1_000),
  );
  const seededReservations = [
    {
      endsAt: new Date(currentSegmentStart.getTime() + 30 * 60 * 1_000),
      id: randomUUID(),
      seat: inUseSeat,
      startsAt: new Date(currentSegmentStart.getTime() - 30 * 60 * 1_000),
      status: "in-use",
    },
    {
      endsAt: new Date(currentSegmentStart.getTime() + 150 * 60 * 1_000),
      id: randomUUID(),
      seat: reservedSeat,
      startsAt: new Date(currentSegmentStart.getTime() + 30 * 60 * 1_000),
      status: "confirmed",
    },
  ] as const;
  await input.client.query(
    `insert into reservations (
       id, sandbox_id, store_id, customer_persona_id, seat_id, status,
       starts_at, ends_at
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::text[], $7::timestamptz[], $8::timestamptz[]
     )`,
    [
      seededReservations.map((reservation) => reservation.id),
      seededReservations.map(() => input.sandboxId),
      seededReservations.map((reservation) => reservation.seat.storeId),
      seededReservations.map(() => availabilityFixturePersona.id),
      seededReservations.map((reservation) => reservation.seat.id),
      seededReservations.map((reservation) => reservation.status),
      seededReservations.map((reservation) => reservation.startsAt),
      seededReservations.map((reservation) => reservation.endsAt),
    ],
  );

  const historySeat = seatByKey.get("prism-flagship:A-08");
  const historyCoupon = seededCoupons.find(
    (coupon) => coupon.code === "reservation-history-six",
  );
  const customerMemberProfile = seededMemberProfiles.find(
    (profile) => profile.customerPersonaId === customerPersona.id,
  );
  if (!historySeat || !historyCoupon || !customerMemberProfile) {
    throw new Error(
      "The deterministic customer membership history is incomplete.",
    );
  }
  const historyStartsAt = new Date(
    currentSegmentStart.getTime() -
      4 * 24 * 60 * 60 * 1_000 -
      5 * 60 * 60 * 1_000,
  );
  const historyEndsAt = new Date(
    historyStartsAt.getTime() + 2 * 60 * 60 * 1_000,
  );
  const historyPrice = priceReservationWindow({
    baseHourlyCents: flagshipStore.baseHourlyCents.competitive,
    endsAt: historyEndsAt,
    startsAt: historyStartsAt,
  });
  const historyPayableCents = Math.max(
    0,
    historyPrice.totalCents - historyCoupon.discountCents,
  );
  const historyGrowthPoints = Math.floor(historyPayableCents / 100);
  const historyReservationId = randomUUID();
  const historySnapshot: ReservationSnapshotRecord = {
    area: { code: "competitive-a", displayName: "竞技区 A" },
    coupon: {
      code: historyCoupon.code,
      discountCents: historyCoupon.discountCents,
      displayName: historyCoupon.displayName,
    },
    machineProfile: {
      code: "competitive",
      displayName: "竞技型",
      experienceDescription: "2K / 180Hz",
    },
    price: {
      discountCents: historyCoupon.discountCents,
      payableCents: historyPayableCents,
      segments: historyPrice.segments.map((segment) => ({
        ...segment,
        endsAt: segment.endsAt.toISOString(),
        startsAt: segment.startsAt.toISOString(),
      })),
      subtotalCents: historyPrice.totalCents,
    },
    seat: { code: historySeat.code },
    store: {
      code: flagshipStore.code,
      displayName: flagshipStore.displayName,
    },
    window: {
      endsAt: historyEndsAt.toISOString(),
      startsAt: historyStartsAt.toISOString(),
    },
  };
  await input.client.query(
    `insert into reservations (
       id, sandbox_id, store_id, customer_persona_id, seat_id, status,
       starts_at, ends_at, created_business_at, price_snapshot, coupon_id,
       coupon_snapshot, simulated_payment_cents, confirmed_business_at,
       arrived_business_at, started_business_at, completed_business_at,
       terminal_reason
     ) values ($1, $2, $3, $4, $5, 'completed', $6, $7, $8, $9::jsonb,
       $10, $11::jsonb, $12, $13, $14, $15, $16, 'planned-end-auto-completed')`,
    [
      historyReservationId,
      input.sandboxId,
      flagshipStore.id,
      customerPersona.id,
      historySeat.id,
      historyStartsAt,
      historyEndsAt,
      new Date(historyStartsAt.getTime() - 24 * 60 * 60 * 1_000),
      JSON.stringify(historySnapshot),
      historyCoupon.id,
      JSON.stringify(historySnapshot.coupon),
      historyPayableCents,
      new Date(historyStartsAt.getTime() - 12 * 60 * 60 * 1_000),
      new Date(historyStartsAt.getTime() - 5 * 60 * 1_000),
      historyStartsAt,
      historyEndsAt,
    ],
  );
  const historyEvents = [
    {
      at: new Date(historyStartsAt.getTime() - 24 * 60 * 60 * 1_000),
      data: { seeded: true },
      type: "reservation.pending-created",
    },
    {
      at: new Date(historyStartsAt.getTime() - 12 * 60 * 60 * 1_000),
      data: { simulatedPaymentCents: historyPayableCents },
      type: "reservation.simulated-payment-succeeded",
    },
    {
      at: new Date(historyStartsAt.getTime() - 5 * 60 * 1_000),
      data: { seeded: true },
      type: "reservation.arrived",
    },
    {
      at: historyStartsAt,
      data: { seeded: true },
      type: "reservation.started",
    },
    {
      at: historyEndsAt,
      data: { growthPoints: historyGrowthPoints, reason: "planned-end" },
      type: "reservation.auto-completed",
    },
  ];
  await input.client.query(
    `insert into reservation_business_events (
       id, sandbox_id, reservation_id, event_type, event_data,
       business_occurred_at
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::jsonb[],
       $6::timestamptz[]
     )`,
    [
      historyEvents.map(() => randomUUID()),
      historyEvents.map(() => input.sandboxId),
      historyEvents.map(() => historyReservationId),
      historyEvents.map((event) => event.type),
      historyEvents.map((event) => JSON.stringify(event.data)),
      historyEvents.map((event) => event.at),
    ],
  );
  const baselineGrowthPoints = 860 - historyGrowthPoints;
  await input.client.query(
    `insert into member_growth_events (
       id, sandbox_id, member_profile_id, customer_persona_id, source_kind,
       source_id, final_simulated_amount_cents, growth_points,
       business_occurred_at
     ) values
       ($1, $2, $3, $4, 'seed-baseline', null, $5, $6, $7),
       ($8, $2, $3, $4, 'reservation', $9, $10, $11, $12)`,
    [
      randomUUID(),
      input.sandboxId,
      customerMemberProfile.id,
      customerPersona.id,
      baselineGrowthPoints * 100,
      baselineGrowthPoints,
      new Date(input.wallTime.getTime() - 14 * 24 * 60 * 60 * 1_000),
      randomUUID(),
      historyReservationId,
      historyPayableCents,
      historyGrowthPoints,
      historyEndsAt,
    ],
  );

  const flagshipAreaById = new Map(
    seededAreas
      .filter((area) => area.storeCode === "prism-flagship")
      .map((area) => [area.id, area]),
  );
  const machineProfileByCode = new Map(
    publicSandboxSeed.machineProfiles.map((profile) => [profile.code, profile]),
  );
  const staffReservationDefinitions = [
    {
      customerIndex: 0,
      endsOffsetMinutes: 150,
      seatCode: "A-18",
      startsOffsetMinutes: 30,
      status: "confirmed",
    },
    {
      customerIndex: 1,
      endsOffsetMinutes: 180,
      seatCode: "B-07",
      startsOffsetMinutes: 60,
      status: "confirmed",
    },
    {
      customerIndex: 2,
      endsOffsetMinutes: 210,
      seatCode: "C-12",
      startsOffsetMinutes: 90,
      status: "confirmed",
    },
    {
      customerIndex: 3,
      endsOffsetMinutes: 120,
      seatCode: "B-03",
      startsOffsetMinutes: 0,
      status: "arrived",
    },
    {
      customerIndex: 4,
      endsOffsetMinutes: 90,
      seatCode: "C-01",
      startsOffsetMinutes: -30,
      status: "in-use",
    },
    {
      customerIndex: 5,
      endsOffsetMinutes: 60,
      seatCode: "A-09",
      startsOffsetMinutes: -60,
      status: "in-use",
    },
    {
      customerIndex: 6,
      endsOffsetMinutes: -60,
      seatCode: "D-05",
      startsOffsetMinutes: -180,
      status: "completed",
    },
    {
      customerIndex: 7,
      endsOffsetMinutes: 300,
      seatCode: "D-06",
      startsOffsetMinutes: 180,
      status: "cancelled",
    },
  ] as const;
  const staffReservations = staffReservationDefinitions.map((definition) => {
    const seat = seatByKey.get(`prism-flagship:${definition.seatCode}`);
    const customer = staffQueueCustomers[definition.customerIndex];
    if (!seat || !customer) {
      throw new Error(
        "The deterministic staff reservation seed is incomplete.",
      );
    }
    const area = flagshipAreaById.get(seat.areaId);
    const profile = machineProfileByCode.get(seat.machineProfileCode);
    if (!area || !profile) {
      throw new Error("The staff reservation snapshot seed is incomplete.");
    }
    const startsAt = new Date(
      currentSegmentStart.getTime() + definition.startsOffsetMinutes * 60_000,
    );
    const endsAt = new Date(
      currentSegmentStart.getTime() + definition.endsOffsetMinutes * 60_000,
    );
    const price = priceReservationWindow({
      baseHourlyCents: flagshipStore.baseHourlyCents[seat.machineProfileCode],
      endsAt,
      startsAt,
    });
    const confirmedAt = new Date(
      Math.min(
        startsAt.getTime() - 20 * 60_000,
        currentSegmentStart.getTime() - 20 * 60_000,
      ),
    );
    const snapshot: ReservationSnapshotRecord = {
      area: { code: area.code, displayName: area.displayName },
      coupon: null,
      machineProfile: {
        code: profile.code,
        displayName: profile.displayName,
        experienceDescription: profile.experienceDescription,
      },
      price: {
        discountCents: 0,
        payableCents: price.totalCents,
        segments: price.segments.map((segment) => ({
          ...segment,
          endsAt: segment.endsAt.toISOString(),
          startsAt: segment.startsAt.toISOString(),
        })),
        subtotalCents: price.totalCents,
      },
      seat: { code: seat.code },
      store: {
        code: flagshipStore.code,
        displayName: flagshipStore.displayName,
      },
      window: {
        endsAt: endsAt.toISOString(),
        startsAt: startsAt.toISOString(),
      },
    };
    return {
      arrivedAt:
        definition.status === "arrived" ||
        definition.status === "in-use" ||
        definition.status === "completed"
          ? new Date(startsAt.getTime() - 5 * 60_000)
          : null,
      cancelledAt:
        definition.status === "cancelled"
          ? new Date(currentSegmentStart.getTime() - 10 * 60_000)
          : null,
      completedAt: definition.status === "completed" ? endsAt : null,
      confirmedAt,
      customer,
      endsAt,
      id: randomUUID(),
      seat,
      simulatedPaymentCents: price.totalCents,
      snapshot,
      startedAt:
        definition.status === "in-use" || definition.status === "completed"
          ? startsAt
          : null,
      startsAt,
      status: definition.status,
      terminalReason:
        definition.status === "completed"
          ? "planned-end-auto-completed"
          : definition.status === "cancelled"
            ? "顾客行程变更"
            : null,
    };
  });
  await input.client.query(
    `insert into reservations (
       id, sandbox_id, store_id, customer_persona_id, seat_id, status,
       starts_at, ends_at, price_snapshot, simulated_payment_cents,
       confirmed_business_at, arrived_business_at, started_business_at,
       completed_business_at, cancelled_business_at, terminal_reason
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::text[], $7::timestamptz[], $8::timestamptz[], $9::jsonb[],
       $10::integer[], $11::timestamptz[], $12::timestamptz[],
       $13::timestamptz[], $14::timestamptz[], $15::timestamptz[], $16::text[]
     )`,
    [
      staffReservations.map((reservation) => reservation.id),
      staffReservations.map(() => input.sandboxId),
      staffReservations.map((reservation) => reservation.seat.storeId),
      staffReservations.map((reservation) => reservation.customer.id),
      staffReservations.map((reservation) => reservation.seat.id),
      staffReservations.map((reservation) => reservation.status),
      staffReservations.map((reservation) => reservation.startsAt),
      staffReservations.map((reservation) => reservation.endsAt),
      staffReservations.map((reservation) =>
        JSON.stringify(reservation.snapshot),
      ),
      staffReservations.map((reservation) => reservation.simulatedPaymentCents),
      staffReservations.map((reservation) => reservation.confirmedAt),
      staffReservations.map((reservation) => reservation.arrivedAt),
      staffReservations.map((reservation) => reservation.startedAt),
      staffReservations.map((reservation) => reservation.completedAt),
      staffReservations.map((reservation) => reservation.cancelledAt),
      staffReservations.map((reservation) => reservation.terminalReason),
    ],
  );
  for (const reservation of staffReservations.filter(
    (item) => item.status === "completed" && item.completedAt,
  )) {
    const profile = seededMemberProfiles.find(
      (item) => item.customerPersonaId === reservation.customer.id,
    );
    if (!profile || !reservation.completedAt) {
      throw new Error(
        "The completed seed reservation member profile is missing.",
      );
    }
    const growthPoints = Math.floor(reservation.simulatedPaymentCents / 100);
    await input.client.query(
      `insert into member_growth_events (
         id, sandbox_id, member_profile_id, customer_persona_id, source_kind,
         source_id, final_simulated_amount_cents, growth_points,
         business_occurred_at
       ) values ($1, $2, $3, $4, 'reservation', $5, $6, $7, $8)`,
      [
        randomUUID(),
        input.sandboxId,
        profile.id,
        reservation.customer.id,
        reservation.id,
        reservation.simulatedPaymentCents,
        growthPoints,
        reservation.completedAt,
      ],
    );
    await input.client.query(
      `update member_profiles set growth_points = growth_points + $3
        where sandbox_id = $1 and id = $2`,
      [input.sandboxId, profile.id, growthPoints],
    );
  }
  const seededCancelledReservations = staffReservations.filter(
    (reservation) =>
      reservation.status === "cancelled" && reservation.cancelledAt,
  );
  if (seededCancelledReservations.length > 0) {
    await input.client.query(
      `insert into reservation_simulated_refunds (
         id, sandbox_id, reservation_id, amount_cents, reason,
         business_occurred_at
       )
       select * from unnest(
         $1::uuid[], $2::uuid[], $3::uuid[], $4::integer[], $5::text[],
         $6::timestamptz[]
       )`,
      [
        seededCancelledReservations.map(() => randomUUID()),
        seededCancelledReservations.map(() => input.sandboxId),
        seededCancelledReservations.map((reservation) => reservation.id),
        seededCancelledReservations.map(
          (reservation) => reservation.simulatedPaymentCents,
        ),
        seededCancelledReservations.map(
          () => "staff-seed-cancelled-before-use",
        ),
        seededCancelledReservations.map(
          (reservation) => reservation.cancelledAt,
        ),
      ],
    );
  }
  const seededStaffEvents = staffReservations.flatMap((reservation) => {
    const events: Array<{
      at: Date;
      data: Record<string, unknown>;
      type: string;
    }> = [
      {
        at: new Date(reservation.confirmedAt.getTime() - 2 * 60_000),
        data: { seeded: true },
        type: "reservation.pending-created",
      },
      {
        at: reservation.confirmedAt,
        data: { simulatedPaymentCents: reservation.simulatedPaymentCents },
        type: "reservation.simulated-payment-succeeded",
      },
    ];
    if (reservation.arrivedAt) {
      events.push({
        at: reservation.arrivedAt,
        data: { seeded: true },
        type: "reservation.arrived",
      });
    }
    if (reservation.startedAt) {
      events.push({
        at: reservation.startedAt,
        data: { seeded: true },
        type: "reservation.started",
      });
    }
    if (reservation.completedAt) {
      events.push({
        at: reservation.completedAt,
        data: { reason: "planned-end" },
        type: "reservation.auto-completed",
      });
    }
    if (reservation.cancelledAt) {
      events.push({
        at: reservation.cancelledAt,
        data: { reason: reservation.terminalReason },
        type: "reservation.cancelled",
      });
    }
    return events.map((event) => ({ ...event, reservationId: reservation.id }));
  });
  await input.client.query(
    `insert into reservation_business_events (
       id, sandbox_id, reservation_id, event_type, event_data,
       business_occurred_at
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::jsonb[],
       $6::timestamptz[]
     )`,
    [
      seededStaffEvents.map(() => randomUUID()),
      seededStaffEvents.map(() => input.sandboxId),
      seededStaffEvents.map((event) => event.reservationId),
      seededStaffEvents.map((event) => event.type),
      seededStaffEvents.map((event) => JSON.stringify(event.data)),
      seededStaffEvents.map((event) => event.at),
    ],
  );

  return readSandboxResult(
    input.client,
    input.sandboxId,
    input.selectedRole,
    false,
    input.wallTime,
  );
}

export function createPublicSandboxDatabase(
  databaseUrl: string,
  options: PublicSandboxDatabaseOptions = {},
): PublicSandboxDatabase {
  const pool = new Pool({ connectionString: databaseUrl });
  const wallClock = options.wallClock ?? { now: () => new Date() };
  const demoToolMethods = createSandboxDemoToolMethods(
    pool,
    {
      dueHandlers: {
        ...reservationDueHandlers(),
        ...options.dueHandlers,
      },
      sandboxLifetimeMilliseconds: SANDBOX_LIFETIME_MS,
      wallClock,
    },
    materializePublicSandbox,
    readSandboxResult,
  );

  return {
    ...demoToolMethods,
    async readStaffReservationWorkbench(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await processFrontlineReservationDeadlines(client, {
          currentTime,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
        });
        const range = businessDayRange(currentTime);
        const rows = (
          await readStaffReservationRows(client, {
            sandboxId: input.sandboxId,
          })
        ).filter(
          (row) =>
            row.store_id === context.actorStoreId &&
            row.starts_at.getTime() >= range.startsAt.getTime() &&
            row.starts_at.getTime() < range.endsAt.getTime(),
        );
        const summaries = rows.map((row) => ({
          row,
          summary: staffReservationSummary(row),
        }));
        const now = currentTime.getTime();
        const result: DatabaseStaffReservationWorkbench = {
          businessDay: range,
          currentTime,
          queues: {
            anomalies: summaries
              .filter(
                ({ row, summary }) =>
                  summary.anomaly !== null &&
                  !["completed", "cancelled", "expired"].includes(row.status),
              )
              .map(({ summary }) => summary),
            arrivalWindow: summaries
              .filter(
                ({ row, summary }) =>
                  row.status === "confirmed" &&
                  now >= summary.arrivalWindow.opensAt.getTime() &&
                  now <= summary.arrivalWindow.closesAt.getTime(),
              )
              .map(({ summary }) => summary),
            arrived: summaries
              .filter(({ row }) => row.status === "arrived")
              .map(({ summary }) => summary),
            inUse: summaries
              .filter(({ row }) => row.status === "in-use")
              .map(({ summary }) => summary),
          },
          store: await readFrontlineStore(
            client,
            input.sandboxId,
            context.actorStoreId,
          ),
        };
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readStaffReservationList(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await processFrontlineReservationDeadlines(client, {
          currentTime,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
        });
        const range = businessDayRange(currentTime);
        const businessRows = (
          await readStaffReservationRows(client, {
            sandboxId: input.sandboxId,
          })
        ).filter(
          (row) =>
            row.store_id === context.actorStoreId &&
            row.starts_at.getTime() >= range.startsAt.getTime() &&
            row.starts_at.getTime() < range.endsAt.getTime(),
        );
        const normalizedSearch = input.search.trim().toLocaleLowerCase("zh-CN");
        const now = currentTime.getTime();
        const rows = businessRows.filter((row) => {
          const summary = staffReservationSummary(row);
          if (input.status && row.status !== input.status) return false;
          if (input.areaCode && summary.area.code !== input.areaCode)
            return false;
          if (
            input.machineProfileCode &&
            summary.machineProfile.code !== input.machineProfileCode
          ) {
            return false;
          }
          if (input.anomaly === "only" && summary.anomaly === null)
            return false;
          if (input.anomaly === "none" && summary.anomaly !== null)
            return false;
          if (
            input.time === "arrival-window" &&
            !(
              row.status === "confirmed" &&
              now >= summary.arrivalWindow.opensAt.getTime() &&
              now <= summary.arrivalWindow.closesAt.getTime()
            )
          ) {
            return false;
          }
          if (
            input.time === "upcoming" &&
            !(
              row.starts_at.getTime() >= now &&
              row.starts_at.getTime() <= now + 30 * 60 * 1_000
            )
          ) {
            return false;
          }
          if (
            input.time === "in-progress" &&
            row.status !== "arrived" &&
            row.status !== "in-use"
          ) {
            return false;
          }
          return (
            !normalizedSearch ||
            `${row.customer_display_name} ${row.seat_code} ${row.id}`
              .toLocaleLowerCase("zh-CN")
              .includes(normalizedSearch)
          );
        });
        const areaMap = new Map(
          businessRows.map((row) => [
            row.area_code,
            { code: row.area_code, displayName: row.area_display_name },
          ]),
        );
        const profileMap = new Map(
          businessRows.map((row) => [
            row.machine_profile_code,
            {
              code: row.machine_profile_code,
              displayName: row.machine_profile_display_name,
            },
          ]),
        );
        const result: DatabaseStaffReservationList = {
          businessDay: range,
          currentTime,
          filterOptions: {
            areas: [...areaMap.values()],
            machineProfiles: [...profileMap.values()],
          },
          rows: rows.map(staffReservationSummary),
          store: await readFrontlineStore(
            client,
            input.sandboxId,
            context.actorStoreId,
          ),
        };
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readStaffReservationDetail(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await processFrontlineReservationDeadlines(client, {
          currentTime,
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
        });
        const row = (
          await readStaffReservationRows(client, {
            reservationId: input.reservationId,
            sandboxId: input.sandboxId,
          })
        )[0];
        if (!row) throw new FrontlineReservationConflictError("not-found");
        if (row.store_id !== context.actorStoreId) {
          throw new FrontlineReservationConflictError("cross-store");
        }
        const detail = await staffReservationDetailFromRow(
          client,
          row,
          currentTime,
          input.role,
        );
        await client.query("commit");
        return detail;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async executeStaffReservationCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({
            action: input.action,
            reason: input.reason,
            reservationId: input.reservationId,
          }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:frontline:${idempotencyKeyHash}`,
          ],
        );
        const existing = await client.query<FrontlineCommandRow>(
          `select command_type, payload_hash, result_data
             from reservation_frontline_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            await recordFrontlineReservationDenial(client, {
              action: input.action,
              actorStoreId: context.actorStoreId,
              businessTime: currentTime,
              currentStatus: null,
              personaId: input.personaId,
              reason: "idempotency-conflict",
              recordedAt: wallTime,
              requestId: input.requestId,
              reservationId: input.reservationId,
              role: input.role,
              sandboxId: input.sandboxId,
            });
            await client.query("commit");
            throw new FrontlineReservationConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return frontlineCommandFromStored(existingRow.result_data, true);
        }
        await processFrontlineReservationDeadlines(client, {
          currentTime,
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
        });
        const row = (
          await readStaffReservationRows(client, {
            lock: true,
            reservationId: input.reservationId,
            sandboxId: input.sandboxId,
          })
        )[0];
        if (!row || row.store_id !== context.actorStoreId) {
          const reason = row ? "cross-store" : "not-found";
          await recordFrontlineReservationDenial(client, {
            action: input.action,
            actorStoreId: context.actorStoreId,
            businessTime: currentTime,
            currentStatus: row?.status ?? null,
            personaId: input.personaId,
            reason,
            recordedAt: wallTime,
            requestId: input.requestId,
            reservationId: input.reservationId,
            role: input.role,
            sandboxId: input.sandboxId,
          });
          await client.query("commit");
          throw new FrontlineReservationConflictError(
            reason,
            reason === "cross-store" ? null : (row?.status ?? null),
          );
        }
        const decision = decideFrontlineReservationLifecycle({
          action: input.action,
          businessTime: currentTime,
          endsAt: row.ends_at,
          hasCoupon: row.coupon_id !== null,
          holdExpiresAt: row.hold_expires_at,
          payableCents: row.price_snapshot.price.payableCents,
          startsAt: row.starts_at,
          status: row.status,
        });
        if (decision.status === "invalid") {
          const reason =
            decision.reason === "not-due"
              ? "illegal-transition"
              : decision.reason;
          await recordFrontlineReservationDenial(client, {
            action: input.action,
            actorStoreId: context.actorStoreId,
            businessTime: currentTime,
            currentStatus: row.status,
            personaId: input.personaId,
            reason,
            recordedAt: wallTime,
            requestId: input.requestId,
            reservationId: input.reservationId,
            role: input.role,
            sandboxId: input.sandboxId,
          });
          await client.query("commit");
          throw new FrontlineReservationConflictError(reason, row.status);
        }
        if (decision.couponEffect) {
          const expectedStatus =
            decision.couponEffect === "release" ? "reserved" : "redeemed";
          const restored = await client.query(
            `update experience_coupons
                set status = 'available', reserved_reservation_id = null,
                    reserved_until = null
              where sandbox_id = $1 and reserved_reservation_id = $2
                and status = $3`,
            [input.sandboxId, row.id, expectedStatus],
          );
          if (restored.rowCount !== 1) {
            throw new Error(
              "The frontline reservation coupon could not be restored.",
            );
          }
        }
        if (
          input.action === "cancel" &&
          row.status !== "pending-confirmation"
        ) {
          await client.query(
            `insert into reservation_simulated_refunds (
               id, sandbox_id, reservation_id, amount_cents, reason,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, 'frontline-cancelled-before-use',
               $5, $6)`,
            [
              randomUUID(),
              input.sandboxId,
              row.id,
              decision.simulatedRefundCents,
              currentTime,
              wallTime,
            ],
          );
        }
        const eventType = {
          arrive: "reservation.arrived",
          cancel: "reservation.cancelled",
          "complete-early": "reservation.completed-early",
          "start-use": "reservation.started",
        }[input.action];
        if (input.action === "arrive") {
          await client.query(
            `update reservations set status = 'arrived', arrived_business_at = $3
              where sandbox_id = $1 and id = $2 and status = $4`,
            [input.sandboxId, row.id, currentTime, row.status],
          );
        } else if (input.action === "start-use") {
          await client.query(
            `update reservations set status = 'in-use', started_business_at = $3
              where sandbox_id = $1 and id = $2 and status = $4`,
            [input.sandboxId, row.id, currentTime, row.status],
          );
        } else if (input.action === "complete-early") {
          await client.query(
            `update reservations
                set status = 'completed', completed_business_at = $3,
                    terminal_reason = $4
              where sandbox_id = $1 and id = $2 and status = $5`,
            [input.sandboxId, row.id, currentTime, input.reason, row.status],
          );
        } else {
          await client.query(
            `update reservations
                set status = 'cancelled', cancelled_business_at = $3,
                    terminal_reason = $4
              where sandbox_id = $1 and id = $2 and status = $5`,
            [input.sandboxId, row.id, currentTime, input.reason, row.status],
          );
        }
        if (input.action === "complete-early" || input.action === "cancel") {
          await processCustomerOrderDeadlines(client, {
            recordedAt: wallTime,
            reservationId: row.id,
            sandboxId: input.sandboxId,
            targetBusinessTime: currentTime,
          });
        }
        const growthPoints =
          input.action === "complete-early"
            ? await awardCompletedReservationGrowth(client, {
                businessOccurredAt: currentTime,
                customerPersonaId: row.customer_persona_id,
                payableCents: row.price_snapshot.price.payableCents,
                recordedAt: wallTime,
                reservationId: row.id,
                sandboxId: input.sandboxId,
              })
            : 0;
        await client.query(
          `insert into reservation_business_events (
             id, sandbox_id, reservation_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [
            randomUUID(),
            input.sandboxId,
            row.id,
            eventType,
            JSON.stringify({
              actorRole: input.role,
              growthPoints,
              reason: input.reason,
              simulatedRefundCents: decision.simulatedRefundCents,
            }),
            currentTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, $6, 'reservation', $7, 'allowed',
             $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
          [
            randomUUID(),
            input.sandboxId,
            row.store_id,
            input.personaId,
            input.role,
            `reservation.${input.action}`,
            row.id,
            input.reason,
            input.requestId,
            JSON.stringify({ status: row.status }),
            JSON.stringify({ status: decision.nextStatus }),
            currentTime,
            wallTime,
          ],
        );
        const stored = {
          action: input.action,
          occurredAt: currentTime.toISOString(),
          reservationId: row.id,
          status: decision.nextStatus,
        };
        await client.query(
          `insert into reservation_frontline_command_requests (
             sandbox_id, actor_persona_id, reservation_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            row.id,
            input.action,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return frontlineCommandFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readStaffOrderQueue(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await processCustomerOrderDeadlines(client, {
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const allRows = await readStaffOrderRows(client, {
          sandboxId: input.sandboxId,
          storeId: context.actorStoreId,
        });
        const isException = (status: CustomerOrderStatus) =>
          status === "cancelled" || status === "expired";
        const queueRows = allRows.filter((row) => {
          if (input.stage === "exception") return isException(row.status);
          if (input.stage !== "all") return row.status === input.stage;
          return (
            row.status === "simulated-paid" ||
            row.status === "preparing" ||
            row.status === "ready-for-pickup" ||
            isException(row.status)
          );
        });
        const result: DatabaseStaffOrderQueue = {
          counts: {
            exception: allRows.filter((row) => isException(row.status)).length,
            preparing: allRows.filter((row) => row.status === "preparing")
              .length,
            "ready-for-pickup": allRows.filter(
              (row) => row.status === "ready-for-pickup",
            ).length,
            "simulated-paid": allRows.filter(
              (row) => row.status === "simulated-paid",
            ).length,
          },
          currentTime,
          rows: queueRows.map((row) => staffOrderSummary(row, currentTime)),
          stage: input.stage,
          store: await readFrontlineStore(
            client,
            input.sandboxId,
            context.actorStoreId,
          ),
        };
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readStaffOrderDetail(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await processCustomerOrderDeadlines(client, {
          orderId: input.orderId,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const detail = await readStaffOrderDetailWithClient(
          client,
          input,
          context.actorStoreId,
          currentTime,
        );
        await client.query("commit");
        return detail;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async executeStaffOrderCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({
            action: input.action,
            orderId: input.orderId,
            reason: input.reason,
          }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:staff-order:${idempotencyKeyHash}`,
          ],
        );
        const existing = await client.query<StaffOrderCommandRow>(
          `select payload_hash, result_data
             from order_frontline_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            await recordStaffOrderDenial(client, {
              ...input,
              actorStoreId: context.actorStoreId,
              businessTime: currentTime,
              currentStatus: null,
              denialReason: "idempotency-conflict",
              recordedAt: wallTime,
            });
            await client.query("commit");
            throw new StaffOrderConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return staffOrderCommandFromStored(existingRow.result_data, true);
        }
        await processCustomerOrderDeadlines(client, {
          orderId: input.orderId,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const row = (
          await readStaffOrderRows(client, {
            lock: true,
            orderId: input.orderId,
            sandboxId: input.sandboxId,
            storeId: context.actorStoreId,
          })
        )[0];
        if (!row) {
          await recordStaffOrderDenial(client, {
            ...input,
            actorStoreId: context.actorStoreId,
            businessTime: currentTime,
            currentStatus: null,
            denialReason: "not-found",
            recordedAt: wallTime,
          });
          await client.query("commit");
          throw new StaffOrderConflictError("not-found");
        }
        const decision = decideStaffOrderFulfillment({
          action: input.action,
          finalSimulatedAmountCents: row.order_snapshot.payableCents,
          status: row.status,
        });
        if (decision.status === "invalid") {
          await recordStaffOrderDenial(client, {
            ...input,
            actorStoreId: context.actorStoreId,
            businessTime: currentTime,
            currentStatus: row.status,
            denialReason: decision.reason,
            recordedAt: wallTime,
          });
          await client.query("commit");
          throw new StaffOrderConflictError(decision.reason, row.status);
        }
        let couponRestored = false;
        if (decision.couponEffect === "restore" && row.order_snapshot.coupon) {
          const restored = await client.query(
            `update experience_coupons
                set status = 'available', reserved_order_id = null,
                    reserved_until = null
              where sandbox_id = $1 and reserved_order_id = $2
                and status in ('reserved', 'redeemed')`,
            [input.sandboxId, row.id],
          );
          couponRestored = restored.rowCount === 1;
          if (!couponRestored) {
            throw new Error("The order coupon could not be restored.");
          }
        }
        if (decision.inventoryEffect === "release") {
          await client.query(
            `update inventory_items item
                set reserved_quantity = item.reserved_quantity - hold.quantity
               from order_inventory_reservations hold
              where hold.sandbox_id = $1 and hold.order_id = $2
                and hold.status = 'active' and item.id = hold.inventory_item_id`,
            [input.sandboxId, row.id],
          );
          await client.query(
            `update order_inventory_reservations
                set status = 'released', released_business_at = $3
              where sandbox_id = $1 and order_id = $2 and status = 'active'`,
            [input.sandboxId, row.id, currentTime],
          );
        }
        if (
          decision.inventoryEffect === "sale" ||
          decision.inventoryEffect === "waste"
        ) {
          const holds = await client.query<{
            inventory_item_id: string;
            quantity: number;
          }>(
            `select inventory_item_id, quantity
               from order_inventory_reservations
              where sandbox_id = $1 and order_id = $2 and status = 'active'
              order by inventory_item_id for update`,
            [input.sandboxId, row.id],
          );
          for (const hold of holds.rows) {
            const balance = await client.query<{ on_hand_quantity: number }>(
              `update inventory_items
                  set on_hand_quantity = on_hand_quantity - $3,
                      reserved_quantity = reserved_quantity - $3
                where sandbox_id = $1 and id = $2
                  and on_hand_quantity >= $3 and reserved_quantity >= $3
              returning on_hand_quantity`,
              [input.sandboxId, hold.inventory_item_id, hold.quantity],
            );
            const onHandAfter = balance.rows[0]?.on_hand_quantity;
            if (onHandAfter === undefined) {
              throw new Error(
                "The reserved order inventory could not be consumed.",
              );
            }
            await client.query(
              `insert into inventory_movements (
                 id, sandbox_id, store_id, inventory_item_id, order_id,
                 reason, on_hand_delta, on_hand_after, business_occurred_at,
                 recorded_at
               ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
              [
                randomUUID(),
                input.sandboxId,
                row.store_id,
                hold.inventory_item_id,
                row.id,
                decision.inventoryEffect === "sale"
                  ? "order-sale"
                  : "order-waste",
                -hold.quantity,
                onHandAfter,
                currentTime,
                wallTime,
              ],
            );
          }
          await client.query(
            `update order_inventory_reservations
                set status = $3, released_business_at = $4
              where sandbox_id = $1 and order_id = $2 and status = 'active'`,
            [
              input.sandboxId,
              row.id,
              decision.inventoryEffect === "sale" ? "sold" : "wasted",
              currentTime,
            ],
          );
        }
        if (decision.simulatedRefundCents > 0) {
          await client.query(
            `insert into order_simulated_refunds (
               id, sandbox_id, order_id, amount_cents, reason,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              randomUUID(),
              input.sandboxId,
              row.id,
              decision.simulatedRefundCents,
              input.reason,
              currentTime,
              wallTime,
            ],
          );
        }
        let growthPoints = 0;
        if (decision.nextStatus === "completed") {
          const profile = await client.query<{ id: string }>(
            `select id from member_profiles
              where sandbox_id = $1 and customer_persona_id = $2 for update`,
            [input.sandboxId, row.customer_persona_id],
          );
          const profileId = profile.rows[0]?.id;
          if (!profileId) {
            throw new Error(
              "The completed order customer has no member profile.",
            );
          }
          const inserted = await client.query(
            `insert into member_growth_events (
               id, sandbox_id, member_profile_id, customer_persona_id,
               source_kind, source_id, final_simulated_amount_cents,
               growth_points, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, 'order', $5, $6, $7, $8, $9)
             on conflict do nothing`,
            [
              randomUUID(),
              input.sandboxId,
              profileId,
              row.customer_persona_id,
              row.id,
              row.order_snapshot.payableCents,
              decision.growthPoints,
              currentTime,
              wallTime,
            ],
          );
          if (inserted.rowCount === 1) {
            growthPoints = decision.growthPoints;
            await client.query(
              `update member_profiles set growth_points = growth_points + $3
                where sandbox_id = $1 and id = $2`,
              [input.sandboxId, profileId, growthPoints],
            );
          }
        }
        if (input.action === "start-preparing") {
          await client.query(
            `update customer_orders
                set status = 'preparing', preparing_business_at = $3
              where sandbox_id = $1 and id = $2 and status = $4`,
            [input.sandboxId, row.id, currentTime, row.status],
          );
        } else if (input.action === "mark-ready") {
          await client.query(
            `update customer_orders
                set status = 'ready-for-pickup', ready_business_at = $3
              where sandbox_id = $1 and id = $2 and status = $4`,
            [input.sandboxId, row.id, currentTime, row.status],
          );
        } else if (input.action === "complete") {
          await client.query(
            `update customer_orders
                set status = 'completed', completed_business_at = $3
              where sandbox_id = $1 and id = $2 and status = $4`,
            [input.sandboxId, row.id, currentTime, row.status],
          );
        } else {
          await client.query(
            `update customer_orders
                set status = 'cancelled', cancelled_business_at = $3,
                    terminal_reason = $4
              where sandbox_id = $1 and id = $2 and status = $5`,
            [input.sandboxId, row.id, currentTime, input.reason, row.status],
          );
        }
        const eventType = {
          cancel: "order.cancelled",
          complete: "order.completed",
          "mark-ready": "order.ready-for-pickup",
          "start-preparing": "order.preparing",
        }[input.action];
        await client.query(
          `insert into order_business_events (
             id, sandbox_id, order_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [
            randomUUID(),
            input.sandboxId,
            row.id,
            eventType,
            JSON.stringify({
              actorRole: input.role,
              couponRestored,
              finalSimulatedAmountCents:
                decision.nextStatus === "completed"
                  ? row.order_snapshot.payableCents
                  : 0,
              growthPoints,
              inventoryEffect: decision.inventoryEffect,
              reason: input.reason,
              simulatedRefundCents: decision.simulatedRefundCents,
            }),
            currentTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, $6, 'order', $7, 'allowed', $8, $9,
             $10::jsonb, $11::jsonb, $12, $13)`,
          [
            randomUUID(),
            input.sandboxId,
            row.store_id,
            input.personaId,
            input.role,
            `order.${input.action}`,
            row.id,
            input.reason,
            input.requestId,
            JSON.stringify({ status: row.status }),
            JSON.stringify({
              couponRestored,
              finalSimulatedAmountCents:
                decision.nextStatus === "completed"
                  ? row.order_snapshot.payableCents
                  : 0,
              growthPoints,
              inventoryEffect: decision.inventoryEffect,
              simulatedRefundCents: decision.simulatedRefundCents,
              status: decision.nextStatus,
            }),
            currentTime,
            wallTime,
          ],
        );
        const stored = {
          action: input.action,
          couponRestored,
          growthPoints,
          inventoryEffect: decision.inventoryEffect,
          occurredAt: currentTime.toISOString(),
          orderId: row.id,
          simulatedRefundCents: decision.simulatedRefundCents,
          status: decision.nextStatus,
        };
        await client.query(
          `insert into order_frontline_command_requests (
             sandbox_id, actor_persona_id, order_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            row.id,
            input.action,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return staffOrderCommandFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async create(input) {
      const client = await pool.connect();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");

        const wallTime = wallClock.now();
        const sandboxId = randomUUID();
        const expiresAt = new Date(wallTime.getTime() + SANDBOX_LIFETIME_MS);
        const creationKeyHash = hash(input.creationKey);
        const visitorKeyHash = hash(input.visitorKey);
        const payloadHash = hash(
          JSON.stringify({ selectedRole: input.selectedRole }),
        );

        await client.query(
          "select set_config('app.creation_key_hash', $1, true)",
          [creationKeyHash],
        );

        const insertedRequest = await client.query<CreationRequestRow>(
          `insert into sandbox_creation_requests (
             creation_key_hash, visitor_key_hash, payload_hash, sandbox_id, selected_role
           ) values ($1, $2, $3, $4, $5)
           on conflict (creation_key_hash) do nothing
           returning visitor_key_hash, payload_hash, sandbox_id, selected_role`,
          [
            creationKeyHash,
            visitorKeyHash,
            payloadHash,
            sandboxId,
            input.selectedRole,
          ],
        );

        if (insertedRequest.rowCount === 0) {
          const existingRequest = await client.query<CreationRequestRow>(
            `select visitor_key_hash, payload_hash, sandbox_id, selected_role
               from sandbox_creation_requests where creation_key_hash = $1`,
            [creationKeyHash],
          );
          let existing = existingRequest.rows[0];
          if (!existing) {
            throw new PublicSandboxOwnershipConflictError();
          }
          if (
            existing.visitor_key_hash === null &&
            existing.payload_hash === payloadHash
          ) {
            const claimedRequest = await client.query<CreationRequestRow>(
              `update sandbox_creation_requests
                  set visitor_key_hash = $2
                where creation_key_hash = $1 and visitor_key_hash is null
                returning visitor_key_hash, payload_hash, sandbox_id, selected_role`,
              [creationKeyHash, visitorKeyHash],
            );
            existing =
              claimedRequest.rows[0] ??
              (
                await client.query<CreationRequestRow>(
                  `select visitor_key_hash, payload_hash, sandbox_id, selected_role
                     from sandbox_creation_requests where creation_key_hash = $1`,
                  [creationKeyHash],
                )
              ).rows[0];
          }
          if (!existing || existing.visitor_key_hash !== visitorKeyHash) {
            throw new PublicSandboxOwnershipConflictError();
          }
          if (existing.payload_hash !== payloadHash) {
            throw new PublicSandboxIdempotencyConflictError();
          }

          await client.query("select set_config('app.sandbox_id', $1, true)", [
            existing.sandbox_id,
          ]);
          const replayed = await readSandboxResult(
            client,
            existing.sandbox_id,
            existing.selected_role,
            true,
            wallTime,
          );
          await client.query("commit");
          return replayed;
        }

        await client.query("select set_config('app.sandbox_id', $1, true)", [
          sandboxId,
        ]);
        const created = await materializePublicSandbox({
          client,
          expiresAt,
          sandboxId,
          selectedRole: input.selectedRole,
          wallTime,
        });
        await client.query("commit");
        return created;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async createCustomerPendingReservation(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({
            areaCode: input.areaCode,
            couponId: input.couponId,
            durationHours: input.durationHours,
            machineProfileCode: input.machineProfileCode,
            mode: input.mode,
            requestedStartsAt: input.requestedStartsAt?.toISOString() ?? null,
            seatCode: input.seatCode,
            storeCode: input.storeCode,
          }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:${input.personaId}:${idempotencyKeyHash}`],
        );
        const existing = await client.query<
          PendingReservationRow & { payload_hash: string }
        >(
          `select request.payload_hash, reservation.id,
                  'pending-confirmation'::text as status,
                  reservation.hold_expires_at, reservation.price_snapshot
             from reservation_command_requests request
             join reservations reservation on reservation.id = request.reservation_id
            where request.sandbox_id = $1
              and request.customer_persona_id = $2
              and request.idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            throw new CustomerReservationIdempotencyConflictError();
          }
          await client.query("commit");
          return pendingReservationResult(existingRow, true);
        }

        const storeResult = await client.query<StoreRow>(
          `select id, code, display_name, seat_count, opens_at, closes_at,
                  closes_next_day, is_open_24_hours
             from stores where sandbox_id = $1 and code = $2`,
          [input.sandboxId, input.storeCode],
        );
        const store = storeResult.rows[0];
        if (!store) {
          throw new CustomerSeatBrowseValidationError("store-not-found");
        }
        const now = businessTimeForSandbox(sandbox, wallTime);
        await processDueReservationExpirations(client, {
          kind: "pending",
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: now,
        });
        await processDueReservationExpirations(client, {
          kind: "no-show",
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: now,
        });
        const window = resolveCustomerReservationWindow({
          businessHours: {
            closesAt: store.closes_at.slice(0, 5),
            closesNextDay: store.closes_next_day,
            isOpen24Hours: store.is_open_24_hours,
            opensAt: store.opens_at.slice(0, 5),
          },
          durationHours: input.durationHours,
          mode: input.mode,
          now,
          ...(input.requestedStartsAt
            ? { requestedStartsAt: input.requestedStartsAt }
            : {}),
        });
        if (window.status === "invalid") {
          throw new CustomerSeatBrowseValidationError(window.reason);
        }
        const areaResult = await client.query<AreaSelectionRow>(
          `select id, code, display_name from store_areas
            where sandbox_id = $1 and store_id = $2 and code = $3`,
          [input.sandboxId, store.id, input.areaCode],
        );
        const area = areaResult.rows[0];
        if (!area) {
          throw new CustomerSeatBrowseValidationError("area-not-found");
        }
        const machineResult = await client.query<MachineSelectionRow>(
          `select profile.id, profile.code, profile.display_name,
                  profile.experience_description, plan.base_hourly_cents
             from machine_profiles profile
             join price_plans plan on plan.machine_profile_id = profile.id
            where profile.sandbox_id = $1 and profile.code = $2
              and profile.archived = false and plan.store_id = $3
              and plan.area_id = $4 and plan.status = 'active'
              and plan.effective_from <= $5
              and (plan.effective_until is null or plan.effective_until > $5)
            order by plan.version desc limit 1`,
          [
            input.sandboxId,
            input.machineProfileCode,
            store.id,
            area.id,
            window.startsAt,
          ],
        );
        const machine = machineResult.rows[0];
        if (!machine) {
          throw new CustomerSeatBrowseValidationError("price-plan-not-found");
        }
        const seatResult = await client.query<SeatBrowseRow>(
          `select id, code, operational_status
             from seats
            where sandbox_id = $1 and store_id = $2 and area_id = $3
              and machine_profile_id = $4 and code = $5`,
          [input.sandboxId, store.id, area.id, machine.id, input.seatCode],
        );
        const seat = seatResult.rows[0];
        if (!seat) {
          throw new CustomerReservationCreateConflictError("seat-not-found");
        }
        if (seat.operational_status !== "normal") {
          throw new CustomerReservationCreateConflictError("seat-maintenance");
        }
        const conflicts = await client.query<{
          customer_conflict: boolean;
          seat_conflict: boolean;
        }>(
          `select
             exists(
               select 1 from reservations
                where sandbox_id = $1 and seat_id = $2
                  and status = any($3::text[])
                  and starts_at < $5 and ends_at > $4
             ) as seat_conflict,
             exists(
               select 1 from reservations
                where sandbox_id = $1 and customer_persona_id = $6
                  and status = any($3::text[])
                  and starts_at < $5 and ends_at > $4
             ) as customer_conflict`,
          [
            input.sandboxId,
            seat.id,
            ["pending-confirmation", "confirmed", "arrived", "in-use"],
            window.startsAt,
            window.endsAt,
            input.personaId,
          ],
        );
        if (conflicts.rows[0]?.seat_conflict) {
          throw new CustomerReservationCreateConflictError("seat-conflict");
        }
        if (conflicts.rows[0]?.customer_conflict) {
          throw new CustomerReservationCreateConflictError("customer-conflict");
        }

        const price = priceReservationWindow({
          baseHourlyCents: machine.base_hourly_cents,
          endsAt: window.endsAt,
          startsAt: window.startsAt,
        });
        let selectedCoupon: ExperienceCouponRow | null = null;
        let couponEligibility: ReservationCouponEligibility | null = null;
        if (input.couponId) {
          const couponResult = await client.query<ExperienceCouponRow>(
            `select coupon.id, coupon.code, coupon.display_name,
                    coupon.business_kind, coupon.discount_cents,
                    coupon.minimum_spend_cents, coupon.eligible_start_minutes,
                    coupon.eligible_end_minutes, coupon.valid_from,
                    coupon.valid_until, coupon.status, store.code as store_code
               from experience_coupons coupon
               left join stores store on store.id = coupon.store_id
              where coupon.sandbox_id = $1
                and coupon.customer_persona_id = $2 and coupon.id = $3
              for update of coupon`,
            [input.sandboxId, input.personaId, input.couponId],
          );
          selectedCoupon = couponResult.rows[0] ?? null;
          if (!selectedCoupon) {
            throw new CustomerReservationCreateConflictError(
              "coupon-not-found",
            );
          }
          couponEligibility = reservationCouponEligibility({
            coupon: selectedCoupon,
            endsAt: window.endsAt,
            now,
            startsAt: window.startsAt,
            storeCode: store.code,
            subtotalCents: price.totalCents,
          });
          if (couponEligibility.status === "ineligible") {
            throw new CustomerReservationCreateConflictError(
              couponEligibility.reason === "unavailable"
                ? "coupon-unavailable"
                : "coupon-ineligible",
            );
          }
        }
        const discountCents =
          couponEligibility?.status === "eligible"
            ? couponEligibility.discountCents
            : 0;
        const holdExpiresAt = new Date(now.getTime() + 10 * 60 * 1_000);
        const reservationId = randomUUID();
        const snapshot: ReservationSnapshotRecord = {
          area: { code: area.code, displayName: area.display_name },
          coupon: selectedCoupon
            ? {
                code: selectedCoupon.code,
                discountCents,
                displayName: selectedCoupon.display_name,
              }
            : null,
          machineProfile: {
            code: machine.code,
            displayName: machine.display_name,
            experienceDescription: machine.experience_description,
          },
          price: {
            discountCents,
            payableCents: price.totalCents - discountCents,
            segments: price.segments.map((segment) => ({
              ...segment,
              endsAt: segment.endsAt.toISOString(),
              startsAt: segment.startsAt.toISOString(),
            })),
            subtotalCents: price.totalCents,
          },
          seat: { code: seat.code },
          store: { code: store.code, displayName: store.display_name },
          window: {
            endsAt: window.endsAt.toISOString(),
            startsAt: window.startsAt.toISOString(),
          },
        };
        const inserted = await client.query<PendingReservationRow>(
          `insert into reservations (
             id, sandbox_id, store_id, customer_persona_id, seat_id, status,
             starts_at, ends_at, hold_expires_at, created_business_at,
             price_snapshot, coupon_id, coupon_snapshot
           ) values ($1, $2, $3, $4, $5, 'pending-confirmation', $6, $7,
             $8, $9, $10::jsonb, $11, $12::jsonb)
           returning id, status, hold_expires_at, price_snapshot`,
          [
            reservationId,
            input.sandboxId,
            store.id,
            input.personaId,
            seat.id,
            window.startsAt,
            window.endsAt,
            holdExpiresAt,
            now,
            JSON.stringify(snapshot),
            selectedCoupon?.id ?? null,
            JSON.stringify(snapshot.coupon),
          ],
        );
        if (selectedCoupon) {
          const reserved = await client.query(
            `update experience_coupons
                set status = 'reserved', reserved_reservation_id = $1,
                    reserved_until = $2
              where id = $3 and sandbox_id = $4 and status = 'available'`,
            [reservationId, holdExpiresAt, selectedCoupon.id, input.sandboxId],
          );
          if (reserved.rowCount !== 1) {
            throw new CustomerReservationCreateConflictError(
              "coupon-unavailable",
            );
          }
        }
        await client.query(
          `insert into reservation_business_events (
             id, sandbox_id, reservation_id, event_type, event_data,
             business_occurred_at
           ) values ($1, $2, $3, 'reservation.pending-created', $4::jsonb, $5)`,
          [
            randomUUID(),
            input.sandboxId,
            reservationId,
            JSON.stringify({ holdExpiresAt: holdExpiresAt.toISOString() }),
            now,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, after_data, business_occurred_at
           ) values ($1, $2, $3, $4, 'customer', 'reservation.create',
             'reservation', $5, 'allowed', $6, $7::jsonb, $8)`,
          [
            randomUUID(),
            input.sandboxId,
            store.id,
            input.personaId,
            reservationId,
            input.requestId,
            JSON.stringify({
              holdExpiresAt: holdExpiresAt.toISOString(),
              status: "pending-confirmation",
            }),
            now,
          ],
        );
        await client.query(
          `insert into reservation_command_requests (
             sandbox_id, customer_persona_id, idempotency_key_hash,
             payload_hash, reservation_id
           ) values ($1, $2, $3, $4, $5)`,
          [
            input.sandboxId,
            input.personaId,
            idempotencyKeyHash,
            payloadHash,
            reservationId,
          ],
        );
        await client.query("commit");
        const insertedRow = inserted.rows[0];
        if (!insertedRow) {
          throw new Error("The pending reservation insert returned no row.");
        }
        return pendingReservationResult(insertedRow, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        const databaseError = error as {
          code?: string;
          constraint?: string;
        };
        if (databaseError.code === "23P01") {
          throw new CustomerReservationCreateConflictError(
            databaseError.constraint ===
              "reservations_active_customer_range_excl"
              ? "customer-conflict"
              : "seat-conflict",
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async readCustomerOrderCatalog(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        await processCustomerOrderDeadlines(client, {
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const reservation = await readEligibleOrderReservation(client, input);
        const products = await client.query<OrderCatalogProductRow>(
          `select product.id, product.name, product.description,
                  product.category, config.unit_price_cents,
                  item.id as inventory_item_id, item.on_hand_quantity,
                  item.reserved_quantity, item.low_stock_threshold,
                  (item.on_hand_quantity - item.reserved_quantity)::integer
                    as available_quantity
             from store_products config
             join products product on product.id = config.product_id
             join inventory_items item on item.id = config.inventory_item_id
            where config.sandbox_id = $1 and config.store_id = $2
              and config.listed = true and product.archived = false
              and item.kind = 'product'`,
          [input.sandboxId, reservation.store_id],
        );
        const coupons = await client.query<OrderCouponRow>(
          `select id, code, display_name, business_kind, discount_cents,
                  minimum_spend_cents, eligible_start_minutes,
                  eligible_end_minutes, valid_from, valid_until, status,
                  store_id
             from experience_coupons
            where sandbox_id = $1 and customer_persona_id = $2
              and business_kind = 'order' and status = 'available'
            order by valid_until desc, code`,
          [input.sandboxId, input.personaId],
        );
        const productByNameOrder = new Map<string, number>(
          productSeeds.map((product, index) => [product.name, index]),
        );
        const result: DatabaseCustomerOrderCatalog = {
          coupons: coupons.rows.map((coupon) => ({
            code: coupon.code,
            discountCents: coupon.discount_cents,
            displayName: coupon.display_name,
            eligibility: orderCouponAvailability(coupon, {
              currentTime,
              storeId: reservation.store_id,
            }),
            id: coupon.id,
            minimumSpendCents: coupon.minimum_spend_cents,
            validUntil: coupon.valid_until,
          })),
          currentTime,
          products: products.rows
            .toSorted(
              (left, right) =>
                (productByNameOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
                (productByNameOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER),
            )
            .map((product) => ({
              availableQuantity: product.available_quantity,
              category: product.category,
              description: product.description,
              id: product.id,
              lowStock:
                product.available_quantity <= product.low_stock_threshold,
              name: product.name,
              onHandQuantity: product.on_hand_quantity,
              reservedQuantity: product.reserved_quantity,
              unitPriceCents: product.unit_price_cents,
            })),
          reservation: {
            reservationId: reservation.id,
            seat: { code: reservation.seat_code },
            status: reservation.status as "arrived" | "in-use",
            store: {
              code: reservation.store_code,
              displayName: reservation.store_display_name,
            },
          },
        };
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async createCustomerPendingOrder(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const canonicalLines = [...input.lines].toSorted((left, right) =>
          left.productId.localeCompare(right.productId),
        );
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({
            couponId: input.couponId,
            lines: canonicalLines,
            reservationId: input.reservationId,
          }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:${input.personaId}:order:${idempotencyKeyHash}`],
        );
        const existing = await client.query<OrderCommandRow>(
          `select payload_hash, result_data from order_command_requests
            where sandbox_id = $1 and customer_persona_id = $2
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            throw new CustomerOrderConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return pendingOrderFromStored(existingRow.result_data, true);
        }
        if (canonicalLines.length === 0) {
          throw new CustomerOrderConflictError("empty-cart");
        }
        if (
          canonicalLines.some(
            (line, index) =>
              !Number.isInteger(line.quantity) ||
              line.quantity <= 0 ||
              (index > 0 &&
                canonicalLines[index - 1]?.productId === line.productId),
          )
        ) {
          throw new CustomerOrderConflictError("invalid-quantity");
        }
        await processCustomerOrderDeadlines(client, {
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const reservation = await readEligibleOrderReservation(
          client,
          input,
          true,
        );
        const products = await client.query<OrderCatalogProductRow>(
          `select product.id, product.name, product.description,
                  product.category, config.unit_price_cents,
                  item.id as inventory_item_id, item.on_hand_quantity,
                  item.reserved_quantity, item.low_stock_threshold,
                  (item.on_hand_quantity - item.reserved_quantity)::integer
                    as available_quantity
             from store_products config
             join products product on product.id = config.product_id
             join inventory_items item on item.id = config.inventory_item_id
            where config.sandbox_id = $1 and config.store_id = $2
              and config.listed = true and product.archived = false
              and item.kind = 'product' and product.id = any($3::uuid[])
            order by item.id
            for update of item`,
          [
            input.sandboxId,
            reservation.store_id,
            canonicalLines.map((line) => line.productId),
          ],
        );
        if (products.rows.length !== canonicalLines.length) {
          throw new CustomerOrderConflictError("product-not-listed");
        }
        const quantities = new Map(
          canonicalLines.map((line) => [line.productId, line.quantity]),
        );
        const pricingInput = products.rows.map((product) => ({
          availableQuantity: product.available_quantity,
          productId: product.id,
          productName: product.name,
          quantity: quantities.get(product.id) ?? 0,
          unitPriceCents: product.unit_price_cents,
        }));
        const basePricing = priceCustomerOrder({
          couponDiscountCents: 0,
          lines: pricingInput,
        });
        if (basePricing.status === "invalid") {
          throw new CustomerOrderConflictError(
            basePricing.reason === "insufficient-inventory"
              ? "insufficient-inventory"
              : basePricing.reason === "empty-cart"
                ? "empty-cart"
                : "invalid-quantity",
          );
        }
        let coupon: OrderCouponRow | null = null;
        if (input.couponId) {
          const couponResult = await client.query<OrderCouponRow>(
            `select id, code, display_name, business_kind, discount_cents,
                    minimum_spend_cents, eligible_start_minutes,
                    eligible_end_minutes, valid_from, valid_until, status,
                    store_id
               from experience_coupons
              where sandbox_id = $1 and customer_persona_id = $2 and id = $3
              for update`,
            [input.sandboxId, input.personaId, input.couponId],
          );
          coupon = couponResult.rows[0] ?? null;
          if (!coupon) throw new CustomerOrderConflictError("coupon-not-found");
          const eligibility = orderCouponAvailability(coupon, {
            currentTime,
            storeId: reservation.store_id,
            subtotalCents: basePricing.subtotalCents,
          });
          if (eligibility.status === "ineligible") {
            throw new CustomerOrderConflictError(
              eligibility.reason === "unavailable"
                ? "coupon-unavailable"
                : "coupon-ineligible",
            );
          }
        }
        const pricing = priceCustomerOrder({
          couponDiscountCents: coupon?.discount_cents ?? 0,
          lines: pricingInput,
        });
        if (pricing.status !== "ready") {
          throw new CustomerOrderConflictError("insufficient-inventory");
        }
        const orderId = randomUUID();
        const holdExpiresAt = new Date(currentTime.getTime() + 10 * 60 * 1_000);
        const snapshot: CustomerOrderSnapshot = {
          coupon: coupon
            ? {
                code: coupon.code,
                discountCents: pricing.discountCents,
                displayName: coupon.display_name,
              }
            : null,
          discountCents: pricing.discountCents,
          lines: pricing.lines,
          payableCents: pricing.payableCents,
          reservation: {
            reservationId: reservation.id,
            seatCode: reservation.seat_code,
            storeCode: reservation.store_code,
            storeDisplayName: reservation.store_display_name,
          },
          subtotalCents: pricing.subtotalCents,
        };
        await client.query(
          `insert into customer_orders (
             id, sandbox_id, store_id, customer_persona_id, reservation_id,
             seat_id, status, hold_expires_at, created_business_at,
             order_snapshot, coupon_id, coupon_snapshot
           ) values ($1, $2, $3, $4, $5, $6, 'pending-simulated-payment',
             $7, $8, $9::jsonb, $10, $11::jsonb)`,
          [
            orderId,
            input.sandboxId,
            reservation.store_id,
            input.personaId,
            reservation.id,
            reservation.seat_id,
            holdExpiresAt,
            currentTime,
            JSON.stringify(snapshot),
            coupon?.id ?? null,
            JSON.stringify(snapshot.coupon),
          ],
        );
        for (const product of products.rows) {
          const quantity = quantities.get(product.id) ?? 0;
          const reserved = await client.query(
            `update inventory_items
                set reserved_quantity = reserved_quantity + $3
              where sandbox_id = $1 and id = $2
                and on_hand_quantity - reserved_quantity >= $3`,
            [input.sandboxId, product.inventory_item_id, quantity],
          );
          if (reserved.rowCount !== 1) {
            throw new CustomerOrderConflictError("insufficient-inventory");
          }
          await client.query(
            `insert into order_inventory_reservations (
               id, sandbox_id, order_id, inventory_item_id, quantity, status
             ) values ($1, $2, $3, $4, $5, 'active')`,
            [
              randomUUID(),
              input.sandboxId,
              orderId,
              product.inventory_item_id,
              quantity,
            ],
          );
        }
        if (coupon) {
          const reservedCoupon = await client.query(
            `update experience_coupons
                set status = 'reserved', reserved_order_id = $1,
                    reserved_until = $2
              where sandbox_id = $3 and id = $4 and status = 'available'
                and reserved_reservation_id is null and reserved_order_id is null`,
            [orderId, holdExpiresAt, input.sandboxId, coupon.id],
          );
          if (reservedCoupon.rowCount !== 1) {
            throw new CustomerOrderConflictError("coupon-unavailable");
          }
        }
        await client.query(
          `insert into order_business_events (
             id, sandbox_id, order_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, 'order.pending-created', $4::jsonb, $5, $6)`,
          [
            randomUUID(),
            input.sandboxId,
            orderId,
            JSON.stringify({
              holdExpiresAt: holdExpiresAt.toISOString(),
              inventoryReservationCount: products.rows.length,
            }),
            currentTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, 'customer', 'order.create', 'order',
             $5, 'allowed', $6, $7::jsonb, $8, $9)`,
          [
            randomUUID(),
            input.sandboxId,
            reservation.store_id,
            input.personaId,
            orderId,
            input.requestId,
            JSON.stringify({
              holdExpiresAt: holdExpiresAt.toISOString(),
              status: "pending-simulated-payment",
            }),
            currentTime,
            wallTime,
          ],
        );
        const stored = {
          holdExpiresAt: holdExpiresAt.toISOString(),
          orderId,
          snapshot,
          status: "pending-simulated-payment",
        } as const;
        await client.query(
          `insert into order_command_requests (
             sandbox_id, customer_persona_id, idempotency_key_hash,
             payload_hash, order_id, result_data
           ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            idempotencyKeyHash,
            payloadHash,
            orderId,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return pendingOrderFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readCustomerOrderDetail(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        await processCustomerOrderDeadlines(client, {
          orderId: input.orderId,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const result = await readCustomerOrderDetailWithClient(
          client,
          input,
          currentTime,
        );
        await client.query("commit");
        return result.detail;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async simulateCustomerOrderPayment(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(JSON.stringify({ orderId: input.orderId }));
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:order-payment:${idempotencyKeyHash}`,
          ],
        );
        const existing = await client.query<OrderPaymentCommandRow>(
          `select payload_hash, result_data
             from order_lifecycle_command_requests
            where sandbox_id = $1 and customer_persona_id = $2
              and command_type = 'simulate-payment'
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            throw new CustomerOrderConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return orderPaymentFromStored(existingRow.result_data, true);
        }
        await processCustomerOrderDeadlines(client, {
          orderId: input.orderId,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const { detail, storeId } = await readCustomerOrderDetailWithClient(
          client,
          input,
          currentTime,
          true,
        );
        const decision = decideCustomerOrderLifecycle({
          action: "simulate-payment",
          businessTime: currentTime,
          holdExpiresAt: detail.holdExpiresAt,
          status: detail.status,
        });
        if (decision.status !== "applied") {
          await recordCustomerOrderDenial(client, {
            action: "order.simulate-payment",
            businessTime: currentTime,
            currentStatus: detail.status,
            orderId: input.orderId,
            personaId: input.personaId,
            reason:
              decision.reason === "hold-expired"
                ? "hold-expired"
                : "illegal-transition",
            recordedAt: wallTime,
            requestId: input.requestId,
            sandboxId: input.sandboxId,
            storeId,
          });
          await client.query("commit");
          throw new CustomerOrderConflictError(
            decision.reason === "hold-expired"
              ? "hold-expired"
              : "illegal-transition",
            detail.status,
          );
        }
        if (detail.coupon) {
          const redeemed = await client.query(
            `update experience_coupons
                set status = 'redeemed', reserved_until = null
              where sandbox_id = $1 and reserved_order_id = $2
                and status = 'reserved'`,
            [input.sandboxId, input.orderId],
          );
          if (redeemed.rowCount !== 1) {
            throw new CustomerOrderConflictError("illegal-transition");
          }
        }
        await client.query(
          `update customer_orders
              set status = 'simulated-paid', simulated_payment_cents = $3,
                  paid_business_at = $4
            where sandbox_id = $1 and id = $2
              and status = 'pending-simulated-payment'`,
          [
            input.sandboxId,
            input.orderId,
            detail.snapshot.payableCents,
            currentTime,
          ],
        );
        await client.query(
          `insert into order_business_events (
             id, sandbox_id, order_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, 'order.simulated-payment-succeeded',
             $4::jsonb, $5, $6)`,
          [
            randomUUID(),
            input.sandboxId,
            input.orderId,
            JSON.stringify({
              amountCents: detail.snapshot.payableCents,
              doesNotCharge: true,
            }),
            currentTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, 'customer', 'order.simulate-payment',
             'order', $5, 'allowed', $6, $7::jsonb, $8::jsonb, $9, $10)`,
          [
            randomUUID(),
            input.sandboxId,
            storeId,
            input.personaId,
            input.orderId,
            input.requestId,
            JSON.stringify({ status: detail.status }),
            JSON.stringify({
              doesNotCharge: true,
              status: "simulated-paid",
            }),
            currentTime,
            wallTime,
          ],
        );
        const stored = {
          orderId: input.orderId,
          payment: {
            amountCents: detail.snapshot.payableCents,
            doesNotCharge: true,
            occurredAt: currentTime.toISOString(),
            simulated: true,
          },
          status: "simulated-paid",
        } as const;
        await client.query(
          `insert into order_lifecycle_command_requests (
             sandbox_id, customer_persona_id, order_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, 'simulate-payment', $4, $5, $6::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            input.orderId,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return orderPaymentFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async cancelCustomerOrder(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({ orderId: input.orderId, reason: input.reason }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:order-cancel:${idempotencyKeyHash}`,
          ],
        );
        const existing = await client.query<OrderCancelCommandRow>(
          `select payload_hash, result_data
             from order_lifecycle_command_requests
            where sandbox_id = $1 and customer_persona_id = $2
              and command_type = 'cancel' and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            throw new CustomerOrderConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return orderCancellationFromStored(existingRow.result_data, true);
        }
        await processCustomerOrderDeadlines(client, {
          orderId: input.orderId,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const { detail, storeId } = await readCustomerOrderDetailWithClient(
          client,
          input,
          currentTime,
          true,
        );
        const decision = decideCustomerOrderLifecycle({
          action: "cancel",
          businessTime: currentTime,
          holdExpiresAt: detail.holdExpiresAt,
          status: detail.status,
        });
        if (decision.status !== "applied") {
          await recordCustomerOrderDenial(client, {
            action: "order.cancel",
            businessTime: currentTime,
            currentStatus: detail.status,
            orderId: input.orderId,
            personaId: input.personaId,
            reason:
              decision.reason === "hold-expired"
                ? "hold-expired"
                : "illegal-transition",
            recordedAt: wallTime,
            requestId: input.requestId,
            sandboxId: input.sandboxId,
            storeId,
          });
          await client.query("commit");
          throw new CustomerOrderConflictError(
            decision.reason === "hold-expired"
              ? "hold-expired"
              : "illegal-transition",
            detail.status,
          );
        }
        const couponRestored = detail.coupon !== null;
        const shouldRefund = detail.status === "simulated-paid";
        const refund = shouldRefund
          ? {
              amountCents: detail.snapshot.payableCents,
              occurredAt: currentTime.toISOString(),
              reason: input.reason,
              simulated: true as const,
            }
          : null;
        const changed = await releaseOrderHold(client, {
          businessTime: currentTime,
          eventType: "order.customer-cancelled",
          expectedStatus: detail.status as
            "pending-simulated-payment" | "simulated-paid",
          nextStatus: "cancelled",
          orderId: input.orderId,
          reason: input.reason,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
        });
        if (!changed) {
          throw new CustomerOrderConflictError("illegal-transition");
        }
        if (refund) {
          await client.query(
            `insert into order_simulated_refunds (
               id, sandbox_id, order_id, amount_cents, reason,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              randomUUID(),
              input.sandboxId,
              input.orderId,
              refund.amountCents,
              refund.reason,
              currentTime,
              wallTime,
            ],
          );
        }
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, 'customer', 'order.cancel', 'order',
             $5, 'allowed', $6, $7, $8::jsonb, $9::jsonb, $10, $11)`,
          [
            randomUUID(),
            input.sandboxId,
            storeId,
            input.personaId,
            input.orderId,
            input.reason,
            input.requestId,
            JSON.stringify({ status: detail.status }),
            JSON.stringify({
              couponRestored,
              simulatedRefundCents: refund?.amountCents ?? 0,
              status: "cancelled",
            }),
            currentTime,
            wallTime,
          ],
        );
        const stored = {
          cancelledAt: currentTime.toISOString(),
          couponRestored,
          orderId: input.orderId,
          refund,
          status: "cancelled",
        } as const;
        await client.query(
          `insert into order_lifecycle_command_requests (
             sandbox_id, customer_persona_id, order_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, 'cancel', $4, $5, $6::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            input.orderId,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return orderCancellationFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async cancelCustomerReservation(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({
            reason: input.reason,
            reservationId: input.reservationId,
          }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:cancel:${idempotencyKeyHash}`,
          ],
        );
        const existing = await client.query<ReservationCancelCommandRow>(
          `select payload_hash, result_data
             from reservation_lifecycle_command_requests
            where sandbox_id = $1 and customer_persona_id = $2
              and command_type = 'cancel' and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            throw new CustomerReservationIdempotencyConflictError();
          }
          await client.query("commit");
          return cancellationFromStored(existingRow.result_data, true);
        }

        await processDueReservationExpirations(client, {
          kind: "pending",
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        await processDueReservationExpirations(client, {
          kind: "no-show",
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });

        const { detail, storeId } =
          await readCustomerReservationDetailWithClient(
            client,
            input,
            currentTime,
            true,
          );
        const decision = decideReservationLifecycle({
          action: "cancel",
          businessTime: currentTime,
          hasCoupon: detail.coupon !== null,
          holdExpiresAt: detail.holdExpiresAt,
          payableCents: detail.snapshot.price.payableCents,
          startsAt: detail.snapshot.window.startsAt,
          status: detail.status,
        });
        if (decision.status === "invalid") {
          const reason =
            decision.reason === "not-due"
              ? "illegal-transition"
              : decision.reason;
          await recordReservationLifecycleDenial(client, {
            action: "reservation.cancel",
            businessTime: currentTime,
            currentStatus: detail.status,
            personaId: input.personaId,
            reason,
            recordedAt: wallTime,
            requestId: input.requestId,
            reservationId: input.reservationId,
            sandboxId: input.sandboxId,
            storeId,
          });
          await client.query("commit");
          throw new CustomerReservationLifecycleConflictError(
            reason,
            detail.status,
          );
        }
        const couponRestored = decision.couponEffect !== null;
        if (decision.couponEffect) {
          const expectedStatus =
            decision.couponEffect === "release" ? "reserved" : "redeemed";
          const restored = await client.query(
            `update experience_coupons
                set status = 'available', reserved_reservation_id = null,
                    reserved_until = null
              where sandbox_id = $1 and reserved_reservation_id = $2
                and status = $3`,
            [input.sandboxId, input.reservationId, expectedStatus],
          );
          if (restored.rowCount !== 1) {
            throw new CustomerReservationLifecycleConflictError(
              "illegal-transition",
            );
          }
        }
        const refundReason = "customer-cancelled-before-start" as const;
        const shouldRefund = detail.status === "confirmed";
        if (shouldRefund) {
          await client.query(
            `insert into reservation_simulated_refunds (
               id, sandbox_id, reservation_id, amount_cents, reason,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              randomUUID(),
              input.sandboxId,
              input.reservationId,
              decision.simulatedRefundCents,
              refundReason,
              currentTime,
              wallTime,
            ],
          );
        }
        await client.query(
          `update reservations
              set status = 'cancelled', cancelled_business_at = $4,
                  terminal_reason = $5
            where sandbox_id = $1 and customer_persona_id = $2 and id = $3`,
          [
            input.sandboxId,
            input.personaId,
            input.reservationId,
            currentTime,
            input.reason,
          ],
        );
        await processCustomerOrderDeadlines(client, {
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        await client.query(
          `insert into reservation_business_events (
             id, sandbox_id, reservation_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, 'reservation.cancelled', $4::jsonb, $5, $6)`,
          [
            randomUUID(),
            input.sandboxId,
            input.reservationId,
            JSON.stringify({
              couponRestored,
              reason: input.reason,
              simulatedRefundCents: decision.simulatedRefundCents,
            }),
            currentTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, 'customer', 'reservation.cancel',
             'reservation', $5, 'allowed', $6, $7, $8::jsonb, $9::jsonb,
             $10, $11)`,
          [
            randomUUID(),
            input.sandboxId,
            storeId,
            input.personaId,
            input.reservationId,
            input.reason,
            input.requestId,
            JSON.stringify({ status: detail.status }),
            JSON.stringify({
              couponRestored,
              simulatedRefundCents: decision.simulatedRefundCents,
              status: decision.nextStatus,
            }),
            currentTime,
            wallTime,
          ],
        );
        const stored = {
          cancelledAt: currentTime.toISOString(),
          couponRestored,
          refund: shouldRefund
            ? {
                amountCents: decision.simulatedRefundCents,
                occurredAt: currentTime.toISOString(),
                reason: refundReason,
                simulated: true as const,
              }
            : null,
          reservationId: input.reservationId,
          status: "cancelled",
        } as const;
        await client.query(
          `insert into reservation_lifecycle_command_requests (
             sandbox_id, customer_persona_id, reservation_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, 'cancel', $4, $5, $6::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            input.reservationId,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return cancellationFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async simulateCustomerReservationPayment(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({ reservationId: input.reservationId }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:simulate-payment:${idempotencyKeyHash}`,
          ],
        );
        const existing = await client.query<ReservationLifecycleCommandRow>(
          `select payload_hash, result_data
             from reservation_lifecycle_command_requests
            where sandbox_id = $1 and customer_persona_id = $2
              and command_type = 'simulate-payment'
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            throw new CustomerReservationIdempotencyConflictError();
          }
          await client.query("commit");
          return paymentFromStored(existingRow.result_data, true);
        }

        await processDueReservationExpirations(client, {
          kind: "pending",
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        await processDueReservationExpirations(client, {
          kind: "no-show",
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });

        const { detail, storeId } =
          await readCustomerReservationDetailWithClient(
            client,
            input,
            currentTime,
            true,
          );
        const decision = decideReservationLifecycle({
          action: "simulate-payment",
          businessTime: currentTime,
          hasCoupon: detail.coupon !== null,
          holdExpiresAt: detail.holdExpiresAt,
          payableCents: detail.snapshot.price.payableCents,
          startsAt: detail.snapshot.window.startsAt,
          status: detail.status,
        });
        if (decision.status === "invalid") {
          const reason =
            decision.reason === "not-due"
              ? "illegal-transition"
              : decision.reason;
          await recordReservationLifecycleDenial(client, {
            action: "reservation.simulate-payment",
            businessTime: currentTime,
            currentStatus: detail.status,
            personaId: input.personaId,
            reason,
            recordedAt: wallTime,
            requestId: input.requestId,
            reservationId: input.reservationId,
            sandboxId: input.sandboxId,
            storeId,
          });
          await client.query("commit");
          throw new CustomerReservationLifecycleConflictError(
            reason,
            detail.status,
          );
        }
        if (decision.couponEffect === "redeem") {
          const redeemed = await client.query(
            `update experience_coupons
                set status = 'redeemed', reserved_until = null
              where sandbox_id = $1 and reserved_reservation_id = $2
                and status = 'reserved'`,
            [input.sandboxId, input.reservationId],
          );
          if (redeemed.rowCount !== 1) {
            throw new CustomerReservationLifecycleConflictError(
              "illegal-transition",
            );
          }
        }
        await client.query(
          `update reservations
              set status = 'confirmed', simulated_payment_cents = $4,
                  confirmed_business_at = $5
            where sandbox_id = $1 and customer_persona_id = $2 and id = $3`,
          [
            input.sandboxId,
            input.personaId,
            input.reservationId,
            decision.simulatedPaymentCents,
            currentTime,
          ],
        );
        await client.query(
          `insert into reservation_business_events (
             id, sandbox_id, reservation_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, 'reservation.simulated-payment-succeeded',
             $4::jsonb, $5, $6)`,
          [
            randomUUID(),
            input.sandboxId,
            input.reservationId,
            JSON.stringify({
              amountCents: decision.simulatedPaymentCents,
              doesNotCharge: true,
            }),
            currentTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, 'customer',
             'reservation.simulate-payment', 'reservation', $5, 'allowed',
             $6, $7::jsonb, $8::jsonb, $9, $10)`,
          [
            randomUUID(),
            input.sandboxId,
            storeId,
            input.personaId,
            input.reservationId,
            input.requestId,
            JSON.stringify({ status: detail.status }),
            JSON.stringify({
              simulatedPaymentCents: decision.simulatedPaymentCents,
              status: decision.nextStatus,
            }),
            currentTime,
            wallTime,
          ],
        );
        const stored = {
          payment: {
            amountCents: decision.simulatedPaymentCents,
            occurredAt: currentTime.toISOString(),
            simulated: true,
          },
          reservationId: input.reservationId,
          status: "confirmed",
        } as const;
        await client.query(
          `insert into reservation_lifecycle_command_requests (
             sandbox_id, customer_persona_id, reservation_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, 'simulate-payment', $4, $5, $6::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            input.reservationId,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return paymentFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readCustomerReservationDetail(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        await processDueReservationExpirations(client, {
          kind: "pending",
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        await processDueReservationExpirations(client, {
          kind: "no-show",
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        await processCustomerOrderDeadlines(client, {
          recordedAt: wallTime,
          reservationId: input.reservationId,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const result = await readCustomerReservationDetailWithClient(
          client,
          input,
          currentTime,
        );
        await client.query("commit");
        return result.detail;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readCustomerMembership(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        await processFrontlineReservationDeadlines(client, {
          currentTime,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
        });
        const profileResult = await client.query<MembershipProfileRow>(
          `select profile.id, profile.growth_points,
                  persona.display_name as customer_display_name
             from member_profiles profile
             join demo_personas persona on persona.id = profile.customer_persona_id
            where profile.sandbox_id = $1 and profile.customer_persona_id = $2`,
          [input.sandboxId, input.personaId],
        );
        const profile = profileResult.rows[0];
        if (!profile) throw new RoleContextUnavailableError();
        const couponResult = await client.query<MembershipCouponRow>(
          `select coupon.id, coupon.code, coupon.display_name,
                  coupon.business_kind, coupon.discount_cents,
                  coupon.minimum_spend_cents, coupon.eligible_start_minutes,
                  coupon.eligible_end_minutes, coupon.valid_from,
                  coupon.valid_until, coupon.status,
                  coupon.reserved_reservation_id, coupon.reserved_order_id,
                  store.code as store_code,
                  store.display_name as store_display_name,
                  reservation.id as reservation_id,
                  reservation.status as reservation_status,
                  orders.id as order_id, orders.status as order_status,
                  orders.order_snapshot->'reservation'->>'storeDisplayName'
                    as order_store_display_name
             from experience_coupons coupon
             left join stores store on store.id = coupon.store_id
             left join lateral (
               select candidate.id, candidate.status
                 from reservations candidate
                where candidate.sandbox_id = coupon.sandbox_id
                  and candidate.customer_persona_id = coupon.customer_persona_id
                  and candidate.coupon_id = coupon.id
                order by candidate.created_business_at desc nulls last,
                         candidate.id desc
                limit 1
             ) reservation on true
             left join lateral (
               select candidate.id, candidate.status, candidate.order_snapshot
                 from customer_orders candidate
                where candidate.sandbox_id = coupon.sandbox_id
                  and candidate.customer_persona_id = coupon.customer_persona_id
                  and candidate.coupon_id = coupon.id
                order by candidate.created_business_at desc, candidate.id desc
                limit 1
             ) orders on true
            where coupon.sandbox_id = $1
              and coupon.customer_persona_id = $2
            order by coupon.valid_until desc, coupon.code`,
          [input.sandboxId, input.personaId],
        );
        const growthResult = await client.query<MembershipGrowthEventRow>(
          `select growth.id, growth.source_kind, growth.source_id,
                  growth.final_simulated_amount_cents, growth.growth_points,
                  growth.business_occurred_at,
                  store.display_name as store_display_name
             from member_growth_events growth
             left join reservations reservation
               on growth.source_kind = 'reservation'
              and reservation.id = growth.source_id
             left join stores store on store.id = reservation.store_id
            where growth.sandbox_id = $1 and growth.customer_persona_id = $2
            order by growth.business_occurred_at desc, growth.id`,
          [input.sandboxId, input.personaId],
        );
        const tier = memberTierForGrowth(profile.growth_points);
        const result: DatabaseCustomerMembership = {
          coupons: couponResult.rows.map((coupon) => {
            const status = deriveExperienceCouponStatus({
              now: currentTime,
              status: coupon.status,
              validUntil: coupon.valid_until,
            });
            const transactionId =
              coupon.business_kind === "reservation"
                ? status === "reserved"
                  ? coupon.reserved_reservation_id
                  : status === "redeemed"
                    ? coupon.reservation_id
                    : null
                : status === "reserved"
                  ? coupon.reserved_order_id
                  : status === "redeemed"
                    ? coupon.order_id
                    : null;
            return {
              businessKind: coupon.business_kind,
              code: coupon.code,
              discountCents: coupon.discount_cents,
              displayName: coupon.display_name,
              id: coupon.id,
              minimumSpendCents: coupon.minimum_spend_cents,
              releaseCondition:
                status === "available"
                  ? "提交待处理交易时排他占用；每笔交易最多使用一张。"
                  : status === "reserved"
                    ? coupon.business_kind === "reservation"
                      ? "完成模拟支付后标记已使用；使用前取消或保留过期会恢复可用。"
                      : "完成模拟支付后标记已使用；制作前取消或保留过期会恢复可用。"
                    : status === "redeemed"
                      ? coupon.business_kind === "reservation"
                        ? "预约开始使用前取消可恢复；开始使用后不再恢复。"
                        : "订单开始制作前取消可恢复；开始制作后不再恢复。"
                      : "有效期已结束，不再占用任何交易。",
              status,
              store:
                coupon.store_code && coupon.store_display_name
                  ? {
                      code: coupon.store_code,
                      displayName: coupon.store_display_name,
                    }
                  : null,
              transaction: transactionId
                ? coupon.business_kind === "reservation" &&
                  coupon.reservation_status
                  ? {
                      id: transactionId,
                      kind: "reservation",
                      label: `${coupon.store_display_name ?? "三店"}预约`,
                      status: coupon.reservation_status,
                    }
                  : coupon.business_kind === "order" && coupon.order_status
                    ? {
                        id: transactionId,
                        kind: "order",
                        label: `${coupon.order_store_display_name ?? "三店"}商品订单`,
                        status: coupon.order_status,
                      }
                    : null
                : null,
              validFrom: coupon.valid_from,
              validUntil: coupon.valid_until,
            };
          }),
          currentTime,
          growthEvents: growthResult.rows.map((event) => ({
            businessOccurredAt: event.business_occurred_at,
            finalSimulatedAmountCents: event.final_simulated_amount_cents,
            growthPoints: event.growth_points,
            id: event.id,
            label:
              event.source_kind === "seed-baseline"
                ? "标准故事起始累计成长"
                : event.source_kind === "reservation"
                  ? `完成预约 · ${event.store_display_name ?? "三店"}`
                  : "完成商品订单",
            source: { id: event.source_id, kind: event.source_kind },
          })),
          profile: {
            customerDisplayName: profile.customer_display_name,
            growthPoints: tier.growthPoints,
            nextThreshold: tier.nextThreshold,
            remainingToNext: tier.remainingToNext,
            tier: tier.tier,
          },
        };
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readCustomerJourney(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        await processFrontlineReservationDeadlines(client, {
          currentTime,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
        });
        const rows = await client.query<CustomerJourneyRow>(
          `select reservation.id, reservation.status,
                  reservation.price_snapshot, reservation.terminal_reason,
                  refund.amount_cents as refund_amount_cents,
                  refund.reason as refund_reason,
                  growth.growth_points
             from reservations reservation
             left join reservation_simulated_refunds refund
               on refund.sandbox_id = reservation.sandbox_id
              and refund.reservation_id = reservation.id
             left join member_growth_events growth
               on growth.sandbox_id = reservation.sandbox_id
              and growth.customer_persona_id = reservation.customer_persona_id
              and growth.source_kind = 'reservation'
              and growth.source_id = reservation.id
            where reservation.sandbox_id = $1
              and reservation.customer_persona_id = $2
              and reservation.price_snapshot is not null
            order by (reservation.price_snapshot->'window'->>'startsAt')::timestamptz desc,
                     reservation.id`,
          [input.sandboxId, input.personaId],
        );
        const groups: DatabaseCustomerJourney["groups"] = {
          current: [],
          future: [],
          history: [],
        };
        for (const row of rows.rows) {
          const snapshot = reservationSnapshot(row.price_snapshot);
          const relatedOrders = await readRelatedOrders(
            client,
            input.sandboxId,
            row.id,
          );
          const item: DatabaseCustomerJourneyReservation = {
            area: snapshot.area,
            coupon: snapshot.coupon
              ? {
                  discountCents: snapshot.coupon.discountCents,
                  displayName: snapshot.coupon.displayName,
                }
              : null,
            growthAward:
              row.growth_points === null
                ? null
                : { growthPoints: row.growth_points },
            machineProfile: {
              code: snapshot.machineProfile.code,
              displayName: snapshot.machineProfile.displayName,
            },
            payableCents: snapshot.price.payableCents,
            refund:
              row.refund_amount_cents !== null && row.refund_reason
                ? {
                    amountCents: row.refund_amount_cents,
                    reason: row.refund_reason,
                  }
                : null,
            related: { orders: relatedOrders, repairs: [] },
            reservationId: row.id,
            seat: snapshot.seat,
            status: row.status,
            store: snapshot.store,
            terminalReason: row.terminal_reason,
            window: snapshot.window,
          };
          if (["cancelled", "completed", "expired"].includes(row.status)) {
            (groups.history as DatabaseCustomerJourneyReservation[]).push(item);
          } else if (
            snapshot.window.startsAt.getTime() > currentTime.getTime()
          ) {
            (groups.future as DatabaseCustomerJourneyReservation[]).push(item);
          } else {
            (groups.current as DatabaseCustomerJourneyReservation[]).push(item);
          }
        }
        await client.query("commit");
        return { currentTime, groups };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readCustomerStoreCatalog(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const operator = await client.query<{ city: string }>(
          "select city from operators where sandbox_id = $1",
          [input.sandboxId],
        );
        const stores = await client.query<StoreRow>(
          `select id, code, display_name, seat_count, opens_at, closes_at,
                  closes_next_day, is_open_24_hours
             from stores where sandbox_id = $1`,
          [input.sandboxId],
        );
        const areas = await client.query<AreaCatalogRow>(
          `select area.store_id, area.code, area.display_name,
                  count(seat.id)::integer as seat_count
             from store_areas area
             left join seats seat on seat.area_id = area.id
            where area.sandbox_id = $1
            group by area.id, area.store_id, area.code, area.display_name,
                     area.sort_order
            order by area.sort_order`,
          [input.sandboxId],
        );
        const machines = await client.query<MachineCatalogRow>(
          `select seat.store_id, profile.code, profile.display_name,
                  profile.experience_description,
                  count(distinct seat.id)::integer as seat_count,
                  min(plan.base_hourly_cents)::integer as base_hourly_cents
             from seats seat
             join machine_profiles profile on profile.id = seat.machine_profile_id
             join price_plans plan
               on plan.store_id = seat.store_id
              and plan.machine_profile_id = seat.machine_profile_id
              and plan.status = 'active'
            where seat.sandbox_id = $1 and profile.archived = false
            group by seat.store_id, profile.code, profile.display_name,
                     profile.experience_description`,
          [input.sandboxId],
        );
        const storeOrder = new Map(
          storeSeeds.map((store, index) => [store.code, index]),
        );
        const machineOrder = new Map(
          publicSandboxSeed.machineProfiles.map((profile, index) => [
            profile.code,
            index,
          ]),
        );
        const orderedStores = stores.rows.toSorted(
          (left, right) =>
            (storeOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
            (storeOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER),
        );
        const city = operator.rows[0]?.city;
        if (!city) {
          throw new Error("The customer store catalog has no operator city.");
        }
        const result: DatabaseCustomerStoreCatalog = {
          city,
          currentTime: businessTimeForSandbox(sandbox, wallTime),
          stores: orderedStores.map((store) => ({
            areas: areas.rows
              .filter((area) => area.store_id === store.id)
              .map((area) => ({
                code: area.code,
                displayName: area.display_name,
                seatCount: area.seat_count,
              })),
            businessHours: formatBusinessHours(store),
            closesAt: store.closes_at.slice(0, 5),
            closesNextDay: store.closes_next_day,
            code: store.code,
            displayName: store.display_name,
            isOpen24Hours: store.is_open_24_hours,
            machineProfiles: machines.rows
              .filter((machine) => machine.store_id === store.id)
              .toSorted(
                (left, right) =>
                  (machineOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
                  (machineOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER),
              )
              .map((machine) => ({
                baseHourlyCents: machine.base_hourly_cents,
                code: machine.code,
                displayName: machine.display_name,
                experienceDescription: machine.experience_description,
                seatCount: machine.seat_count,
              })),
            opensAt: store.opens_at.slice(0, 5),
            seatCount: store.seat_count,
          })),
        };
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readCustomerSeatAvailability(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertCustomerBrowseContext(
          client,
          input,
          wallTime,
        );
        const storeResult = await client.query<StoreRow>(
          `select id, code, display_name, seat_count, opens_at, closes_at,
                  closes_next_day, is_open_24_hours
             from stores where sandbox_id = $1 and code = $2`,
          [input.sandboxId, input.storeCode],
        );
        const store = storeResult.rows[0];
        if (!store) {
          throw new CustomerSeatBrowseValidationError("store-not-found");
        }
        const now = businessTimeForSandbox(sandbox, wallTime);
        await processDueReservationExpirations(client, {
          kind: "pending",
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: now,
        });
        await processDueReservationExpirations(client, {
          kind: "no-show",
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: now,
        });
        const window = resolveCustomerReservationWindow({
          businessHours: {
            closesAt: store.closes_at.slice(0, 5),
            closesNextDay: store.closes_next_day,
            isOpen24Hours: store.is_open_24_hours,
            opensAt: store.opens_at.slice(0, 5),
          },
          durationHours: input.durationHours,
          mode: input.mode,
          now,
          ...(input.requestedStartsAt
            ? { requestedStartsAt: input.requestedStartsAt }
            : {}),
        });
        if (window.status === "invalid") {
          throw new CustomerSeatBrowseValidationError(window.reason);
        }
        const areaResult = await client.query<AreaSelectionRow>(
          `select id, code, display_name from store_areas
            where sandbox_id = $1 and store_id = $2 and code = $3`,
          [input.sandboxId, store.id, input.areaCode],
        );
        const area = areaResult.rows[0];
        if (!area) {
          throw new CustomerSeatBrowseValidationError("area-not-found");
        }
        const machineResult = await client.query<MachineSelectionRow>(
          `select profile.id, profile.code, profile.display_name,
                  profile.experience_description, plan.base_hourly_cents
             from machine_profiles profile
             join price_plans plan on plan.machine_profile_id = profile.id
            where profile.sandbox_id = $1 and profile.code = $2
              and profile.archived = false and plan.store_id = $3
              and plan.area_id = $4 and plan.status = 'active'
              and plan.effective_from <= $5
              and (plan.effective_until is null or plan.effective_until > $5)
            order by plan.version desc limit 1`,
          [
            input.sandboxId,
            input.machineProfileCode,
            store.id,
            area.id,
            window.startsAt,
          ],
        );
        const machine = machineResult.rows[0];
        if (!machine) {
          const profileExists = await client.query<{ exists: boolean }>(
            `select exists(
               select 1 from machine_profiles
                where sandbox_id = $1 and code = $2 and archived = false
             ) as exists`,
            [input.sandboxId, input.machineProfileCode],
          );
          throw new CustomerSeatBrowseValidationError(
            profileExists.rows[0]?.exists
              ? "price-plan-not-found"
              : "machine-profile-not-found",
          );
        }
        const seatResult = await client.query<SeatBrowseRow>(
          `select id, code, operational_status
             from seats
            where sandbox_id = $1 and store_id = $2 and area_id = $3
              and machine_profile_id = $4
            order by sort_order`,
          [input.sandboxId, store.id, area.id, machine.id],
        );
        const seatIds = seatResult.rows.map((seat) => seat.id);
        const reservationResult =
          seatIds.length === 0
            ? { rows: [] as ReservationBrowseRow[] }
            : await client.query<ReservationBrowseRow>(
                `select seat_id, status, starts_at, ends_at
                   from reservations
                  where sandbox_id = $1 and seat_id = any($2::uuid[])
                    and status = any($3::text[])
                    and starts_at < $4 and ends_at > $5`,
                [
                  input.sandboxId,
                  seatIds,
                  ["pending-confirmation", "confirmed", "arrived", "in-use"],
                  window.endsAt,
                  window.startsAt,
                ],
              );
        const reservationsBySeat = new Map<string, ReservationBrowseRow[]>();
        for (const reservation of reservationResult.rows) {
          const reservations =
            reservationsBySeat.get(reservation.seat_id) ?? [];
          reservations.push(reservation);
          reservationsBySeat.set(reservation.seat_id, reservations);
        }
        const price = priceReservationWindow({
          baseHourlyCents: machine.base_hourly_cents,
          endsAt: window.endsAt,
          startsAt: window.startsAt,
        });
        const couponResult = await client.query<ExperienceCouponRow>(
          `select coupon.id, coupon.code, coupon.display_name,
                  coupon.business_kind, coupon.discount_cents,
                  coupon.minimum_spend_cents, coupon.eligible_start_minutes,
                  coupon.eligible_end_minutes, coupon.valid_from,
                  coupon.valid_until, coupon.status, store.code as store_code
             from experience_coupons coupon
             left join stores store on store.id = coupon.store_id
            where coupon.sandbox_id = $1
              and coupon.customer_persona_id = $2
              and coupon.business_kind = 'reservation'
            order by coupon.code`,
          [input.sandboxId, input.personaId],
        );
        const result: DatabaseCustomerSeatAvailability = {
          area: { code: area.code, displayName: area.display_name },
          machineProfile: {
            code: machine.code,
            displayName: machine.display_name,
            experienceDescription: machine.experience_description,
          },
          price: {
            baseHourlyCents: machine.base_hourly_cents,
            segments: price.segments,
            totalCents: price.totalCents,
          },
          coupons: couponResult.rows.map((coupon) => ({
            code: coupon.code,
            discountCents: coupon.discount_cents,
            displayName: coupon.display_name,
            eligibility: reservationCouponEligibility({
              coupon,
              endsAt: window.endsAt,
              now,
              startsAt: window.startsAt,
              storeCode: store.code,
              subtotalCents: price.totalCents,
            }),
            id: coupon.id,
            minimumSpendCents: coupon.minimum_spend_cents,
            validUntil: coupon.valid_until,
          })),
          seats: seatResult.rows.map((seat) => ({
            availability: deriveSeatAvailability({
              endsAt: window.endsAt,
              operationalStatus: seat.operational_status,
              reservations: (reservationsBySeat.get(seat.id) ?? []).map(
                (reservation) => ({
                  endsAt: reservation.ends_at,
                  startsAt: reservation.starts_at,
                  status: reservation.status,
                }),
              ),
              startsAt: window.startsAt,
            }),
            code: seat.code,
            operationalStatus: seat.operational_status,
          })),
          store: { code: store.code, displayName: store.display_name },
          window: {
            endsAt: window.endsAt,
            mode: input.mode,
            startsAt: window.startsAt,
          },
        };
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readCurrentRoleContext(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);

        const sandbox = await client.query<SandboxRow>(
          `select ${SANDBOX_ROW_COLUMNS}
             from sandboxes where id = $1 for update`,
          [input.sandboxId],
        );
        let sandboxRow = sandbox.rows[0];
        if (
          !sandboxRow ||
          sandboxRow.invalidated_at !== null ||
          sandboxRow.expires_at.getTime() <= wallTime.getTime()
        ) {
          throw new RoleContextUnavailableError();
        }
        if (!sandboxRow.role_context_role && input.claimRole) {
          const claimed = await client.query<SandboxRow>(
            `update sandboxes
                set role_context_role = $2
              where id = $1 and role_context_role is null
            returning ${SANDBOX_ROW_COLUMNS}`,
            [input.sandboxId, input.claimRole],
          );
          sandboxRow = claimed.rows[0] ?? sandboxRow;
        }
        if (!sandboxRow.role_context_role) {
          throw new RoleContextUnavailableError();
        }

        const persona = await client.query<PersonaRow>(
          `select id, display_name, protected, role, scope, store_id
             from demo_personas
            where sandbox_id = $1 and role = $2`,
          [input.sandboxId, sandboxRow.role_context_role],
        );
        const personaRow = persona.rows[0];
        if (!personaRow || !personaRow.protected) {
          throw new RoleContextUnavailableError();
        }

        const shouldFence =
          input.fence &&
          sandboxRow.role_context_version === input.fence.contextVersion &&
          sandboxRow.role_context_role === input.fence.role;
        if (shouldFence) {
          if (personaRow.id !== input.fence?.personaId) {
            throw new RoleContextUnavailableError();
          }
          const fenced = await client.query<SandboxRow>(
            `update sandboxes
                set role_context_version = role_context_version + 1
              where id = $1 and role_context_version = $2
                    and role_context_role = $3
            returning ${SANDBOX_ROW_COLUMNS}`,
            [input.sandboxId, input.fence.contextVersion, input.fence.role],
          );
          const fencedRow = fenced.rows[0];
          if (!fencedRow) throw new RoleContextStaleError();
          sandboxRow = fencedRow;
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action, object_type,
               object_id, result, reason, request_id, before_data, after_data,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, $5, 'role_context.recover',
               'role_context', null, 'allowed', null, $6, $7::jsonb, $8::jsonb,
               $9, $10)`,
            [
              randomUUID(),
              input.sandboxId,
              personaRow.store_id,
              personaRow.id,
              personaRow.role,
              input.fence.requestId,
              JSON.stringify({
                contextVersion: input.fence.contextVersion,
                role: input.fence.role,
              }),
              JSON.stringify({
                contextVersion: fencedRow.role_context_version,
                role: fencedRow.role_context_role,
              }),
              businessTimeForSandbox(fencedRow, wallTime),
              wallTime,
            ],
          );
        }

        const stores = await client.query<StoreRow>(
          `select id, code, display_name, seat_count, opens_at, closes_at,
                  closes_next_day, is_open_24_hours
             from stores where sandbox_id = $1 order by code`,
          [input.sandboxId],
        );
        const storeOrder = new Map<string, number>(
          storeSeeds.map((store, index) => [store.code, index]),
        );
        const orderedStores = stores.rows.toSorted(
          (left, right) =>
            (storeOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
            (storeOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER),
        );
        const roleContext = buildRoleContext(
          sandboxRow,
          personaRow,
          orderedStores,
          wallTime,
        );
        await client.query("commit");
        return roleContext;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readRoleContext(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);

        const sandbox = await client.query<SandboxRow>(
          `select ${SANDBOX_ROW_COLUMNS}
             from sandboxes where id = $1`,
          [input.sandboxId],
        );
        const sandboxRow = sandbox.rows[0];
        if (
          !sandboxRow ||
          sandboxRow.invalidated_at !== null ||
          sandboxRow.expires_at.getTime() <= wallTime.getTime()
        ) {
          throw new RoleContextUnavailableError();
        }
        if (
          sandboxRow.role_context_version !== input.contextVersion ||
          sandboxRow.role_context_role !== input.role
        ) {
          throw new RoleContextStaleError();
        }

        const persona = await client.query<PersonaRow>(
          `select id, display_name, protected, role, scope, store_id
             from demo_personas
            where sandbox_id = $1 and id = $2 and role = $3`,
          [input.sandboxId, input.personaId, input.role],
        );
        const personaRow = persona.rows[0];
        if (!personaRow || !personaRow.protected) {
          throw new RoleContextUnavailableError();
        }

        const stores = await client.query<StoreRow>(
          `select id, code, display_name, seat_count, opens_at, closes_at,
                  closes_next_day, is_open_24_hours
             from stores where sandbox_id = $1 order by code`,
          [input.sandboxId],
        );
        const storeOrder = new Map<string, number>(
          storeSeeds.map((store, index) => [store.code, index]),
        );
        const orderedStores = stores.rows.toSorted(
          (left, right) =>
            (storeOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
            (storeOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER),
        );
        const roleContext = buildRoleContext(
          sandboxRow,
          personaRow,
          orderedStores,
          wallTime,
        );
        await client.query("commit");
        return roleContext;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async switchRoleContext(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);

        const sandbox = await client.query<SandboxRow>(
          `select ${SANDBOX_ROW_COLUMNS}
             from sandboxes where id = $1 for update`,
          [input.sandboxId],
        );
        const sandboxRow = sandbox.rows[0];
        if (
          !sandboxRow ||
          sandboxRow.invalidated_at !== null ||
          sandboxRow.expires_at.getTime() <= wallTime.getTime()
        ) {
          throw new RoleContextUnavailableError();
        }
        if (
          sandboxRow.role_context_version !== input.contextVersion ||
          sandboxRow.role_context_role !== input.role
        ) {
          throw new RoleContextStaleError();
        }

        const currentPersona = await client.query<PersonaRow>(
          `select id, display_name, protected, role, scope, store_id
             from demo_personas
            where sandbox_id = $1 and id = $2 and role = $3`,
          [input.sandboxId, input.personaId, input.role],
        );
        const currentPersonaRow = currentPersona.rows[0];
        if (!currentPersonaRow || !currentPersonaRow.protected) {
          throw new RoleContextUnavailableError();
        }

        const targetPersona = await client.query<PersonaRow>(
          `select id, display_name, protected, role, scope, store_id
             from demo_personas
            where sandbox_id = $1 and role = $2`,
          [input.sandboxId, input.targetRole],
        );
        const targetPersonaRow = targetPersona.rows[0];
        if (!targetPersonaRow || !targetPersonaRow.protected) {
          throw new RoleContextUnavailableError();
        }

        const updatedSandbox = await client.query<SandboxRow>(
          `update sandboxes
              set role_context_version = role_context_version + 1,
                  role_context_role = $3
            where id = $1 and role_context_version = $2
                  and role_context_role = $4
          returning ${SANDBOX_ROW_COLUMNS}`,
          [input.sandboxId, input.contextVersion, input.targetRole, input.role],
        );
        const updatedSandboxRow = updatedSandbox.rows[0];
        if (!updatedSandboxRow) throw new RoleContextStaleError();

        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'allowed', null, $9,
             $10::jsonb, $11::jsonb, $12, $13)`,
          [
            randomUUID(),
            input.sandboxId,
            currentPersonaRow.store_id,
            currentPersonaRow.id,
            currentPersonaRow.role,
            "role_context.switch",
            "demo_persona",
            targetPersonaRow.id,
            input.requestId,
            JSON.stringify({
              contextVersion: input.contextVersion,
              role: currentPersonaRow.role,
            }),
            JSON.stringify({
              contextVersion: updatedSandboxRow.role_context_version,
              role: targetPersonaRow.role,
            }),
            businessTimeForSandbox(updatedSandboxRow, wallTime),
            wallTime,
          ],
        );

        const stores = await client.query<StoreRow>(
          `select id, code, display_name, seat_count, opens_at, closes_at,
                  closes_next_day, is_open_24_hours
             from stores where sandbox_id = $1 order by code`,
          [input.sandboxId],
        );
        const storeOrder = new Map<string, number>(
          storeSeeds.map((store, index) => [store.code, index]),
        );
        const orderedStores = stores.rows.toSorted(
          (left, right) =>
            (storeOrder.get(left.code) ?? Number.MAX_SAFE_INTEGER) -
            (storeOrder.get(right.code) ?? Number.MAX_SAFE_INTEGER),
        );
        const switched = buildRoleContext(
          updatedSandboxRow,
          targetPersonaRow,
          orderedStores,
          wallTime,
        );
        await client.query("commit");
        return switched;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async recordRoleContextDenial(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await client.query<SandboxRow>(
          `select ${SANDBOX_ROW_COLUMNS} from sandboxes where id = $1`,
          [input.sandboxId],
        );
        const businessOccurredAt = sandbox.rows[0]
          ? businessTimeForSandbox(sandbox.rows[0], wallTime)
          : wallTime;
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, business_occurred_at,
             recorded_at
           ) values ($1, $2, $3, $4, $5, $6, $7,
                     $8, 'denied', $9, $10, $11, $12)`,
          [
            randomUUID(),
            input.sandboxId,
            input.storeId,
            input.personaId,
            input.role,
            input.action ?? "role_context.write",
            input.objectType ?? "role_context",
            input.objectId ?? null,
            input.reason,
            input.requestId,
            businessOccurredAt,
            wallTime,
          ],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
