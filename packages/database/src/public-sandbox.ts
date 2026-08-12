import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import type { PoolClient } from "pg";
import {
  DEMO_STORY_STEP_IDS,
  HEADQUARTERS_FIXED_STORE_CODES,
} from "@jingshu/contracts";
import type {
  DemoStoryEvidenceKind,
  DemoStoryStepId,
  FrontlineReservationAction,
  ManagerAuditFilters,
  ManagerAuditResult,
  ManagerAuditSortField,
  ManagerDashboardDrilldownKind,
  ManagerExportDataType,
  ManagerExportRequest,
  ManagerExportSortDirection,
  PublicRole,
  RepairImageContentType,
  StaffOrderAction,
  StaffOrderStageFilter,
  StaffReservationAnomalyFilter,
  StaffReservationTimeFilter,
} from "@jingshu/contracts";
export type { ManagerDashboardDrilldownKind } from "@jingshu/contracts";
import {
  businessDayRange,
  businessDayKey,
  attributeManagerReservationRevenue,
  buildPublicSandboxSeed,
  calculateManagerDashboardMetrics,
  customerImmediateReservationWindowStrategyForSeedVersion,
  decideCustomerOrderLifecycle,
  type CustomerImmediateReservationWindowStrategy,
  type CustomerReservationMode,
  decideReservationLifecycle,
  decideFrontlineReservationLifecycle,
  decideStaffOrderFulfillment,
  deriveExperienceCouponStatus,
  deriveSeatAvailability,
  evaluateStaffCoverage,
  evaluateReservationCoupon,
  isSafePlainTextReason,
  HANDOVER_EXCEPTION_GRACE_MS,
  classifyHandoverExceptions,
  type HandoverExceptionKind,
  type AttendanceAction,
  type AttendanceStatus,
  decideAttendanceAction,
  normalizeRepairDescription,
  normalizeHandoverNote,
  memberTierForGrowth,
  managerDashboardBusinessDays,
  pricePlanClockRangesOverlap,
  pricePlanEffectiveRangesOverlap,
  priceCustomerOrder,
  type CustomerOrderStatus,
  type MachineProfileCode,
  priceReservationWindow,
  priceReservationWindowFromPlans,
  reservationGrowthAward,
  type ReservationPriceRule,
  type ReservationCouponEligibility,
  type ReservationStatus,
  resolveCustomerReservationWindow,
  type SeatAvailability,
  type StaffCoverageWarning,
  sandboxBusinessTimeAt,
  SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
  SANDBOX_BUSINESS_TIME_ZONE,
  validateShiftSchedule,
} from "@jingshu/domain";

import {
  AttendanceConflictError,
  HandoverConflictError,
  CustomerOrderConflictError,
  CustomerReservationCreateConflictError,
  CustomerReservationIdempotencyConflictError,
  CustomerReservationLifecycleConflictError,
  CustomerSeatBrowseValidationError,
  FrontlineReservationConflictError,
  ManagerInventoryConflictError,
  type ManagerInventoryConflictReason,
  ManagerAuditExportError,
  ManagerDashboardRangeError,
  ManagerStoreConfigurationConflictError,
  type ManagerStoreConfigurationConflictReason,
  HeadquartersCatalogConflictError,
  ManagerPeopleConflictError,
  type ManagerPeopleConflictReason,
  RepairCommandConflictError,
  type RepairCommandConflictReason,
  RepairIntakeConflictError,
  RepairImageConflictError,
  StaffOrderConflictError,
  PublicSandboxIdempotencyConflictError,
  PublicSandboxOwnershipConflictError,
  PublicSandboxCapacityExceededError,
  PublicSandboxRateLimitedError,
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
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HALF_HOUR_MS = 30 * 60 * 1_000;
const REPAIR_IMAGE_INTENT_LIFETIME_MS = 5 * 60 * 1000;
const REPAIR_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const clockMinutes = (value: string) =>
  Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const legacyHalfHourCents = (
  baseHourlyCents: number,
  multiplierBasisPoints: number,
) => Math.floor((baseHourlyCents * multiplierBasisPoints + 10_000) / 20_000);
const repairImageExtensions: Record<
  RepairImageContentType,
  ReadonlySet<string>
> = {
  "image/jpeg": new Set(["jpeg", "jpg"]),
  "image/png": new Set(["png"]),
  "image/webp": new Set(["webp"]),
};
const publicSandboxSeed = buildPublicSandboxSeed();
const SANDBOX_BUSINESS_CLEANUP_TABLES = [
  "repair_image_cleanup_jobs",
  "audit_events",
  "handover_confirmations",
  "handover_exceptions",
  "handover_command_requests",
  "handovers",
  "attendance_corrections",
  "attendance_events",
  "attendance_command_requests",
  "manager_people_command_requests",
  "repair_spare_returns",
  "repair_spare_usages",
  "repair_business_events",
  "repair_command_requests",
  "repair_state_command_requests",
  "repair_upload_intents",
  "repair_images",
  "order_inventory_reservations",
  "order_business_events",
  "order_command_requests",
  "order_lifecycle_command_requests",
  "order_frontline_command_requests",
  "order_simulated_refunds",
  "reservation_simulated_refunds",
  "member_growth_events",
  "reservation_lifecycle_command_requests",
  "reservation_frontline_command_requests",
  "reservation_business_events",
  "reservation_command_requests",
  "inventory_movements",
  "inventory_command_requests",
  "store_config_command_requests",
  "headquarters_catalog_command_requests",
  "store_business_hours_versions",
  "price_plans",
  "store_products",
  "product_store_scopes",
  "customer_orders",
  "repairs",
  "reservations",
  "experience_coupons",
  "member_profiles",
  "attendance_records",
  "inventory_items",
  "seats",
  "store_areas",
  "shifts",
  "employees",
  "products",
  "machine_profiles",
  "demo_personas",
  "stores",
  "operators",
  "sandbox_command_requests",
] as const;

export interface CreatePublicSandboxInput {
  clientIp?: string;
  creationKey: string;
  selectedRole: PublicRole;
  visitorKey: string;
}

export interface SandboxRequestRateLimit {
  readonly perDay: number;
  readonly perHour: number;
}

export interface PublicSandboxAdmissionLimits {
  readonly activeSandboxLimit?: number;
  readonly createPerIp?: SandboxRequestRateLimit;
  readonly createPerVisitor?: SandboxRequestRateLimit;
  readonly resetPerIp?: SandboxRequestRateLimit;
  readonly resetPerVisitor?: SandboxRequestRateLimit;
}

export interface DatabaseSandboxCleanupTask {
  readonly attempts: number;
  readonly phase: "blobs" | "business";
  readonly reason: "expired" | "reset";
  readonly sandboxId: string;
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

export type ReadDemoStoryInput = ReadRoleContextInput;

export interface DatabaseDemoStoryEvidence {
  readonly kind: DemoStoryEvidenceKind;
  readonly occurredAt: Date;
  readonly summary: string;
}

export interface DatabaseDemoStoryStep {
  readonly evidence: ReadonlyArray<DatabaseDemoStoryEvidence>;
  readonly id: DemoStoryStepId;
  /** Whether this step and every preceding step have persisted legal evidence. */
  readonly satisfied: boolean;
}

export interface DatabaseDemoStory {
  /** A reset is recorded only on the replacement sandbox, whose story restarts at zero. */
  readonly resetAt: Date | null;
  readonly steps: ReadonlyArray<DatabaseDemoStoryStep>;
}

export type CustomerBrowseContextInput = ReadRoleContextInput;

export interface DatabaseCustomerStoreCatalog {
  readonly city: string;
  readonly currentTime: Date;
  readonly immediateReservationWindowStrategy: CustomerImmediateReservationWindowStrategy;
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
    readonly fictitiousCity: string;
    readonly introduction: string;
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

export interface CreateCustomerRepairInput extends CustomerBrowseContextInput {
  readonly description: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly reservationId: string;
}

export interface RepairStaffContextInput extends Omit<
  ReadRoleContextInput,
  "role"
> {
  readonly role: FrontlineRole;
}

export type ReadStaffRepairIntakeInput = RepairStaffContextInput;

export interface CreateStaffRepairInput extends RepairStaffContextInput {
  readonly description: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly seatId: string;
}

export interface DatabaseStaffRepairIntake {
  readonly handlers: ReadonlyArray<{
    readonly displayName: string;
    readonly personaId: string;
    readonly role: FrontlineRole;
  }>;
  readonly seats: ReadonlyArray<{
    readonly area: { readonly code: string; readonly displayName: string };
    readonly code: string;
    readonly existingRepair: {
      readonly repairId: string;
      readonly status: DatabaseRepairCreated["status"];
    } | null;
    readonly id: string;
    readonly machineProfile: DatabaseRepairCreated["machineProfile"];
    readonly operationalStatus: "maintenance" | "normal";
    readonly store: DatabaseRepairCreated["store"];
  }>;
  readonly store: DatabaseRepairCreated["store"];
}

export type ExecuteRepairCommandInput = RepairStaffContextInput & {
  readonly action: "assign" | "start";
  readonly assigneePersonaId: string | null;
  readonly idempotencyKey: string;
  readonly internalNote: string;
  readonly priority: DatabaseRepairCreated["priority"] | null;
  readonly publicNote: string;
  readonly repairId: string;
  readonly requestId: string;
};

export interface DatabaseRepairCommand {
  readonly action: ExecuteRepairCommandInput["action"];
  readonly affectedReservations: ReadonlyArray<{
    readonly couponRestored: boolean;
    readonly outcome: "cancelled" | "completed";
    readonly reservationId: string;
    readonly simulatedRefundCents: number;
  }>;
  readonly occurredAt: Date;
  readonly repairId: string;
  readonly replayed: boolean;
  readonly seatOperationalStatus: "maintenance" | "normal";
  readonly status: DatabaseRepairCreated["status"];
}

export type ExecuteRepairSpareCommandInput = RepairStaffContextInput & {
  readonly action: "claim" | "return";
  readonly idempotencyKey: string;
  readonly inventoryItemId: string | null;
  readonly quantity: number;
  readonly repairId: string;
  readonly requestId: string;
  readonly usageId: string | null;
};

export interface DatabaseRepairSpareCommand {
  readonly action: ExecuteRepairSpareCommandInput["action"];
  readonly businessOccurredAt: Date;
  readonly inventoryItem: {
    readonly displayName: string;
    readonly inventoryItemId: string;
  };
  readonly movementId: string;
  readonly onHandAfter: number;
  readonly quantity: number;
  readonly recordedAt: Date;
  readonly repairId: string;
  readonly replayed: boolean;
  readonly returnedQuantity: number;
  readonly usageId: string;
}

export interface DatabaseRepairSpareUsage {
  readonly claimedAt: Date;
  readonly claimedBy: {
    readonly displayName: string;
    readonly personaId: string;
  };
  readonly consumedQuantity: number;
  readonly inventoryItem: {
    readonly displayName: string;
    readonly inventoryItemId: string;
  };
  readonly movementId: string;
  readonly quantity: number;
  readonly recordedAt: Date;
  readonly returnedQuantity: number;
  readonly returns: ReadonlyArray<{
    readonly movementId: string;
    readonly quantity: number;
    readonly recordedAt: Date;
    readonly returnedAt: Date;
    readonly returnedBy: {
      readonly displayName: string;
      readonly personaId: string;
    };
    readonly returnId: string;
  }>;
  readonly usageId: string;
}

export type ExecuteRepairResolutionCommandInput = RepairStaffContextInput & {
  readonly idempotencyKey: string;
  readonly repairId: string;
  readonly requestId: string;
  readonly resolutionNote: string;
};

export interface DatabaseRepairResolutionCommand {
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly repairId: string;
  readonly replayed: boolean;
  readonly seatOperationalStatus: "maintenance" | "normal";
  readonly status: DatabaseRepairCreated["status"];
}

export type ExecuteRepairVerificationCommandInput = RepairStaffContextInput & {
  readonly idempotencyKey: string;
  readonly outcome: "failure" | "success";
  readonly reason: string;
  readonly repairId: string;
  readonly requestId: string;
};

export interface DatabaseRepairVerificationCommand {
  readonly occurredAt: Date;
  readonly outcome: ExecuteRepairVerificationCommandInput["outcome"];
  readonly recordedAt: Date;
  readonly repairId: string;
  readonly replayed: boolean;
  readonly seatOperationalStatus: "maintenance" | "normal";
  readonly status: DatabaseRepairCreated["status"];
}

export interface DatabaseRepairDetail {
  readonly actions: {
    readonly canAssign: boolean;
    readonly canClaimSpare: boolean;
    readonly canReturnSpare: boolean;
    readonly canStart: boolean;
    readonly canSubmitResolution: boolean;
    readonly canVerify: boolean;
  };
  readonly assignedTo: {
    readonly displayName: string;
    readonly personaId: string;
    readonly role: FrontlineRole;
  } | null;
  readonly currentTime: Date;
  readonly description: string;
  readonly internal: {
    readonly audits: ReadonlyArray<{
      readonly action: string;
      readonly actor: {
        readonly displayName: string;
        readonly personaId: string;
      } | null;
      readonly occurredAt: Date;
      readonly recordedAt: Date;
      readonly result: "allowed" | "denied";
    }>;
    readonly events: ReadonlyArray<{
      readonly actor: {
        readonly displayName: string;
        readonly personaId: string;
      } | null;
      readonly occurredAt: Date;
      readonly recordedAt: Date;
      readonly type: string;
    }>;
    readonly notes: ReadonlyArray<string>;
  } | null;
  readonly impacts: ReadonlyArray<{
    readonly beforeStatus: ReservationStatus;
    readonly couponRestored: boolean;
    readonly customerDisplayName: string | null;
    readonly outcome: "cancelled" | "completed";
    readonly reservationId: string;
    readonly simulatedRefundCents: number;
    readonly window: { readonly endsAt: Date; readonly startsAt: Date };
  }>;
  readonly machineProfile: DatabaseRepairCreated["machineProfile"];
  readonly priority: DatabaseRepairCreated["priority"];
  readonly publicUpdates: ReadonlyArray<{
    readonly note: string;
    readonly occurredAt: Date;
    readonly type: string;
  }>;
  readonly repairId: string;
  readonly resolution: {
    readonly note: string;
    readonly submittedAt: Date;
    readonly submittedBy: {
      readonly displayName: string;
      readonly personaId: string;
    } | null;
  } | null;
  readonly reservationId: string | null;
  readonly seat: DatabaseRepairCreated["seat"];
  readonly source: DatabaseRepairCreated["source"];
  readonly spares: {
    readonly available: ReadonlyArray<{
      readonly availableQuantity: number;
      readonly displayName: string;
      readonly inventoryItemId: string;
      readonly onHandQuantity: number;
    }>;
    readonly usages: ReadonlyArray<DatabaseRepairSpareUsage>;
  } | null;
  readonly status: DatabaseRepairCreated["status"];
  readonly latestVerification: {
    readonly outcome: "failure" | "success";
    readonly reason: string;
    readonly verifiedAt: Date;
    readonly verifiedBy: {
      readonly displayName: string;
      readonly personaId: string;
    } | null;
  } | null;
  readonly store: DatabaseRepairCreated["store"];
}

export interface DatabaseStaffRepairQueue {
  readonly currentTime: Date;
  readonly rows: ReadonlyArray<{
    readonly createdAt: Date;
    readonly description: string;
    readonly machineProfile: DatabaseRepairCreated["machineProfile"];
    readonly priority: DatabaseRepairCreated["priority"];
    readonly repairId: string;
    readonly seat: { readonly code: string };
    readonly source: DatabaseRepairCreated["source"];
    readonly status: DatabaseRepairCreated["status"];
    readonly waitingMinutes: number;
  }>;
  readonly store: DatabaseRepairCreated["store"];
}

export interface DatabaseRepairCreated {
  readonly createdAt: Date;
  readonly description: string;
  readonly duplicate: boolean;
  readonly machineProfile: {
    readonly code: MachineProfileCode;
    readonly displayName: string;
  };
  readonly priority: "normal" | "high" | "urgent";
  readonly repairId: string;
  readonly reservationId: string | null;
  readonly seat: {
    readonly code: string;
    readonly operationalStatus: "maintenance" | "normal";
  };
  readonly source: "customer" | "staff";
  readonly status:
    "assigned" | "closed" | "new" | "processing" | "verification";
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface RepairActorContextInput extends ReadRoleContextInput {
  readonly repairId: string;
}

export interface CreateRepairImageIntentInput extends RepairActorContextInput {
  readonly declaredContentType: RepairImageContentType;
  readonly declaredSize: number;
  readonly filenameExtension: "jpeg" | "jpg" | "png" | "webp";
}

export interface DatabaseRepairImageIntent {
  readonly declaredContentType: RepairImageContentType;
  readonly declaredSize: number;
  readonly expiresAt: Date;
  readonly filenameExtension: "jpeg" | "jpg" | "png" | "webp";
  readonly intentId: string;
  readonly quarantineObjectKey: string;
  readonly repairId: string;
  readonly sandboxId: string;
}

export interface ClaimRepairImageUploadInput {
  readonly declaredContentType: RepairImageContentType;
  readonly intentId: string;
  readonly quarantineObjectKey: string;
  readonly repairId: string;
  readonly sandboxId: string;
  readonly size: number;
}

export interface CompleteRepairImageUploadInput {
  readonly intentId: string;
  readonly sandboxId: string;
}

export interface PrepareRepairImageCompletionInput extends RepairActorContextInput {
  readonly intentId: string;
}

export interface FailRepairImageIntentInput {
  readonly intentId: string;
  readonly reason: string;
  readonly sandboxId: string;
}

export interface FinalizeRepairImageInput extends PrepareRepairImageCompletionInput {
  readonly byteSize: number;
  readonly contentType: RepairImageContentType;
  readonly height: number;
  readonly objectKey: string;
  readonly requestId: string;
  readonly width: number;
}

export interface DatabaseRepairImage {
  readonly byteSize: number;
  readonly contentType: RepairImageContentType;
  readonly createdAt: Date;
  readonly height: number;
  readonly imageId: string;
  readonly objectKey: string;
  readonly repairId: string;
  readonly sandboxId: string;
  readonly source: "uploaded";
  readonly width: number;
}

export type DatabaseRepairImageListItem =
  DatabaseRepairImage | DatabaseRepairSampleImage;

export interface EnqueueRepairImageCleanupInput {
  readonly availableAt: Date;
  readonly objectKey?: string;
  readonly reason: string;
  readonly sandboxId: string;
  readonly targetKind: "object" | "sandbox";
}

export interface DatabaseRepairImageCleanupJob {
  readonly attempts: number;
  readonly jobId: string;
  readonly objectKey: string | null;
  readonly sandboxId: string;
  readonly targetKind: "object" | "sandbox";
}

export interface ReadRepairImageInput extends ReadRoleContextInput {
  readonly imageId: string;
}

export interface CreateRepairSampleImageInput extends RepairActorContextInput {
  readonly requestId: string;
  readonly sampleAssetId: "repair-headset-v1";
}

export interface DatabaseRepairSampleImage {
  readonly byteSize: 925729;
  readonly contentType: "image/png";
  readonly createdAt: Date;
  readonly height: 720;
  readonly imageId: string;
  readonly repairId: string;
  readonly sampleAssetId: "repair-headset-v1";
  readonly sandboxId: string;
  readonly source: "sample";
  readonly width: 960;
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
    readonly repairs: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly status: DatabaseRepairCreated["status"];
    }>;
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

export type ReadStoreInventoryInput = ReadStaffReservationWorkbenchInput;

export interface ReadManagerStoreConfigurationInput extends ReadRoleContextInput {
  readonly requestId?: string;
  readonly role: "hq" | "manager";
  readonly storeId?: string;
}

export type ReadManagerPeopleScheduleInput =
  ReadStaffReservationWorkbenchInput & {
    readonly role: "manager";
  };

export interface ReadManagerDashboardInput extends ReadRoleContextInput {
  readonly drilldown?: ManagerDashboardDrilldownKind;
  readonly fromBusinessDay?: string;
  readonly role: FrontlineRole | "hq";
  readonly storeId?: string;
  readonly toBusinessDay?: string;
}

export interface ReadManagerAuditsInput extends ReadRoleContextInput {
  readonly filters: ManagerAuditFilters;
  readonly fromBusinessDay?: string;
  readonly role: FrontlineRole | "hq";
  readonly sort: {
    readonly direction: ManagerExportSortDirection;
    readonly field: ManagerAuditSortField;
  };
  readonly storeId: string;
  readonly toBusinessDay?: string;
}

export interface ReadHeadquartersAuditsInput extends ReadRoleContextInput {
  readonly filters: ManagerAuditFilters;
  readonly fromBusinessDay?: string;
  readonly role: "hq";
  readonly selectedStoreIds: ReadonlyArray<string>;
  readonly sort: ReadManagerAuditsInput["sort"];
  readonly toBusinessDay?: string;
}

export interface DatabaseManagerAuditEvent {
  readonly action: string;
  readonly actor: {
    readonly displayName: string;
    readonly personaId: string | null;
  };
  readonly after: Record<string, unknown> | null;
  readonly before: Record<string, unknown> | null;
  readonly businessOccurredAt: Date;
  readonly eventId: string;
  readonly objectId: string | null;
  readonly objectType: string;
  readonly reason: string | null;
  readonly recordedAt: Date;
  readonly requestId: string;
  readonly result: ManagerAuditResult;
  readonly role: PublicRole;
  readonly store: {
    readonly code: string;
    readonly displayName: string;
    readonly storeId: string;
  };
}

export interface DatabaseManagerAudits {
  readonly availableBusinessDays: ReturnType<
    typeof managerDashboardBusinessDays
  >;
  readonly currentTime: Date;
  readonly events: ReadonlyArray<DatabaseManagerAuditEvent>;
  readonly filterOptions: {
    readonly actions: ReadonlyArray<string>;
    readonly objectTypes: ReadonlyArray<string>;
    readonly personas: ReadonlyArray<{
      readonly displayName: string;
      readonly personaId: string;
    }>;
    readonly roles: ReadonlyArray<PublicRole>;
  };
  readonly range: {
    readonly endsAt: Date;
    readonly fromBusinessDay: string;
    readonly startsAt: Date;
    readonly toBusinessDay: string;
  };
  readonly sort: ReadManagerAuditsInput["sort"];
  readonly store: {
    readonly code: string;
    readonly displayName: string;
    readonly storeId: string;
  };
  readonly totalCount: number;
}

export interface DatabaseHeadquartersAudits extends Omit<
  DatabaseManagerAudits,
  "events" | "store"
> {
  readonly events: ReadonlyArray<
    Omit<DatabaseManagerAuditEvent, "store"> & {
      readonly store: DatabaseManagerAuditEvent["store"] | null;
    }
  >;
  readonly selectedStoreIds: ReadonlyArray<string>;
  readonly stores: ReadonlyArray<DatabaseManagerAudits["store"]>;
}

export type ManagerExportInput = ReadRoleContextInput &
  ManagerExportRequest & {
    readonly requestId?: string;
    readonly role: FrontlineRole | "hq";
  };

export type ManagerExportCellKind = "datetime" | "json" | "money" | "text";

export interface DatabaseManagerExport {
  readonly columns: ReadonlyArray<{
    readonly header: string;
    readonly kind: ManagerExportCellKind;
  }>;
  readonly dataType: ManagerExportDataType;
  readonly range: {
    readonly endsAt: Date;
    readonly fromBusinessDay: string;
    readonly startsAt: Date;
    readonly toBusinessDay: string;
  };
  readonly rows: ReadonlyArray<ReadonlyArray<Date | number | string | null>>;
  readonly store: {
    readonly code: string;
    readonly displayName: string;
    readonly storeId: string;
  };
}

export interface RecordHeadquartersExportInput extends ReadRoleContextInput {
  readonly dataType: ManagerExportDataType;
  readonly filters: ManagerExportRequest["filters"];
  readonly fromBusinessDay: string;
  readonly requestId: string;
  readonly role: "hq";
  readonly sort: {
    readonly direction: ManagerExportSortDirection;
    readonly field: string;
  };
  readonly stores: ReadonlyArray<{
    readonly rowCount: number;
    readonly storeId: string;
  }>;
  readonly toBusinessDay: string;
}

export interface DatabaseManagerDashboard {
  readonly availableBusinessDays: ReadonlyArray<{
    readonly endsAt: Date;
    readonly key: string;
    readonly startsAt: Date;
  }>;
  readonly currentTime: Date;
  readonly days: ReturnType<typeof calculateManagerDashboardMetrics>["days"];
  readonly drilldown: {
    readonly fromBusinessDay: string;
    readonly kind: ManagerDashboardDrilldownKind;
    readonly rows: ReadonlyArray<{
      readonly amountCents: number | null;
      readonly businessDayKey: string;
      readonly detail: string;
      readonly objectId: string;
      readonly objectType:
        | "attendance"
        | "handover"
        | "inventory"
        | "order"
        | "repair"
        | "reservation";
      readonly occurredAt: Date;
      readonly status: string;
      readonly title: string;
    }>;
    readonly storeCode: string;
    readonly toBusinessDay: string;
  } | null;
  readonly range: {
    readonly endsAt: Date;
    readonly fromBusinessDay: string;
    readonly preset: "current" | "custom";
    readonly startsAt: Date;
    readonly toBusinessDay: string;
  };
  readonly recentEvidence: ReadonlyArray<{
    readonly action: string;
    readonly businessDayKey: string;
    readonly detail: string;
    readonly objectId: string;
    readonly objectType:
      "attendance" | "handover" | "order" | "repair" | "reservation";
    readonly occurredAt: Date;
    readonly title: string;
  }>;
  readonly store: { readonly code: string; readonly displayName: string };
  readonly summary: ReturnType<
    typeof calculateManagerDashboardMetrics
  >["summary"];
  readonly trend: ReturnType<typeof calculateManagerDashboardMetrics>["days"];
}

export interface DatabaseManagerPeopleSchedule {
  readonly attendance: ReadonlyArray<{
    readonly attendanceRecordId: string;
    readonly corrections: ReadonlyArray<{
      readonly businessOccurredAt: Date;
      readonly correctedBusinessAt: Date;
      readonly correctedBy: string;
      readonly correctionId: string;
      readonly correctionKind: "absence" | "check-out" | "late";
      readonly reason: string;
      readonly recordedAt: Date;
    }>;
    readonly employee: {
      readonly displayName: string;
      readonly employeeCode: string;
      readonly employeeId: string;
    };
    readonly original: {
      readonly absenceBusinessAt: Date | null;
      readonly checkInBusinessAt: Date | null;
      readonly checkInOutcome: "late" | "on-time" | null;
      readonly checkOutBusinessAt: Date | null;
      readonly status: AttendanceStatus;
    };
    readonly shiftId: string;
    readonly window: { readonly endsAt: Date; readonly startsAt: Date };
  }>;
  readonly coverageWarnings: ReadonlyArray<StaffCoverageWarning>;
  readonly currentTime: Date;
  readonly employees: ReadonlyArray<{
    readonly active: boolean;
    readonly dependencies: {
      readonly currentOrFutureShifts: number;
      readonly futureShifts: number;
      readonly openRepairAssignments: number;
    };
    readonly displayName: string;
    readonly employeeCode: string;
    readonly employeeId: string;
    readonly protected: boolean;
    readonly role: FrontlineRole;
    readonly store: {
      readonly code: string;
      readonly displayName: string;
      readonly fixed: true;
    };
    readonly version: number;
  }>;
  readonly shifts: ReadonlyArray<{
    readonly attendanceRecordId: string | null;
    readonly canManage: boolean;
    readonly employee: {
      readonly displayName: string;
      readonly employeeCode: string;
      readonly employeeId: string;
      readonly role: FrontlineRole;
    };
    readonly endsAt: Date;
    readonly shiftId: string;
    readonly startsAt: Date;
    readonly status: "cancelled" | "scheduled";
  }>;
  readonly store: {
    readonly code: string;
    readonly displayName: string;
    readonly fixed: true;
    readonly storeId: string;
  };
}

export interface PreviewManagerShiftCoverageInput extends ReadManagerPeopleScheduleInput {
  readonly employeeId: string;
  readonly endsAt: Date;
  readonly requestId: string;
  readonly startsAt: Date;
  readonly storeId: string;
  readonly shiftId?: string;
}

export interface DatabaseManagerShiftPreview {
  readonly validation:
    | { readonly status: "valid" }
    | {
        readonly reason: "duration" | "half-hour-alignment" | "overlap";
        readonly status: "invalid";
      };
  readonly warnings: ReadonlyArray<StaffCoverageWarning>;
}

interface ManagerPeopleCommandBase extends ReadManagerPeopleScheduleInput {
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly storeId: string;
}

export type ExecuteManagerPeopleCommandInput = ManagerPeopleCommandBase &
  (
    | {
        readonly action: "create-employee";
        readonly displayName: string;
        readonly employeeCode: string;
        readonly employeeRole: FrontlineRole;
      }
    | {
        readonly action: "update-employee";
        readonly displayName: string;
        readonly employeeCode: string;
        readonly employeeId: string;
        readonly expectedVersion: number;
      }
    | {
        readonly action: "deactivate-employee";
        readonly employeeId: string;
        readonly expectedVersion: number;
      }
    | {
        readonly action: "create-shift";
        readonly employeeId: string;
        readonly endsAt: Date;
        readonly startsAt: Date;
      }
    | {
        readonly action: "update-shift";
        readonly endsAt: Date;
        readonly shiftId: string;
        readonly startsAt: Date;
      }
    | {
        readonly action: "cancel-shift";
        readonly shiftId: string;
      }
    | {
        readonly action: "correct-attendance";
        readonly attendanceRecordId: string;
        readonly correctedBusinessAt: Date;
        readonly correctionKind: "absence" | "check-out" | "late";
        readonly reason: string;
      }
  );

export interface DatabaseManagerPeopleCommand {
  readonly action: ExecuteManagerPeopleCommandInput["action"];
  readonly coverageWarnings: ReadonlyArray<StaffCoverageWarning>;
  readonly objectId: string;
  readonly replayed: boolean;
}

export interface ReadHeadquartersPeopleScheduleInput extends ReadRoleContextInput {
  readonly role: "hq";
}

export interface DatabaseHeadquartersPeopleSchedule {
  readonly currentTime: Date;
  readonly stores: ReadonlyArray<{
    readonly activeEmployeeCount: number;
    readonly attendanceAnomalyCount: number;
    readonly coverage: {
      readonly endsAt: Date;
      readonly startsAt: Date;
      readonly warnings: ReadonlyArray<StaffCoverageWarning>;
    };
    readonly coverageWarnings: number;
    readonly employees: ReadonlyArray<{
      readonly active: boolean;
      readonly displayName: string;
      readonly employeeCode: string;
      readonly role: FrontlineRole;
    }>;
    readonly employeeCount: number;
    readonly futureShifts: ReadonlyArray<{
      readonly employee: {
        readonly displayName: string;
        readonly employeeCode: string;
        readonly role: FrontlineRole;
      };
      readonly endsAt: Date;
      readonly startsAt: Date;
    }>;
    readonly futureShiftCount: number;
    readonly managerCount: number;
    readonly staffCount: number;
    readonly store: { readonly code: string; readonly displayName: string };
  }>;
}

export type ReadHeadquartersCatalogsInput = ReadHeadquartersPeopleScheduleInput;

export interface DatabaseHeadquartersCatalogs {
  readonly currentTime: Date;
  readonly stores: ReadonlyArray<{
    readonly code: string;
    readonly displayName: string;
    readonly storeId: string;
  }>;
  readonly products: ReadonlyArray<{
    readonly archived: boolean;
    readonly availableStores: ReadonlyArray<{
      readonly code: string;
      readonly displayName: string;
      readonly storeId: string;
    }>;
    readonly category: "drink" | "meal" | "snack" | "supply";
    readonly code: string;
    readonly description: string;
    readonly displayName: string;
    readonly productId: string;
    readonly storeConfigurationCount: number;
    readonly version: number;
  }>;
  readonly machineProfiles: ReadonlyArray<{
    readonly archived: boolean;
    readonly code: string;
    readonly displayName: string;
    readonly experienceDescription: string;
    readonly historicalReferenceCount: number;
    readonly machineProfileId: string;
    readonly seatReferenceCount: number;
    readonly version: number;
  }>;
}

interface HeadquartersCatalogCommandBase extends ReadHeadquartersCatalogsInput {
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export type ExecuteHeadquartersCatalogCommandInput =
  HeadquartersCatalogCommandBase &
    (
      | {
          readonly action: "create-product";
          readonly availableStoreIds: ReadonlyArray<string>;
          readonly category: "drink" | "meal" | "snack" | "supply";
          readonly code: string;
          readonly description: string;
          readonly displayName: string;
        }
      | {
          readonly action: "update-product";
          readonly availableStoreIds: ReadonlyArray<string>;
          readonly category: "drink" | "meal" | "snack" | "supply";
          readonly description: string;
          readonly displayName: string;
          readonly expectedVersion: number;
          readonly productId: string;
        }
      | {
          readonly action: "archive-product";
          readonly expectedVersion: number;
          readonly productId: string;
        }
      | {
          readonly action: "create-machine-profile";
          readonly code: string;
          readonly displayName: string;
          readonly experienceDescription: string;
        }
      | {
          readonly action: "update-machine-profile";
          readonly displayName: string;
          readonly expectedVersion: number;
          readonly experienceDescription: string;
          readonly machineProfileId: string;
        }
      | {
          readonly action: "archive-machine-profile";
          readonly expectedVersion: number;
          readonly machineProfileId: string;
        }
    );

export interface DatabaseHeadquartersCatalogCommand {
  readonly action: ExecuteHeadquartersCatalogCommandInput["action"];
  readonly objectId: string;
  readonly replayed: boolean;
  readonly version: number;
}

export interface DatabaseManagerStoreConfiguration {
  readonly areas: ReadonlyArray<{
    readonly areaId: string;
    readonly businessReferenced: boolean;
    readonly code: string;
    readonly displayName: string;
    readonly lifecycleStatus: "active" | "archived" | "draft";
    readonly seatCount: number;
    readonly sortOrder: number;
    readonly version: number;
  }>;
  readonly businessHours: {
    readonly baseline: {
      readonly closesAt: string;
      readonly closesNextDay: boolean;
      readonly display: string;
      readonly isOpen24Hours: boolean;
      readonly opensAt: string;
    };
    readonly current: {
      readonly closesAt: string;
      readonly closesNextDay: boolean;
      readonly display: string;
      readonly isOpen24Hours: boolean;
      readonly opensAt: string;
    };
    readonly effective: ReadonlyArray<{
      readonly businessHoursId: string;
      readonly closesAt: string;
      readonly closesNextDay: boolean;
      readonly daySet: "all" | "weekdays" | "weekends";
      readonly effectiveFrom: Date;
      readonly isOpen24Hours: boolean;
      readonly opensAt: string;
    }>;
    readonly scheduled: ReadonlyArray<{
      readonly businessHoursId: string;
      readonly closesAt: string;
      readonly closesNextDay: boolean;
      readonly daySet: "all" | "weekdays" | "weekends";
      readonly effectiveFrom: Date;
      readonly isOpen24Hours: boolean;
      readonly opensAt: string;
    }>;
  };
  readonly currentTime: Date;
  readonly machineProfiles: ReadonlyArray<{
    readonly archived: boolean;
    readonly code: MachineProfileCode;
    readonly displayName: string;
    readonly experienceDescription: string;
    readonly machineProfileId: string;
  }>;
  readonly pricePlans: ReadonlyArray<{
    readonly area: {
      readonly areaId: string;
      readonly code: string;
      readonly displayName: string;
    };
    readonly effectiveFrom: Date;
    readonly effectiveUntil: Date | null;
    readonly endsAt: string;
    readonly endsNextDay: boolean;
    readonly machineProfile: {
      readonly code: MachineProfileCode;
      readonly displayName: string;
      readonly machineProfileId: string;
    };
    readonly legacyWeekdayBreakdown: {
      readonly baseHalfHourCents: number;
      readonly eveningHalfHourCents: number;
      readonly overnightHalfHourCents: number;
    } | null;
    readonly pricePlanId: string;
    readonly pricingModel: "explicit-half-hour" | "legacy";
    readonly configVersion: number;
    readonly startsAt: string;
    readonly status: "archived" | "current" | "historical" | "scheduled";
    readonly store: { readonly code: string; readonly displayName: string };
    readonly version: number;
    readonly weekdayHalfHourCents: number;
    readonly weekendHalfHourCents: number;
  }>;
  readonly products: ReadonlyArray<{
    readonly alerting: boolean;
    readonly archived: boolean;
    readonly availableQuantity: number;
    readonly businessReferenced: boolean;
    readonly headquartersProduct: {
      readonly archived: boolean;
      readonly category: "drink" | "meal" | "snack" | "supply";
      readonly code: string;
      readonly description: string;
      readonly displayName: string;
      readonly productId: string;
    };
    readonly inventoryItemId: string;
    readonly listed: boolean;
    readonly lowStockThreshold: number;
    readonly onHandQuantity: number;
    readonly reservedQuantity: number;
    readonly storeProductId: string;
    readonly unitPriceCents: number;
    readonly version: number;
  }>;
  readonly seats: ReadonlyArray<{
    readonly area: { readonly areaId: string; readonly displayName: string };
    readonly businessReferenced: boolean;
    readonly code: string;
    readonly dependencies: {
      readonly activeReservations: number;
      readonly openRepairs: number;
    };
    readonly lifecycleStatus: "active" | "inactive" | "draft";
    readonly machineProfile: {
      readonly code: MachineProfileCode;
      readonly displayName: string;
      readonly machineProfileId: string;
    };
    readonly operationalStatus: "maintenance" | "normal";
    readonly seatId: string;
    readonly sortOrder: number;
    readonly version: number;
  }>;
  readonly store: {
    readonly code: string;
    readonly displayName: string;
    readonly fictitiousCity: string;
    readonly fixed: true;
    readonly introduction: string;
    readonly seatCount: number;
    readonly storeId: string;
    readonly version: number;
  };
}

interface ManagerStoreConfigurationCommandBase extends ReadManagerStoreConfigurationInput {
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly storeId: string;
}

export type ExecuteManagerStoreConfigurationCommandInput =
  ManagerStoreConfigurationCommandBase &
    (
      | {
          readonly action: "update-store-profile";
          readonly displayName: string;
          readonly fictitiousCity: string;
          readonly introduction: string;
        }
      | {
          readonly action: "schedule-business-hours";
          readonly closesAt: string;
          readonly closesNextDay: boolean;
          readonly daySet: "all" | "weekdays" | "weekends";
          readonly effectiveFrom: Date;
          readonly isOpen24Hours: boolean;
          readonly opensAt: string;
        }
      | {
          readonly action: "create-area";
          readonly code: string;
          readonly displayName: string;
          readonly lifecycleStatus: "active" | "draft";
          readonly sortOrder: number;
        }
      | {
          readonly action: "create-seat";
          readonly areaId: string;
          readonly code: string;
          readonly lifecycleStatus: "active" | "draft";
          readonly machineProfileId: string;
          readonly sortOrder: number;
        }
      | {
          readonly action: "create-price-plan";
          readonly areaId: string;
          readonly effectiveFrom: Date;
          readonly endsAt: string;
          readonly endsNextDay: boolean;
          readonly machineProfileId: string;
          readonly startsAt: string;
          readonly weekdayHalfHourCents: number;
          readonly weekendHalfHourCents: number;
        }
      | {
          readonly action: "archive-price-plan";
          readonly pricePlanId: string;
        }
      | {
          readonly action: "update-store-product";
          readonly listed: boolean;
          readonly lowStockThreshold: number;
          readonly storeProductId: string;
          readonly unitPriceCents: number;
        }
      | {
          readonly action: "archive-store-product";
          readonly storeProductId: string;
        }
      | {
          readonly action: "update-seat";
          readonly areaId: string;
          readonly code: string;
          readonly lifecycleStatus: "active" | "inactive" | "draft";
          readonly machineProfileId: string;
          readonly seatId: string;
          readonly sortOrder: number;
        }
      | {
          readonly action: "update-area";
          readonly areaId: string;
          readonly displayName: string;
          readonly lifecycleStatus: "active" | "archived" | "draft";
          readonly sortOrder: number;
        }
      | {
          readonly action: "delete-area";
          readonly areaId: string;
        }
      | {
          readonly action: "delete-seat";
          readonly seatId: string;
        }
    );

export interface DatabaseManagerStoreConfigurationCommand {
  readonly action: ExecuteManagerStoreConfigurationCommandInput["action"];
  readonly objectId: string;
  readonly replayed: boolean;
  readonly version: number;
}

interface StoredManagerStoreConfigurationDenial {
  readonly denied: true;
  readonly reason: ManagerStoreConfigurationConflictReason;
}

type StoredManagerStoreConfigurationResult =
  | DatabaseManagerStoreConfigurationCommand
  | StoredManagerStoreConfigurationDenial;

function isStoredManagerStoreConfigurationDenial(
  result: StoredManagerStoreConfigurationResult,
): result is StoredManagerStoreConfigurationDenial {
  return "denied" in result && result.denied;
}

function isSafeManagerConfigurationText(value: string) {
  return !/[<>\p{C}]/u.test(value);
}

const prohibitedCatalogContent =
  /(?:酒|啤|烟草|香烟|卷烟|电子烟|充值|储值|处方|药品|可口可乐|百事|红牛|星巴克|英特尔|英伟达|高通|骁龙|安谋|酷睿|锐龙|华为|联想|苹果|小米|罗技|雷蛇|华硕|宏碁|戴尔|惠普|微星|技嘉|三星|索尼|任天堂|微软|飞利浦|神舟|机械革命|玩家国度|雀巢|农夫山泉|康师傅|统一|\b(?:alcohol|beer|wine|liquor|tobacco|cigarettes?|vape|recharge|top[ -]?up|prescription|medicine|coca[ -]?cola|pepsi|red[ -]?bull|starbucks|nvidia|geforce|rtx|intel|radeon|ryzen|amd|qualcomm|snapdragon|arm|mali|adreno|huawei|lenovo|apple|xiaomi|logitech|razer|asus|acer|dell|hp|msi|gigabyte|samsung|sony|nintendo|microsoft|philips|nestle)\b)/iu;
const allowedCatalogLatinTokens = new Set(["hz", "k", "p"]);

function isSafeCatalogText(value: string) {
  const latinTokens = value.match(/\p{Script=Latin}+/gu) ?? [];
  return (
    isSafeManagerConfigurationText(value) &&
    !prohibitedCatalogContent.test(value) &&
    latinTokens.every((token) =>
      allowedCatalogLatinTokens.has(token.toLocaleLowerCase("en-US")),
    )
  );
}

function isValidCatalogCode(value: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value) && value.length <= 48;
}

interface StoredManagerPeopleCommand {
  readonly action: ExecuteManagerPeopleCommandInput["action"];
  readonly coverageWarnings: ReadonlyArray<{
    readonly actualStaff: number;
    readonly endsAt: string;
    readonly minimumStaff: number;
    readonly startsAt: string;
  }>;
  readonly objectId: string;
}

function managerPeopleCommandFromStored(
  stored: StoredManagerPeopleCommand,
  replayed: boolean,
): DatabaseManagerPeopleCommand {
  return {
    ...stored,
    coverageWarnings: stored.coverageWarnings.map((warning) => ({
      ...warning,
      endsAt: new Date(warning.endsAt),
      startsAt: new Date(warning.startsAt),
    })),
    replayed,
  };
}

function normalizeEmployeeFields(input: {
  readonly displayName: string;
  readonly employeeCode: string;
}) {
  const displayName = input.displayName.trim();
  const employeeCode = input.employeeCode.trim().toUpperCase();
  if (
    displayName.length < 2 ||
    displayName.length > 40 ||
    /[<>\p{C}]/u.test(displayName) ||
    !/^[A-Z0-9-]{3,32}$/u.test(employeeCode)
  ) {
    throw new ManagerPeopleConflictError("invalid-employee");
  }
  return { displayName, employeeCode };
}

interface ManagerInventoryCommandBase extends ReadStoreInventoryInput {
  readonly idempotencyKey: string;
  readonly inventoryItemId: string;
  readonly reason: string;
  readonly requestId: string;
  readonly role: "manager";
}

export type ExecuteManagerInventoryCommandInput =
  | (ManagerInventoryCommandBase & {
      readonly action: "receipt";
      readonly quantity: number;
    })
  | (ManagerInventoryCommandBase & {
      readonly action: "stocktake";
      readonly actualQuantity: number;
    })
  | (ManagerInventoryCommandBase & {
      readonly action: "compensation";
      readonly onHandDelta: number;
      readonly originalMovementId: string | null;
    });

export interface DatabaseManagerInventoryCommand {
  readonly action: "compensation" | "receipt" | "stocktake";
  readonly alerting: boolean;
  readonly alertTransition: "activated" | "resolved" | "unchanged";
  readonly businessOccurredAt: Date;
  readonly inventoryItemId: string;
  readonly movementId: string;
  readonly onHandAfter: number;
  readonly onHandDelta: number;
  readonly originalMovementId: string | null;
  readonly reason: string;
  readonly replayed: boolean;
}

export interface DatabaseStoreInventoryItem {
  readonly alerting: boolean;
  readonly availableQuantity: number;
  readonly code: string;
  readonly displayName: string;
  readonly inventoryItemId: string;
  readonly kind: "product" | "spare";
  readonly lowStockThreshold: number;
  readonly onHandQuantity: number;
  readonly reservedQuantity: number;
  readonly recentMovement: DatabaseInventoryMovement | null;
}

export interface DatabaseInventoryMovement {
  readonly businessOccurredAt: Date;
  readonly inventoryItemId: string;
  readonly inventoryItemName: string;
  readonly kind:
    | "compensation"
    | "receipt"
    | "sale"
    | "spare-return"
    | "spare-usage"
    | "stocktake"
    | "waste";
  readonly movementId: string;
  readonly onHandAfter: number;
  readonly onHandDelta: number;
  readonly orderId: string | null;
  readonly originalMovementId: string | null;
  readonly reason: string;
}

export interface DatabaseStoreInventory {
  readonly currentTime: Date;
  readonly items: ReadonlyArray<DatabaseStoreInventoryItem>;
  readonly movements: ReadonlyArray<DatabaseInventoryMovement>;
  readonly store: { readonly code: string; readonly displayName: string };
  readonly summary: {
    readonly alertCount: number;
    readonly itemCount: number;
    readonly productCount: number;
    readonly spareCount: number;
  };
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

export type ReadOwnShiftAttendanceInput = ReadStaffReservationWorkbenchInput;

export interface ExecuteOwnAttendanceCommandInput extends ReadOwnShiftAttendanceInput {
  readonly action: Exclude<AttendanceAction, "mark-absent">;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly shiftId: string;
}

export interface DatabaseStaffShift {
  readonly attendance: {
    readonly checkIn: {
      readonly businessOccurredAt: Date;
      readonly outcome: "late" | "on-time";
      readonly recordedAt: Date;
      readonly source: "simulated";
    } | null;
    readonly checkOut: {
      readonly businessOccurredAt: Date;
      readonly recordedAt: Date;
      readonly source: "manual";
    } | null;
    readonly absence: {
      readonly businessOccurredAt: Date;
      readonly recordedAt: Date;
    } | null;
    readonly status: AttendanceStatus;
  } | null;
  readonly canManageSchedule: boolean;
  readonly facts: ReadonlyArray<{
    readonly businessOccurredAt: Date;
    readonly data: unknown;
    readonly recordedAt: Date;
    readonly type:
      | "attendance.absence-recorded"
      | "attendance.manual-check-out"
      | "attendance.simulated-check-in";
  }>;
  readonly nextAction: {
    readonly kind: "manual-check-out" | "simulated-check-in";
    readonly label: "手动签退" | "模拟签到";
  } | null;
  readonly shiftId: string;
  readonly signInWindow: { readonly opensAt: Date; readonly closesAt: Date };
  readonly window: { readonly endsAt: Date; readonly startsAt: Date };
}

export interface DatabaseOwnShiftAttendance {
  readonly currentTime: Date;
  readonly employee: {
    readonly displayName: string;
    readonly employeeCode: string;
    readonly role: FrontlineRole;
  };
  readonly shifts: {
    readonly current: DatabaseStaffShift | null;
    readonly future: ReadonlyArray<DatabaseStaffShift>;
    readonly recent: ReadonlyArray<DatabaseStaffShift>;
  };
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface DatabaseAttendanceCommand {
  readonly action: "manual-check-out" | "simulated-check-in";
  readonly occurredAt: Date;
  readonly outcome: "late" | "on-time" | null;
  readonly replayed: boolean;
  readonly shiftId: string;
  readonly status: AttendanceStatus;
}

export interface DatabaseHandoverSnapshot {
  readonly capturedAt: Date;
  readonly lowStockAlerts: ReadonlyArray<{
    readonly availableQuantity: number;
    readonly displayName: string;
    readonly inventoryItemId: string;
    readonly lowStockThreshold: number;
    readonly onHandQuantity: number;
    readonly reservedQuantity: number;
  }>;
  readonly orders: ReadonlyArray<{
    readonly lineSummary: string;
    readonly orderId: string;
    readonly seatCode: string;
    readonly status:
      | "pending-simulated-payment"
      | "preparing"
      | "ready-for-pickup"
      | "simulated-paid";
  }>;
  readonly repairs: ReadonlyArray<{
    readonly description: string;
    readonly priority: DatabaseRepairCreated["priority"];
    readonly repairId: string;
    readonly seatCode: string;
    readonly status: "assigned" | "new" | "processing" | "verification";
  }>;
  readonly reservations: ReadonlyArray<{
    readonly customerDisplayName: string;
    readonly endsAt: Date;
    readonly reservationId: string;
    readonly seatCode: string;
    readonly startsAt: Date;
    readonly status:
      "arrived" | "confirmed" | "in-use" | "pending-confirmation";
  }>;
}

export interface DatabaseHandover {
  readonly confirmed: {
    readonly businessOccurredAt: Date;
    readonly by: {
      readonly displayName: string;
      readonly employeeCode: string;
    };
    readonly recordedAt: Date;
  } | null;
  readonly handoverId: string;
  readonly note: string;
  readonly shiftId: string;
  readonly snapshot: DatabaseHandoverSnapshot;
  readonly submittedAt: {
    readonly businessOccurredAt: Date;
    readonly recordedAt: Date;
  };
  readonly submittedBy: {
    readonly displayName: string;
    readonly employeeCode: string;
  };
}

export interface DatabaseOwnHandovers {
  readonly currentTime: Date;
  readonly employee: DatabaseOwnShiftAttendance["employee"];
  readonly incoming: ReadonlyArray<{
    readonly canConfirm: boolean;
    readonly handover: DatabaseHandover;
  }>;
  readonly outgoing: {
    readonly canSubmit: boolean;
    readonly handover: DatabaseHandover | null;
    readonly shiftId: string;
    readonly snapshotPreview: DatabaseHandoverSnapshot;
    readonly window: { readonly endsAt: Date; readonly startsAt: Date };
  } | null;
  readonly store: DatabaseOwnShiftAttendance["store"];
}

export interface SubmitOwnHandoverInput extends ReadOwnShiftAttendanceInput {
  readonly idempotencyKey: string;
  readonly note: string;
  readonly requestId: string;
  readonly shiftId: string;
}

export interface ConfirmHandoverInput extends ReadOwnShiftAttendanceInput {
  readonly handoverId: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export interface DatabaseHandoverCommand extends DatabaseHandover {
  readonly replayed: boolean;
}

export interface DatabaseManagerHandoverExceptions {
  readonly currentTime: Date;
  readonly exceptions: ReadonlyArray<{
    readonly businessOccurredAt: Date;
    readonly employee: {
      readonly displayName: string;
      readonly employeeCode: string;
    };
    readonly handover: DatabaseHandover | null;
    readonly kind: HandoverExceptionKind;
    readonly recordedAt: Date;
    readonly shiftId: string;
    readonly window: { readonly endsAt: Date; readonly startsAt: Date };
  }>;
  readonly store: DatabaseOwnShiftAttendance["store"];
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
  action?:
    | "audit.read"
    | "export.csv"
    | "role_capability.check"
    | "role_context.write";
  objectId?: string | null;
  objectType?:
    "audit" | "demo_persona" | "export" | "role_context" | "sandbox" | "store";
  requestId: string;
  reason:
    | "capability_denied"
    | "context_version_stale"
    | "cross-store-or-not-found"
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
  executeOwnAttendanceCommand(
    input: ExecuteOwnAttendanceCommandInput,
  ): Promise<DatabaseAttendanceCommand>;
  submitOwnHandover(
    input: SubmitOwnHandoverInput,
  ): Promise<DatabaseHandoverCommand>;
  confirmHandover(
    input: ConfirmHandoverInput,
  ): Promise<DatabaseHandoverCommand>;
  executeStaffOrderCommand(
    input: ExecuteStaffOrderCommandInput,
  ): Promise<DatabaseStaffOrderCommand>;
  executeRepairCommand(
    input: ExecuteRepairCommandInput,
  ): Promise<DatabaseRepairCommand>;
  executeRepairSpareCommand(
    input: ExecuteRepairSpareCommandInput,
  ): Promise<DatabaseRepairSpareCommand>;
  executeRepairResolutionCommand(
    input: ExecuteRepairResolutionCommandInput,
  ): Promise<DatabaseRepairResolutionCommand>;
  executeRepairVerificationCommand(
    input: ExecuteRepairVerificationCommandInput,
  ): Promise<DatabaseRepairVerificationCommand>;
  executeManagerInventoryCommand(
    input: ExecuteManagerInventoryCommandInput,
  ): Promise<DatabaseManagerInventoryCommand>;
  executeManagerStoreConfigurationCommand(
    input: ExecuteManagerStoreConfigurationCommandInput,
  ): Promise<DatabaseManagerStoreConfigurationCommand>;
  executeManagerPeopleCommand(
    input: ExecuteManagerPeopleCommandInput,
  ): Promise<DatabaseManagerPeopleCommand>;
  executeHeadquartersCatalogCommand(
    input: ExecuteHeadquartersCatalogCommandInput,
  ): Promise<DatabaseHeadquartersCatalogCommand>;
  createCustomerPendingReservation(
    input: CreateCustomerPendingReservationInput,
  ): Promise<DatabaseCustomerPendingReservation>;
  createCustomerPendingOrder(
    input: CreateCustomerPendingOrderInput,
  ): Promise<DatabaseCustomerPendingOrder>;
  createCustomerRepair(
    input: CreateCustomerRepairInput,
  ): Promise<DatabaseRepairCreated>;
  createStaffRepair(
    input: CreateStaffRepairInput,
  ): Promise<DatabaseRepairCreated>;
  createRepairImageIntent(
    input: CreateRepairImageIntentInput,
  ): Promise<DatabaseRepairImageIntent>;
  claimRepairImageUpload(input: ClaimRepairImageUploadInput): Promise<void>;
  completeRepairImageUpload(
    input: CompleteRepairImageUploadInput,
  ): Promise<void>;
  createRepairSampleImage(
    input: CreateRepairSampleImageInput,
  ): Promise<DatabaseRepairSampleImage>;
  failRepairImageIntent(input: FailRepairImageIntentInput): Promise<void>;
  finalizeRepairImage(
    input: FinalizeRepairImageInput,
  ): Promise<DatabaseRepairImage>;
  enqueueRepairImageCleanup(
    input: EnqueueRepairImageCleanupInput,
  ): Promise<void>;
  completeRepairImageCleanupForSandbox(sandboxId: string): Promise<void>;
  completeRepairImageCleanupJob(jobId: string): Promise<void>;
  readDueRepairImageCleanupJobs(
    limit: number,
  ): Promise<ReadonlyArray<DatabaseRepairImageCleanupJob>>;
  retryRepairImageCleanupJob(input: {
    readonly availableAt: Date;
    readonly failure: string;
    readonly jobId: string;
  }): Promise<void>;
  scheduleExpiredSandboxCleanup(): Promise<number>;
  readDueSandboxCleanupTasks(
    limit: number,
  ): Promise<ReadonlyArray<DatabaseSandboxCleanupTask>>;
  markSandboxCleanupBlobsDeleted(sandboxId: string): Promise<void>;
  deleteSandboxBusinessBatch(input: {
    readonly batchSize: number;
    readonly sandboxId: string;
  }): Promise<{ readonly completed: boolean; readonly deletedRows: number }>;
  retrySandboxCleanupTask(input: {
    readonly availableAt: Date;
    readonly failure: string;
    readonly sandboxId: string;
  }): Promise<void>;
  simulateCustomerOrderPayment(
    input: SimulateCustomerOrderPaymentInput,
  ): Promise<DatabaseCustomerOrderPayment>;
  simulateCustomerReservationPayment(
    input: SimulateCustomerReservationPaymentInput,
  ): Promise<DatabaseCustomerReservationPayment>;
  readCurrentRoleContext(
    input: ReadCurrentRoleContextInput,
  ): Promise<DatabaseRoleContext>;
  readDemoStory(input: ReadDemoStoryInput): Promise<DatabaseDemoStory>;
  readStaffReservationDetail(
    input: ReadStaffReservationDetailInput,
  ): Promise<DatabaseStaffReservationDetail>;
  readStaffReservationList(
    input: ReadStaffReservationListInput,
  ): Promise<DatabaseStaffReservationList>;
  readStaffReservationWorkbench(
    input: ReadStaffReservationWorkbenchInput,
  ): Promise<DatabaseStaffReservationWorkbench>;
  readOwnShiftAttendance(
    input: ReadOwnShiftAttendanceInput,
  ): Promise<DatabaseOwnShiftAttendance>;
  readOwnHandovers(
    input: ReadOwnShiftAttendanceInput,
  ): Promise<DatabaseOwnHandovers>;
  readManagerHandoverExceptions(
    input: ReadOwnShiftAttendanceInput,
  ): Promise<DatabaseManagerHandoverExceptions>;
  readStaffRepairIntake(
    input: ReadStaffRepairIntakeInput,
  ): Promise<DatabaseStaffRepairIntake>;
  readStaffRepairQueue(
    input: ReadStaffRepairIntakeInput,
  ): Promise<DatabaseStaffRepairQueue>;
  readRepairDetail(
    input: RepairActorContextInput,
  ): Promise<DatabaseRepairDetail>;
  prepareRepairImageCompletion(
    input: PrepareRepairImageCompletionInput,
  ): Promise<DatabaseRepairImageIntent>;
  readRepairImage(input: ReadRepairImageInput): Promise<DatabaseRepairImage>;
  readRepairImages(
    input: RepairActorContextInput,
  ): Promise<ReadonlyArray<DatabaseRepairImageListItem>>;
  readStaffOrderDetail(
    input: ReadStaffOrderDetailInput,
  ): Promise<DatabaseStaffOrderDetail>;
  readStaffOrderQueue(
    input: ReadStaffOrderQueueInput,
  ): Promise<DatabaseStaffOrderQueue>;
  readStoreInventory(
    input: ReadStoreInventoryInput,
  ): Promise<DatabaseStoreInventory>;
  readManagerStoreConfiguration(
    input: ReadManagerStoreConfigurationInput,
  ): Promise<DatabaseManagerStoreConfiguration>;
  readManagerDashboard(
    input: ReadManagerDashboardInput,
  ): Promise<DatabaseManagerDashboard>;
  readManagerAudits(
    input: ReadManagerAuditsInput,
  ): Promise<DatabaseManagerAudits>;
  readHeadquartersAudits(
    input: ReadHeadquartersAuditsInput,
  ): Promise<DatabaseHeadquartersAudits>;
  prepareManagerExport(
    input: ManagerExportInput,
  ): Promise<DatabaseManagerExport>;
  createManagerExport(
    input: ManagerExportInput & { readonly requestId: string },
  ): Promise<DatabaseManagerExport>;
  recordHeadquartersExport(input: RecordHeadquartersExportInput): Promise<void>;
  readManagerPeopleSchedule(
    input: ReadManagerPeopleScheduleInput,
  ): Promise<DatabaseManagerPeopleSchedule>;
  previewManagerShiftCoverage(
    input: PreviewManagerShiftCoverageInput,
  ): Promise<DatabaseManagerShiftPreview>;
  readHeadquartersPeopleSchedule(
    input: ReadHeadquartersPeopleScheduleInput,
  ): Promise<DatabaseHeadquartersPeopleSchedule>;
  readHeadquartersCatalogs(
    input: ReadHeadquartersCatalogsInput,
  ): Promise<DatabaseHeadquartersCatalogs>;
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
  readonly admissionLimits?: PublicSandboxAdmissionLimits;
  readonly dueHandlers?: DemoTimeDueHandlerRegistry;
  readonly wallClock?: WallClock;
}

const storeSeeds = publicSandboxSeed.stores;
const personaSeeds = publicSandboxSeed.personas;
const employeeSeeds = publicSandboxSeed.employees;
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

const productAvailableStoreCodes = {
  "circuit-coffee": ["prism-flagship", "starbridge-standard"],
  "cloud-mineral-water": ["apex-new", "prism-flagship", "starbridge-standard"],
  "crisp-seaweed": ["apex-new", "prism-flagship", "starbridge-standard"],
  "heatwave-noodles": ["apex-new", "prism-flagship", "starbridge-standard"],
  "jump-energy-bar": ["apex-new", "prism-flagship"],
  "midnight-iced-tea": ["prism-flagship", "starbridge-standard"],
  "night-voyage-chips": ["apex-new", "prism-flagship", "starbridge-standard"],
  "orbit-rice-roll": ["apex-new", "starbridge-standard"],
  "peripheral-wipe": ["apex-new", "prism-flagship"],
  "pulse-sparkling-water": [
    "apex-new",
    "prism-flagship",
    "starbridge-standard",
  ],
  "star-popcorn": ["prism-flagship", "starbridge-standard"],
  "wake-mint": ["apex-new", "prism-flagship", "starbridge-standard"],
} as const satisfies Record<
  (typeof productSeeds)[number]["code"],
  ReadonlyArray<(typeof storeSeeds)[number]["code"]>
>;

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

interface EmployeeRow {
  active: boolean;
  display_name: string;
  employee_code: string;
  id: string;
  persona_id: string | null;
  role: FrontlineRole;
  store_code: string;
  store_display_name: string;
  store_id: string;
}

interface ShiftAttendanceRow {
  absence_business_at: Date | null;
  absence_recorded_at: Date | null;
  attendance_id: string | null;
  attendance_status: AttendanceStatus | null;
  check_in_business_at: Date | null;
  check_in_outcome: "late" | "on-time" | null;
  check_in_recorded_at: Date | null;
  check_out_business_at: Date | null;
  check_out_recorded_at: Date | null;
  ends_at: Date;
  shift_id: string;
  starts_at: Date;
}

interface LockedShiftRow {
  employee_id: string;
  ends_at: Date;
  shift_id: string;
  starts_at: Date;
  store_id: string;
}

interface AttendanceEventRow {
  business_occurred_at: Date;
  event_data: unknown;
  event_type: DatabaseStaffShift["facts"][number]["type"];
  recorded_at: Date;
  shift_id: string;
}

interface StoredAttendanceCommand {
  action: DatabaseAttendanceCommand["action"];
  occurredAt: string;
  outcome: DatabaseAttendanceCommand["outcome"];
  shiftId: string;
  status: AttendanceStatus;
}

interface StoredHandoverSnapshot {
  capturedAt: string;
  lowStockAlerts: DatabaseHandoverSnapshot["lowStockAlerts"];
  orders: DatabaseHandoverSnapshot["orders"];
  repairs: DatabaseHandoverSnapshot["repairs"];
  reservations: ReadonlyArray<
    Omit<
      DatabaseHandoverSnapshot["reservations"][number],
      "endsAt" | "startsAt"
    > & {
      endsAt: string;
      startsAt: string;
    }
  >;
}

interface StoredHandover {
  confirmed: {
    businessOccurredAt: string;
    by: { displayName: string; employeeCode: string };
    recordedAt: string;
  } | null;
  handoverId: string;
  note: string;
  shiftId: string;
  snapshot: StoredHandoverSnapshot;
  submittedAt: { businessOccurredAt: string; recordedAt: string };
  submittedBy: { displayName: string; employeeCode: string };
}

interface HandoverRow {
  confirmation_business_at: Date | null;
  confirmation_recorded_at: Date | null;
  confirmer_display_name: string | null;
  confirmer_employee_code: string | null;
  handover_id: string;
  note: string;
  shift_id: string;
  snapshot: StoredHandoverSnapshot;
  submitted_business_at: Date;
  submitted_recorded_at: Date;
  submitter_display_name: string;
  submitter_employee_code: string;
}

interface OperatorRow {
  display_name: string;
  city: string;
}

interface StoreRow {
  id: string;
  code: string;
  display_name: string;
  fictitious_city: string;
  introduction: string;
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
  ends_at: string;
  ends_next_day: boolean;
  pricing_model: "explicit-half-hour" | "legacy";
  starts_at: string;
  weekday_half_hour_cents: number;
  weekend_half_hour_cents: number;
}

async function loadMachinePricingSelection(
  client: PoolClient,
  input: {
    readonly areaId: string;
    readonly effectiveAt: Date;
    readonly machineProfileCode: MachineProfileCode;
    readonly sandboxId: string;
    readonly storeId: string;
  },
) {
  const result = await client.query<MachineSelectionRow>(
    `select profile.id, profile.code, profile.display_name,
            profile.experience_description, plan.base_hourly_cents,
            plan.starts_at, plan.ends_at, plan.ends_next_day,
            plan.weekday_half_hour_cents,
            plan.weekend_half_hour_cents, plan.pricing_model
       from machine_profiles profile
       join price_plans plan on plan.machine_profile_id = profile.id
      where profile.sandbox_id = $1 and profile.code = $2
        and profile.archived = false and plan.store_id = $3
        and plan.area_id = $4 and plan.status = 'active'
        and plan.effective_from <= $5
        and (plan.effective_until is null or plan.effective_until > $5)
      order by plan.starts_at, plan.version desc`,
    [
      input.sandboxId,
      input.machineProfileCode,
      input.storeId,
      input.areaId,
      input.effectiveAt,
    ],
  );
  const machine = result.rows[0] ?? null;
  return machine ? { machine, plans: result.rows } : null;
}

function priceMachineReservationWindow(
  plans: ReadonlyArray<MachineSelectionRow>,
  window: { readonly endsAt: Date; readonly startsAt: Date },
) {
  try {
    return priceReservationWindowFromPlans({
      endsAt: window.endsAt,
      plans: plans.map((plan) => ({
        baseHourlyCents: plan.base_hourly_cents,
        endsAt: plan.ends_at.slice(0, 5),
        endsNextDay: plan.ends_next_day,
        pricingModel: plan.pricing_model,
        startsAt: plan.starts_at.slice(0, 5),
        weekdayHalfHourCents: plan.weekday_half_hour_cents,
        weekendHalfHourCents: plan.weekend_half_hour_cents,
      })),
      startsAt: window.startsAt,
    });
  } catch (error) {
    if (error instanceof RangeError) {
      throw new CustomerSeatBrowseValidationError("price-plan-not-found");
    }
    throw error;
  }
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

interface StoreConfigurationContext {
  readonly actorStoreId: string | null;
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

interface RelatedRepairRow {
  id: string;
  label: string;
  status: DatabaseRepairCreated["status"];
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

async function readRelatedRepairs(
  client: PoolClient,
  sandboxId: string,
  reservationId: string,
): Promise<ReadonlyArray<RelatedRepairRow>> {
  const result = await client.query<RelatedRepairRow>(
    `select repair.id, repair.status,
            concat(seat.code, ' · ', left(repair.description, 40)) as label
       from repairs repair
       join seats seat on seat.id = repair.seat_id
      where repair.sandbox_id = $1 and repair.reservation_id = $2
      order by repair.created_business_at, repair.id`,
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

interface ManagerInventoryCommandRow {
  payload_hash: string;
  result_data: {
    action: "compensation" | "receipt" | "stocktake";
    alerting: boolean;
    alertTransition: "activated" | "resolved" | "unchanged";
    businessOccurredAt: string;
    inventoryItemId: string;
    movementId: string;
    onHandAfter: number;
    onHandDelta: number;
    originalMovementId: string | null;
    reason: string;
  };
}

interface InventoryMovementRow {
  business_occurred_at: Date;
  inventory_item_id: string;
  inventory_item_name: string;
  movement_kind: DatabaseInventoryMovement["kind"];
  movement_id: string;
  on_hand_after: number;
  on_hand_delta: number;
  order_id: string | null;
  original_movement_id: string | null;
  reason: string;
}

interface CustomerRepairReservationRow {
  id: string;
  machine_profile_code: MachineProfileCode;
  machine_profile_display_name: string;
  machine_profile_experience_description: string;
  machine_profile_id: string;
  operational_status: "maintenance" | "normal";
  seat_code: string;
  seat_id: string;
  status: ReservationStatus;
  store_code: string;
  store_display_name: string;
  store_id: string;
}

interface StaffRepairSeatRow {
  area_code: string;
  area_display_name: string;
  machine_profile_code: MachineProfileCode;
  machine_profile_display_name: string;
  machine_profile_experience_description: string;
  machine_profile_id: string;
  operational_status: "maintenance" | "normal";
  seat_code: string;
  seat_id: string;
  store_code: string;
  store_display_name: string;
  store_id: string;
}

interface StaffRepairIntakeRow extends StaffRepairSeatRow {
  existing_repair_id: string | null;
  existing_repair_status: DatabaseRepairCreated["status"] | null;
}

interface RepairRow {
  created_at: Date;
  description: string;
  machine_profile_code: MachineProfileCode;
  machine_profile_display_name: string;
  operational_status: "maintenance" | "normal";
  priority: "high" | "normal" | "urgent";
  repair_id: string;
  reservation_id: string | null;
  seat_code: string;
  source: "customer" | "staff";
  status: "assigned" | "closed" | "new" | "processing" | "verification";
  store_code: string;
  store_display_name: string;
}

interface RepairDetailRow extends RepairRow {
  assigned_to_display_name: string | null;
  assigned_to_persona_id: string | null;
  assigned_to_role: FrontlineRole | null;
  latest_verification_outcome: "failure" | "success" | null;
  latest_verification_reason: string | null;
  resolution_business_at: Date | null;
  resolution_note: string | null;
  resolution_submitted_by_display_name: string | null;
  resolution_submitted_by_persona_id: string | null;
  store_id: string;
  verification_business_at: Date | null;
  verified_by_display_name: string | null;
  verified_by_persona_id: string | null;
}

interface RepairStateCommandRow {
  payload_hash: string;
  result_data: {
    action: ExecuteRepairCommandInput["action"];
    affectedReservations: DatabaseRepairCommand["affectedReservations"];
    occurredAt: string;
    repairId: string;
    seatOperationalStatus: DatabaseRepairCommand["seatOperationalStatus"];
    status: DatabaseRepairCommand["status"];
  };
}

interface RepairEventRow {
  business_occurred_at: Date;
  event_data: {
    actorDisplayName?: string;
    actorPersonaId?: string;
    internalNote?: string;
    publicNote?: string;
  };
  event_type: string;
  recorded_at: Date;
}

interface RepairSpareCommandRow {
  payload_hash: string;
  result_data: Omit<
    DatabaseRepairSpareCommand,
    "businessOccurredAt" | "recordedAt" | "replayed"
  > & {
    businessOccurredAt: string;
    recordedAt: string;
  };
}

interface RepairResolutionCommandRow {
  payload_hash: string;
  result_data: Omit<
    DatabaseRepairResolutionCommand,
    "occurredAt" | "recordedAt" | "replayed"
  > & { occurredAt: string; recordedAt: string };
}

interface RepairVerificationCommandRow {
  payload_hash: string;
  result_data: Omit<
    DatabaseRepairVerificationCommand,
    "occurredAt" | "recordedAt" | "replayed"
  > & { occurredAt: string; recordedAt: string };
}

interface RepairCommandRow {
  payload_hash: string;
  result_data: Omit<DatabaseRepairCreated, "createdAt" | "duplicate"> & {
    createdAt: string;
    duplicate: boolean;
  };
}

interface RepairAuthorizationRow {
  customer_persona_id: string | null;
  repair_id: string;
  store_id: string;
}

interface RepairImageIntentRow {
  actor_persona_id: string;
  declared_content_type: RepairImageContentType;
  declared_size: number;
  expires_at: Date;
  filename_extension: "jpeg" | "jpg" | "png" | "webp";
  intent_id: string;
  quarantine_object_key: string;
  repair_id: string;
  sandbox_id: string;
  status: "consumed" | "failed" | "issued" | "uploaded" | "uploading";
}

interface RepairImageRow {
  byte_size: number;
  content_type: RepairImageContentType;
  created_at: Date;
  customer_persona_id: string | null;
  height: number;
  image_id: string;
  object_key: string | null;
  repair_id: string;
  sample_asset_id: "repair-headset-v1" | null;
  sandbox_id: string;
  source: "sample" | "uploaded";
  store_id: string;
  width: number;
}

function repairCreatedFromStored(
  value: RepairCommandRow["result_data"],
  duplicate = value.duplicate,
): DatabaseRepairCreated {
  return { ...value, createdAt: new Date(value.createdAt), duplicate };
}

function repairCommandFromStored(
  value: RepairStateCommandRow["result_data"],
  replayed: boolean,
): DatabaseRepairCommand {
  return { ...value, occurredAt: new Date(value.occurredAt), replayed };
}

function repairSpareCommandFromStored(
  value: RepairSpareCommandRow["result_data"],
  replayed: boolean,
): DatabaseRepairSpareCommand {
  return {
    ...value,
    businessOccurredAt: new Date(value.businessOccurredAt),
    recordedAt: new Date(value.recordedAt),
    replayed,
  };
}

function repairResolutionCommandFromStored(
  value: RepairResolutionCommandRow["result_data"],
  replayed: boolean,
): DatabaseRepairResolutionCommand {
  return {
    ...value,
    occurredAt: new Date(value.occurredAt),
    recordedAt: new Date(value.recordedAt),
    replayed,
  };
}

function repairVerificationCommandFromStored(
  value: RepairVerificationCommandRow["result_data"],
  replayed: boolean,
): DatabaseRepairVerificationCommand {
  return {
    ...value,
    occurredAt: new Date(value.occurredAt),
    recordedAt: new Date(value.recordedAt),
    replayed,
  };
}

function repairCreatedFromRow(
  row: RepairRow,
  duplicate: boolean,
): DatabaseRepairCreated {
  return {
    createdAt: row.created_at,
    description: row.description,
    duplicate,
    machineProfile: {
      code: row.machine_profile_code,
      displayName: row.machine_profile_display_name,
    },
    priority: row.priority,
    repairId: row.repair_id,
    reservationId: row.reservation_id,
    seat: {
      code: row.seat_code,
      operationalStatus: row.operational_status,
    },
    source: row.source,
    status: row.status,
    store: {
      code: row.store_code,
      displayName: row.store_display_name,
    },
  };
}

function repairImageIntentFromRow(
  row: RepairImageIntentRow,
): DatabaseRepairImageIntent {
  return {
    declaredContentType: row.declared_content_type,
    declaredSize: row.declared_size,
    expiresAt: row.expires_at,
    filenameExtension: row.filename_extension,
    intentId: row.intent_id,
    quarantineObjectKey: row.quarantine_object_key,
    repairId: row.repair_id,
    sandboxId: row.sandbox_id,
  };
}

function repairImageFromRow(row: RepairImageRow): DatabaseRepairImage {
  if (row.source !== "uploaded" || !row.object_key) {
    throw new RepairImageConflictError("not-found");
  }
  return {
    byteSize: row.byte_size,
    contentType: row.content_type,
    createdAt: row.created_at,
    height: row.height,
    imageId: row.image_id,
    objectKey: row.object_key,
    repairId: row.repair_id,
    sandboxId: row.sandbox_id,
    source: "uploaded",
    width: row.width,
  };
}

function repairImageListItemFromRow(
  row: RepairImageRow,
): DatabaseRepairImageListItem {
  if (row.source === "uploaded") return repairImageFromRow(row);
  if (row.sample_asset_id !== "repair-headset-v1") {
    throw new RepairImageConflictError("not-found");
  }
  return {
    byteSize: 925729,
    contentType: "image/png",
    createdAt: row.created_at,
    height: 720,
    imageId: row.image_id,
    repairId: row.repair_id,
    sampleAssetId: "repair-headset-v1",
    sandboxId: row.sandbox_id,
    source: "sample",
    width: 960,
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
  const inventoryReservationCount = await releaseActiveOrderInventory(client, {
    businessTime: input.businessTime,
    orderId: input.orderId,
    sandboxId: input.sandboxId,
  });
  const couponRestored = await restoreOrderCoupon(client, {
    orderId: input.orderId,
    sandboxId: input.sandboxId,
  });
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
          couponRestored,
          inventoryReservationCount,
          reason: input.reason,
        }),
        input.businessTime,
        input.recordedAt,
      ],
    );
  }
  return updated.rowCount === 1;
}

async function releaseActiveOrderInventory(
  client: PoolClient,
  input: { businessTime: Date; orderId: string; sandboxId: string },
): Promise<number> {
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
  return released.rowCount ?? 0;
}

async function restoreOrderCoupon(
  client: PoolClient,
  input: { orderId: string; sandboxId: string },
): Promise<boolean> {
  const restored = await client.query(
    `update experience_coupons
        set status = 'available', reserved_order_id = null, reserved_until = null
      where sandbox_id = $1 and reserved_order_id = $2
        and status in ('reserved', 'redeemed')`,
    [input.sandboxId, input.orderId],
  );
  return restored.rowCount === 1;
}

async function recordOrderSimulatedRefund(
  client: PoolClient,
  input: {
    amountCents: number;
    businessTime: Date;
    orderId: string;
    reason: string | null;
    recordedAt: Date;
    sandboxId: string;
  },
): Promise<void> {
  await client.query(
    `insert into order_simulated_refunds (
       id, sandbox_id, order_id, amount_cents, reason,
       business_occurred_at, recorded_at
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      randomUUID(),
      input.sandboxId,
      input.orderId,
      input.amountCents,
      input.reason,
      input.businessTime,
      input.recordedAt,
    ],
  );
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

function formatBusinessHours(store: StoreBusinessHoursSelection): string {
  if (store.is_open_24_hours) return "24 小时";

  const opensAt = store.opens_at.slice(0, 5);
  const closesAt =
    store.closes_at === "00:00:00" ? "24:00" : store.closes_at.slice(0, 5);
  return `${opensAt}–${store.closes_next_day ? "次日 " : ""}${closesAt}`;
}

interface StoreBusinessHoursSelection {
  closes_at: string;
  closes_next_day: boolean;
  is_open_24_hours: boolean;
  opens_at: string;
}

async function businessHoursFor(
  client: PoolClient,
  input: {
    readonly at: Date;
    readonly baseline: StoreBusinessHoursSelection;
    readonly sandboxId: string;
    readonly storeId: string;
  },
): Promise<StoreBusinessHoursSelection> {
  const scheduled = await client.query<StoreBusinessHoursSelection>(
    `select opens_at, closes_at, closes_next_day, is_open_24_hours
       from store_business_hours_versions
      where sandbox_id = $1 and store_id = $2 and effective_from <= $3
        and (
          day_set = 'all'
          or (day_set = 'weekdays'
            and extract(isodow from
              ($3::timestamptz at time zone 'Asia/Shanghai') - interval '6 hours'
            ) between 1 and 5)
          or (day_set = 'weekends'
            and extract(isodow from
              ($3::timestamptz at time zone 'Asia/Shanghai') - interval '6 hours'
            ) between 6 and 7)
        )
      order by effective_from desc,
        case day_set when 'all' then 0 else 1 end desc
      limit 1`,
    [input.sandboxId, input.storeId, input.at],
  );
  return scheduled.rows[0] ?? input.baseline;
}

function dashboardBusinessClockAt(
  key: string,
  clock: string,
  forceNextDay = false,
) {
  const normalizedClock = clock.slice(0, 5);
  const [hours = 0, minutes = 0] = normalizedClock.split(":").map(Number);
  const dayOffset = forceNextDay || hours * 60 + minutes < 6 * 60 ? 1 : 0;
  const serial =
    Math.floor(Date.parse(`${key}T00:00:00.000Z`) / (24 * 60 * 60 * 1_000)) +
    dayOffset;
  const localDate = new Date(serial * 24 * 60 * 60 * 1_000);
  const localKey = `${localDate.getUTCFullYear()}-${String(
    localDate.getUTCMonth() + 1,
  ).padStart(2, "0")}-${String(localDate.getUTCDate()).padStart(2, "0")}`;
  return new Date(`${localKey}T${normalizedClock}:00.000+08:00`);
}

function dashboardBusinessWindow(
  day: ReturnType<typeof managerDashboardBusinessDays>[number],
  hours: StoreBusinessHoursSelection,
) {
  if (hours.is_open_24_hours) {
    return { ...day, opensAt: day.startsAt };
  }
  return {
    ...day,
    endsAt: dashboardBusinessClockAt(
      day.key,
      hours.closes_at,
      hours.closes_next_day,
    ),
    opensAt: dashboardBusinessClockAt(day.key, hours.opens_at),
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

interface EffectiveSandboxAdmissionLimits {
  readonly activeSandboxLimit: number;
  readonly createPerIp: SandboxRequestRateLimit;
  readonly createPerVisitor: SandboxRequestRateLimit;
  readonly resetPerIp: SandboxRequestRateLimit;
  readonly resetPerVisitor: SandboxRequestRateLimit;
}

const DEFAULT_SANDBOX_REQUEST_RATE_LIMIT: SandboxRequestRateLimit = {
  perDay: 20,
  perHour: 5,
};
const DEFAULT_SANDBOX_IP_RATE_LIMIT: SandboxRequestRateLimit = {
  perDay: 200,
  perHour: 50,
};

function normalizeRequestRateLimit(
  value: SandboxRequestRateLimit | undefined,
  fallback: SandboxRequestRateLimit,
): SandboxRequestRateLimit {
  const perDay = value?.perDay ?? fallback.perDay;
  const perHour = value?.perHour ?? fallback.perHour;
  if (
    !Number.isSafeInteger(perDay) ||
    !Number.isSafeInteger(perHour) ||
    perDay < 1 ||
    perHour < 1
  ) {
    throw new Error("Sandbox request rate limits must be positive integers.");
  }
  return { perDay, perHour };
}

function normalizeSandboxAdmissionLimits(
  value: PublicSandboxAdmissionLimits | undefined,
): EffectiveSandboxAdmissionLimits {
  const activeSandboxLimit = value?.activeSandboxLimit ?? 200;
  if (!Number.isSafeInteger(activeSandboxLimit) || activeSandboxLimit < 1) {
    throw new Error("Sandbox active capacity must be a positive integer.");
  }
  return {
    activeSandboxLimit,
    createPerIp: normalizeRequestRateLimit(
      value?.createPerIp,
      DEFAULT_SANDBOX_IP_RATE_LIMIT,
    ),
    createPerVisitor: normalizeRequestRateLimit(
      value?.createPerVisitor,
      DEFAULT_SANDBOX_REQUEST_RATE_LIMIT,
    ),
    resetPerIp: normalizeRequestRateLimit(
      value?.resetPerIp,
      DEFAULT_SANDBOX_IP_RATE_LIMIT,
    ),
    resetPerVisitor: normalizeRequestRateLimit(
      value?.resetPerVisitor,
      DEFAULT_SANDBOX_REQUEST_RATE_LIMIT,
    ),
  };
}

function hourWindowStart(wallTime: Date): Date {
  return new Date(Math.floor(wallTime.getTime() / HOUR_MS) * HOUR_MS);
}

function dayWindowStart(wallTime: Date): Date {
  return new Date(
    Date.UTC(
      wallTime.getUTCFullYear(),
      wallTime.getUTCMonth(),
      wallTime.getUTCDate(),
    ),
  );
}

function managerStoreConfigurationDenialSummary(
  input: ExecuteManagerStoreConfigurationCommandInput,
  payloadHash: string,
): Record<string, unknown> {
  const common = {
    action: input.action,
    expectedVersion: input.expectedVersion,
    payloadHash,
    storeId: input.storeId,
  };
  switch (input.action) {
    case "update-store-profile":
      return common;
    case "schedule-business-hours":
      return {
        ...common,
        closesNextDay: input.closesNextDay,
        daySet: input.daySet,
        effectiveFrom: input.effectiveFrom.toISOString(),
        isOpen24Hours: input.isOpen24Hours,
      };
    case "create-area":
      return {
        ...common,
        lifecycleStatus: input.lifecycleStatus,
        sortOrder: input.sortOrder,
      };
    case "update-area":
      return {
        ...common,
        areaId: input.areaId,
        lifecycleStatus: input.lifecycleStatus,
        sortOrder: input.sortOrder,
      };
    case "delete-area":
      return { ...common, areaId: input.areaId };
    case "create-seat":
      return {
        ...common,
        areaId: input.areaId,
        lifecycleStatus: input.lifecycleStatus,
        machineProfileId: input.machineProfileId,
        sortOrder: input.sortOrder,
      };
    case "update-seat":
      return {
        ...common,
        areaId: input.areaId,
        lifecycleStatus: input.lifecycleStatus,
        machineProfileId: input.machineProfileId,
        seatId: input.seatId,
        sortOrder: input.sortOrder,
      };
    case "delete-seat":
      return { ...common, seatId: input.seatId };
    case "create-price-plan":
      return {
        ...common,
        areaId: input.areaId,
        effectiveFrom: input.effectiveFrom.toISOString(),
        endsNextDay: input.endsNextDay,
        machineProfileId: input.machineProfileId,
        weekdayHalfHourCents: input.weekdayHalfHourCents,
        weekendHalfHourCents: input.weekendHalfHourCents,
      };
    case "archive-price-plan":
      return { ...common, pricePlanId: input.pricePlanId };
    case "update-store-product":
      return {
        ...common,
        listed: input.listed,
        lowStockThreshold: input.lowStockThreshold,
        storeProductId: input.storeProductId,
        unitPriceCents: input.unitPriceCents,
      };
    case "archive-store-product":
      return { ...common, storeProductId: input.storeProductId };
  }
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
  const relatedRepairs = await readRelatedRepairs(
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
    related: { orders: relatedOrders, repairs: relatedRepairs },
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

function assertSandboxAvailable(
  sandbox: SandboxRow | undefined,
  wallTime: Date,
): asserts sandbox is SandboxRow {
  if (!sandbox) throw new RoleContextUnavailableError();
  // Cleanup marks an expired sandbox invalidated so it cannot be revived. Its
  // externally observable ending remains natural expiry, not a reset.
  if (sandbox.expires_at.getTime() <= wallTime.getTime()) {
    throw new RoleContextUnavailableError("expired");
  }
  if (sandbox.invalidated_at !== null) {
    throw new RoleContextUnavailableError("reset");
  }
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
  assertSandboxAvailable(sandboxRow, wallTime);
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
  assertSandboxAvailable(sandboxRow, wallTime);
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

async function assertHeadquartersContext(
  client: PoolClient,
  input: ReadHeadquartersPeopleScheduleInput,
  wallTime: Date,
): Promise<SandboxRow> {
  const sandbox = await client.query<SandboxRow>(
    `select ${SANDBOX_ROW_COLUMNS} from sandboxes where id = $1`,
    [input.sandboxId],
  );
  const sandboxRow = sandbox.rows[0];
  assertSandboxAvailable(sandboxRow, wallTime);
  if (
    input.role !== "hq" ||
    sandboxRow.role_context_role !== "hq" ||
    sandboxRow.role_context_version !== input.contextVersion
  ) {
    throw new RoleContextStaleError();
  }
  const persona = await client.query<{ id: string }>(
    `select id from demo_personas
      where sandbox_id = $1 and id = $2 and role = 'hq' and protected = true`,
    [input.sandboxId, input.personaId],
  );
  if (!persona.rows[0]) throw new RoleContextUnavailableError();
  return sandboxRow;
}

async function assertDemoStoryContext(
  client: PoolClient,
  input: ReadDemoStoryInput,
  wallTime: Date,
): Promise<SandboxRow> {
  switch (input.role) {
    case "customer":
      return assertCustomerBrowseContext(client, input, wallTime);
    case "staff":
    case "manager":
      return (
        await assertFrontlineContext(
          client,
          { ...input, role: input.role },
          wallTime,
        )
      ).sandbox;
    case "hq":
      return assertHeadquartersContext(
        client,
        { ...input, role: "hq" },
        wallTime,
      );
  }
}

function demoStoryEvidence(
  kind: DemoStoryEvidenceKind,
  occurredAt: Date,
  summary: string,
): DatabaseDemoStoryEvidence {
  return { kind, occurredAt, summary };
}

/**
 * The public story deliberately keys every fact to the protected customer and
 * the intended flagship objects. Seeded background history can enrich reports,
 * but it must never advance a visitor's own demonstration.
 */
async function readDemoStoryWithClient(
  client: PoolClient,
  input: ReadDemoStoryInput,
  wallTime: Date,
): Promise<DatabaseDemoStory> {
  await assertDemoStoryContext(client, input, wallTime);

  const reset = await client.query<{ reset_at: Date }>(
    `select business_occurred_at as reset_at
       from audit_events
      where sandbox_id = $1 and action = 'sandbox.reset.source'
        and object_type = 'sandbox' and result = 'allowed'
      order by business_occurred_at desc, recorded_at desc, id desc
      limit 1`,
    [input.sandboxId],
  );
  const resetAt = reset.rows[0]?.reset_at ?? null;

  const personas = await client.query<{
    customer_id: string | null;
    manager_id: string | null;
  }>(
    `select
       (select id from demo_personas
         where sandbox_id = $1 and role = 'customer' and protected = true)
         as customer_id,
       (select id from demo_personas
         where sandbox_id = $1 and role = 'manager' and protected = true)
         as manager_id`,
    [input.sandboxId],
  );
  const customerId = personas.rows[0]?.customer_id;
  const managerId = personas.rows[0]?.manager_id;
  if (!customerId || !managerId) throw new RoleContextUnavailableError();

  const reservation = await client.query<{
    arrived_business_at: Date | null;
    arrived_event_at: Date | null;
    confirmed_business_at: Date | null;
    created_business_at: Date;
    created_event_at: Date | null;
    reservation_id: string;
    payment_event_at: Date | null;
    started_business_at: Date | null;
    started_event_at: Date | null;
  }>(
    `select reservation.id as reservation_id,
            reservation.created_business_at,
            reservation.confirmed_business_at,
            reservation.arrived_business_at,
            reservation.started_business_at,
            max(event.business_occurred_at) filter (
              where event.event_type = 'reservation.pending-created'
            ) as created_event_at,
            max(event.business_occurred_at) filter (
              where event.event_type = 'reservation.simulated-payment-succeeded'
            ) as payment_event_at,
            max(event.business_occurred_at) filter (
              where event.event_type = 'reservation.arrived'
            ) as arrived_event_at,
            max(event.business_occurred_at) filter (
              where event.event_type = 'reservation.started'
            ) as started_event_at
       from reservations reservation
       join stores store on store.id = reservation.store_id
       join seats seat on seat.id = reservation.seat_id
       join machine_profiles machine on machine.id = seat.machine_profile_id
       left join reservation_business_events event
         on event.reservation_id = reservation.id
        and event.sandbox_id = reservation.sandbox_id
      where reservation.sandbox_id = $1
        and reservation.customer_persona_id = $2
        and store.code = 'prism-flagship'
        and machine.code = 'competitive'
        and reservation.coupon_id is not null
        and reservation.ends_at - reservation.starts_at = interval '2 hours'
        and reservation.starts_at > reservation.created_business_at - interval '30 minutes'
        and exists (
          select 1
            from reservation_business_events created_event
           where created_event.sandbox_id = reservation.sandbox_id
             and created_event.reservation_id = reservation.id
             and created_event.event_type = 'reservation.pending-created'
             and (
               created_event.event_data->>'mode' = 'immediate'
               or (
                 not (created_event.event_data ? 'mode')
                 and reservation.starts_at <= reservation.created_business_at
               )
             )
        )
      group by reservation.id
      order by reservation.created_business_at, reservation.id
      limit 1`,
    [input.sandboxId, customerId],
  );
  const reservationRow = reservation.rows[0] ?? null;

  const order = reservationRow
    ? await client.query<{
        fulfilled_event_at: Date | null;
        order_id: string;
        paid_business_at: Date | null;
        payment_event_at: Date | null;
      }>(
        `select customer_order.id as order_id,
                customer_order.paid_business_at,
                max(event.business_occurred_at) filter (
                  where event.event_type = 'order.simulated-payment-succeeded'
                ) as payment_event_at,
                max(event.business_occurred_at) filter (
                  where event.event_type in (
                    'order.preparing', 'order.ready-for-pickup', 'order.completed'
                  )
                ) as fulfilled_event_at
           from customer_orders customer_order
           join experience_coupons coupon
             on coupon.id = customer_order.coupon_id
            and coupon.sandbox_id = customer_order.sandbox_id
            and coupon.business_kind = 'order'
           left join order_business_events event
             on event.order_id = customer_order.id
            and event.sandbox_id = customer_order.sandbox_id
          where customer_order.sandbox_id = $1
            and customer_order.reservation_id = $2
            and customer_order.customer_persona_id = $3
          group by customer_order.id
          order by customer_order.created_business_at, customer_order.id
          limit 1`,
        [input.sandboxId, reservationRow.reservation_id, customerId],
      )
    : null;
  const orderRow = order?.rows[0] ?? null;

  const timeAdvance =
    reservationRow && orderRow?.fulfilled_event_at
      ? await client.query<{ advanced_at: Date }>(
          `select business_occurred_at as advanced_at
       from audit_events
      where sandbox_id = $1 and action = 'demo_time.advance'
        and result = 'allowed' and after_data->>'mode' = 'half-hour'
        and business_occurred_at > $2
      order by business_occurred_at, recorded_at, id
      limit 1`,
          [input.sandboxId, orderRow.fulfilled_event_at],
        )
      : null;
  const advancedAt = timeAdvance?.rows[0]?.advanced_at ?? null;

  const repair =
    reservationRow && advancedAt
      ? await client.query<{
          assigned_business_at: Date | null;
          assigned_event_at: Date | null;
          closed_business_at: Date | null;
          closed_event_at: Date | null;
          created_business_at: Date;
          has_maintenance_refund: boolean;
          has_one_replacement: boolean;
          processing_business_at: Date | null;
          processing_event_at: Date | null;
          repair_id: string;
          resolution_business_at: Date | null;
          resolution_event_at: Date | null;
          seat_operational_status: "maintenance" | "normal";
          verification_business_at: Date | null;
          verification_event_at: Date | null;
          verified_by_persona_id: string | null;
        }>(
          `select repair.id as repair_id,
                  repair.created_business_at,
                  repair.assigned_business_at,
                  repair.processing_business_at,
                  repair.resolution_business_at,
                  repair.verification_business_at,
                  repair.closed_business_at,
                  repair.verified_by_persona_id,
                  seat.operational_status as seat_operational_status,
                  max(event.business_occurred_at) filter (
                    where event.event_type = 'repair.assigned'
                  ) as assigned_event_at,
                  max(event.business_occurred_at) filter (
                    where event.event_type = 'repair.processing-started'
                  ) as processing_event_at,
                  max(event.business_occurred_at) filter (
                    where event.event_type = 'repair.resolution-submitted'
                  ) as resolution_event_at,
                  max(event.business_occurred_at) filter (
                    where event.event_type = 'repair.closed'
                  ) as closed_event_at,
                  max(event.business_occurred_at) filter (
                    where event.event_type = 'repair.closed'
                  ) as verification_event_at,
                  exists(
                    select 1
                      from reservation_business_events maintenance_event
                      join reservation_simulated_refunds refund
                        on refund.sandbox_id = maintenance_event.sandbox_id
                       and refund.reservation_id = maintenance_event.reservation_id
                     where maintenance_event.sandbox_id = repair.sandbox_id
                       and maintenance_event.reservation_id = repair.reservation_id
                       and maintenance_event.event_type =
                         'reservation.completed-for-maintenance'
                       and maintenance_event.event_data->>'repairId' = repair.id::text
                       and refund.amount_cents > 0
                  ) as has_maintenance_refund,
                  exists(
                    select 1
                      from repair_spare_usages usage
                      join inventory_items item
                        on item.id = usage.inventory_item_id
                      join inventory_movements movement
                        on movement.id = usage.inventory_movement_id
                     where usage.sandbox_id = repair.sandbox_id
                       and usage.repair_id = repair.id
                       and usage.quantity - usage.returned_quantity = 1
                       and item.code = 'spare-headset'
                       and movement.movement_kind = 'spare-usage'
                  ) as has_one_replacement
             from repairs repair
             join seats seat on seat.id = repair.seat_id
             left join repair_business_events event
               on event.sandbox_id = repair.sandbox_id
              and event.repair_id = repair.id
            where repair.sandbox_id = $1
              and repair.reservation_id = $2
              and repair.customer_persona_id = $3
              and repair.source = 'customer'
              and repair.description = '耳机右声道无声'
              and repair.created_business_at >= $4
            group by repair.id, seat.operational_status
            order by repair.created_business_at, repair.id
            limit 1`,
          [
            input.sandboxId,
            reservationRow.reservation_id,
            customerId,
            advancedAt,
          ],
        )
      : null;
  const repairRow = repair?.rows[0] ?? null;

  const exportEvidence = repairRow?.closed_business_at
    ? await client.query<{ exported_at: Date }>(
        `select min(audit.business_occurred_at) as exported_at
           from audit_events audit
          where audit.sandbox_id = $1 and audit.role = 'hq'
            and audit.action = 'export.csv' and audit.result = 'allowed'
            and audit.business_occurred_at >= $2
          group by audit.request_id
          having count(*) = 3 and count(distinct audit.store_id) = 3
          order by min(audit.business_occurred_at), audit.request_id
          limit 1`,
        [input.sandboxId, repairRow.closed_business_at],
      )
    : null;
  const exportedAt = exportEvidence?.rows[0]?.exported_at ?? null;

  const raw = new Map<
    DemoStoryStepId,
    {
      readonly evidence: ReadonlyArray<DatabaseDemoStoryEvidence>;
      readonly satisfied: boolean;
    }
  >([
    [
      "reservation-created",
      {
        evidence: reservationRow?.created_event_at
          ? [
              demoStoryEvidence(
                "business-event",
                reservationRow.created_event_at,
                "棱镜旗舰店竞技型即时两小时预约及体验券已记录",
              ),
            ]
          : [],
        satisfied: Boolean(reservationRow?.created_event_at),
      },
    ],
    [
      "reservation-paid",
      {
        evidence: reservationRow?.payment_event_at
          ? [
              demoStoryEvidence(
                "business-event",
                reservationRow.payment_event_at,
                "预约模拟支付成功事件已记录",
              ),
            ]
          : [],
        satisfied: Boolean(
          reservationRow?.confirmed_business_at &&
          reservationRow.payment_event_at,
        ),
      },
    ],
    [
      "reservation-arrived",
      {
        evidence: reservationRow?.arrived_event_at
          ? [
              demoStoryEvidence(
                "business-event",
                reservationRow.arrived_event_at,
                "店员办理到店事件已记录",
              ),
            ]
          : [],
        satisfied: Boolean(
          reservationRow?.arrived_business_at &&
          reservationRow.arrived_event_at,
        ),
      },
    ],
    [
      "reservation-in-use",
      {
        evidence: reservationRow?.started_event_at
          ? [
              demoStoryEvidence(
                "business-event",
                reservationRow.started_event_at,
                "店员开始使用事件已记录",
              ),
            ]
          : [],
        satisfied: Boolean(
          reservationRow?.started_business_at &&
          reservationRow.started_event_at,
        ),
      },
    ],
    [
      "order-paid",
      {
        evidence: orderRow?.payment_event_at
          ? [
              demoStoryEvidence(
                "business-event",
                orderRow.payment_event_at,
                "顾客商品订单模拟支付成功事件已记录",
              ),
            ]
          : [],
        satisfied: Boolean(
          orderRow?.paid_business_at && orderRow.payment_event_at,
        ),
      },
    ],
    [
      "order-fulfilled",
      {
        evidence: orderRow?.fulfilled_event_at
          ? [
              demoStoryEvidence(
                "business-event",
                orderRow.fulfilled_event_at,
                "店员订单履约事件已记录",
              ),
            ]
          : [],
        satisfied: Boolean(orderRow?.fulfilled_event_at),
      },
    ],
    [
      "business-time-advanced",
      {
        evidence: advancedAt
          ? [
              demoStoryEvidence(
                "audit-event",
                advancedAt,
                "共享业务时间已向前推进 30 分钟",
              ),
            ]
          : [],
        satisfied: Boolean(advancedAt),
      },
    ],
    [
      "repair-created",
      {
        evidence: repairRow
          ? [
              demoStoryEvidence(
                "business-event",
                repairRow.created_business_at,
                "顾客“耳机右声道无声”报修已提交",
              ),
            ]
          : [],
        satisfied: Boolean(repairRow),
      },
    ],
    [
      "repair-resolved",
      {
        evidence: repairRow
          ? [
              ...(repairRow.processing_event_at
                ? [
                    demoStoryEvidence(
                      "business-event",
                      repairRow.processing_event_at,
                      "维修已开始，座位维护与价格分段模拟退款已记录",
                    ),
                  ]
                : []),
              ...(repairRow.resolution_event_at
                ? [
                    demoStoryEvidence(
                      "business-event",
                      repairRow.resolution_event_at,
                      "维修结论已提交",
                    ),
                  ]
                : []),
            ]
          : [],
        satisfied: Boolean(
          repairRow?.assigned_business_at &&
          repairRow.assigned_event_at &&
          repairRow.processing_business_at &&
          repairRow.processing_event_at &&
          repairRow.resolution_business_at &&
          repairRow.resolution_event_at &&
          repairRow.has_maintenance_refund &&
          repairRow.has_one_replacement,
        ),
      },
    ],
    [
      "repair-verified",
      {
        evidence: repairRow?.verification_event_at
          ? [
              demoStoryEvidence(
                "business-event",
                repairRow.verification_event_at,
                "店长独立复核通过，座位已恢复可用且审计记录可查",
              ),
            ]
          : [],
        satisfied: Boolean(
          repairRow?.verification_business_at &&
          repairRow.closed_business_at &&
          repairRow.closed_event_at &&
          repairRow.verified_by_persona_id === managerId &&
          repairRow.seat_operational_status === "normal",
        ),
      },
    ],
    [
      "headquarters-exported",
      {
        evidence: exportedAt
          ? [
              demoStoryEvidence(
                "audit-event",
                exportedAt,
                "总部固定三店比较导出已按同一请求写入三条审计记录",
              ),
            ]
          : [],
        satisfied: Boolean(exportedAt),
      },
    ],
    ["sandbox-reset", { evidence: [], satisfied: false }],
  ]);

  let previousSatisfied = true;
  const steps = DEMO_STORY_STEP_IDS.map((id) => {
    const step = raw.get(id)!;
    const satisfied = previousSatisfied && step.satisfied;
    previousSatisfied = satisfied;
    return { ...step, id, satisfied };
  });

  return { resetAt, steps };
}

async function assertStoreConfigurationContext(
  client: PoolClient,
  input: ReadManagerStoreConfigurationInput,
  wallTime: Date,
): Promise<StoreConfigurationContext> {
  if (input.role === "manager") {
    const context = await assertFrontlineContext(
      client,
      { ...input, role: "manager" },
      wallTime,
    );
    return context;
  }

  const sandbox = await assertHeadquartersContext(
    client,
    { ...input, role: "hq" },
    wallTime,
  );
  const store = await client.query<{ id: string }>(
    `select id from stores
      where sandbox_id = $1 and id = $2
        and code = any($3::text[])`,
    [input.sandboxId, input.storeId ?? null, HEADQUARTERS_FIXED_STORE_CODES],
  );
  return { actorStoreId: store.rows[0]?.id ?? null, sandbox };
}

async function managerShiftPreviewWithClient(
  client: PoolClient,
  input: PreviewManagerShiftCoverageInput,
): Promise<DatabaseManagerShiftPreview> {
  const employee = await client.query<{
    active: boolean;
    role: FrontlineRole;
    store_id: string;
  }>(
    `select store_id, role, active from employees
      where sandbox_id = $1 and id = $2`,
    [input.sandboxId, input.employeeId],
  );
  const employeeRow = employee.rows[0];
  if (!employeeRow || employeeRow.store_id !== input.storeId) {
    throw new ManagerPeopleConflictError("employee-not-found");
  }
  if (!employeeRow.active) {
    throw new ManagerPeopleConflictError("inactive-employee");
  }
  const existing = await client.query<{ ends_at: Date; starts_at: Date }>(
    `select starts_at, ends_at from shifts
      where sandbox_id = $1 and employee_id = $2 and status = 'scheduled'
        and ($3::uuid is null or id <> $3)
        and starts_at < $4 and ends_at > $5
      order by starts_at, id`,
    [
      input.sandboxId,
      input.employeeId,
      input.shiftId ?? null,
      input.endsAt,
      input.startsAt,
    ],
  );
  const validation = validateShiftSchedule({
    endsAt: input.endsAt,
    existingWindows: existing.rows.map((shift) => ({
      endsAt: shift.ends_at,
      startsAt: shift.starts_at,
    })),
    startsAt: input.startsAt,
  });
  if (validation.status === "invalid") {
    return { validation, warnings: [] };
  }
  const coverage = await client.query<{ ends_at: Date; starts_at: Date }>(
    `select shift.starts_at, shift.ends_at
       from shifts shift
       join employees employee on employee.id = shift.employee_id
      where shift.sandbox_id = $1 and shift.store_id = $2
        and shift.status = 'scheduled' and employee.active = true
        and employee.role = 'staff'
        and ($3::uuid is null or shift.id <> $3)
        and shift.starts_at < $4 and shift.ends_at > $5
      order by shift.starts_at, shift.id`,
    [
      input.sandboxId,
      input.storeId,
      input.shiftId ?? null,
      input.endsAt,
      input.startsAt,
    ],
  );
  return {
    validation,
    warnings: evaluateStaffCoverage({
      minimumStaff: 3,
      range: { endsAt: input.endsAt, startsAt: input.startsAt },
      shifts: [
        ...coverage.rows.map((shift) => ({
          endsAt: shift.ends_at,
          startsAt: shift.starts_at,
        })),
        ...(employeeRow.role === "staff"
          ? [{ endsAt: input.endsAt, startsAt: input.startsAt }]
          : []),
      ],
    }),
  };
}

async function assertEmployeeContext(
  client: PoolClient,
  input: ReadOwnShiftAttendanceInput,
  wallTime: Date,
) {
  const context = await assertFrontlineContext(client, input, wallTime);
  const employee = await client.query<EmployeeRow>(
    `select employee.id, employee.store_id, employee.persona_id,
            employee.employee_code, employee.display_name, employee.role,
            employee.active, store.code as store_code,
            store.display_name as store_display_name
       from employees employee
       join stores store on store.id = employee.store_id
      where employee.sandbox_id = $1 and employee.persona_id = $2
        and employee.role = $3 and employee.active = true`,
    [input.sandboxId, input.personaId, input.role],
  );
  const employeeRow = employee.rows[0];
  if (!employeeRow || employeeRow.store_id !== context.actorStoreId) {
    throw new RoleContextUnavailableError();
  }
  return { ...context, employee: employeeRow };
}

interface DueAttendanceShiftRow {
  employee_id: string;
  ends_at: Date;
  persona_id: string | null;
  role: FrontlineRole;
  shift_id: string;
  starts_at: Date;
  store_id: string;
}

async function processDueAttendanceAbsences(
  client: PoolClient,
  input: {
    readonly employeeId?: string;
    readonly recordedAt: Date;
    readonly sandboxId: string;
    readonly targetBusinessTime: Date;
  },
): Promise<number> {
  const due = await client.query<DueAttendanceShiftRow>(
    `select shift.id as shift_id, shift.store_id, shift.employee_id,
            shift.starts_at, shift.ends_at, employee.persona_id, employee.role
       from shifts shift
       join employees employee on employee.id = shift.employee_id
       left join attendance_records attendance
         on attendance.sandbox_id = shift.sandbox_id
        and attendance.shift_id = shift.id
      where shift.sandbox_id = $1 and shift.status = 'scheduled'
        and shift.ends_at <= $2 and attendance.id is null
        and ($3::uuid is null or shift.employee_id = $3)
      order by shift.ends_at, shift.id`,
    [input.sandboxId, input.targetBusinessTime, input.employeeId ?? null],
  );

  let processed = 0;
  for (const shift of due.rows) {
    const decision = decideAttendanceAction({
      action: "mark-absent",
      businessTime: shift.ends_at,
      endsAt: shift.ends_at,
      startsAt: shift.starts_at,
      status: null,
    });
    if (decision.status !== "ready") {
      throw new Error("A due shift did not have a legal absence result.");
    }
    const attendanceId = randomUUID();
    const inserted = await client.query<{ id: string }>(
      `insert into attendance_records (
         id, sandbox_id, store_id, employee_id, shift_id, status,
         absence_business_at, absence_recorded_at
       ) values ($1, $2, $3, $4, $5, 'absent', $6, $7)
       on conflict (sandbox_id, shift_id) do nothing
       returning id`,
      [
        attendanceId,
        input.sandboxId,
        shift.store_id,
        shift.employee_id,
        shift.shift_id,
        shift.ends_at,
        input.recordedAt,
      ],
    );
    if (!inserted.rows[0]) continue;
    await client.query(
      `insert into attendance_events (
         id, sandbox_id, store_id, employee_id, shift_id,
         attendance_record_id, event_type, event_data,
         business_occurred_at, recorded_at
       ) values ($1, $2, $3, $4, $5, $6,
         'attendance.absence-recorded', $7::jsonb, $8, $9)`,
      [
        randomUUID(),
        input.sandboxId,
        shift.store_id,
        shift.employee_id,
        shift.shift_id,
        attendanceId,
        JSON.stringify({ reason: "shift-ended-without-check-in" }),
        shift.ends_at,
        input.recordedAt,
      ],
    );
    await client.query(
      `insert into audit_events (
         id, sandbox_id, store_id, persona_id, role, action, object_type,
         object_id, result, reason, request_id, before_data, after_data,
         business_occurred_at, recorded_at
       ) values ($1, $2, $3, $4, $5, 'attendance.absence-record',
         'shift', $6, 'allowed', 'shift-ended-without-check-in', $7,
         $8::jsonb, $9::jsonb, $10, $11)`,
      [
        randomUUID(),
        input.sandboxId,
        shift.store_id,
        shift.persona_id,
        shift.role,
        shift.shift_id,
        randomUUID(),
        JSON.stringify({ status: null }),
        JSON.stringify({ status: "absent" }),
        shift.ends_at,
        input.recordedAt,
      ],
    );
    processed += 1;
  }
  return processed;
}

function storedHandoverSnapshot(
  snapshot: DatabaseHandoverSnapshot,
): StoredHandoverSnapshot {
  return {
    ...snapshot,
    capturedAt: snapshot.capturedAt.toISOString(),
    reservations: snapshot.reservations.map((reservation) => ({
      ...reservation,
      endsAt: reservation.endsAt.toISOString(),
      startsAt: reservation.startsAt.toISOString(),
    })),
  };
}

function handoverSnapshotFromStored(
  snapshot: StoredHandoverSnapshot,
): DatabaseHandoverSnapshot {
  return {
    ...snapshot,
    capturedAt: new Date(snapshot.capturedAt),
    reservations: snapshot.reservations.map((reservation) => ({
      ...reservation,
      endsAt: new Date(reservation.endsAt),
      startsAt: new Date(reservation.startsAt),
    })),
  };
}

function storedHandoverFromDatabase(
  handover: DatabaseHandover,
): StoredHandover {
  return {
    ...handover,
    confirmed: handover.confirmed
      ? {
          ...handover.confirmed,
          businessOccurredAt:
            handover.confirmed.businessOccurredAt.toISOString(),
          recordedAt: handover.confirmed.recordedAt.toISOString(),
        }
      : null,
    snapshot: storedHandoverSnapshot(handover.snapshot),
    submittedAt: {
      businessOccurredAt: handover.submittedAt.businessOccurredAt.toISOString(),
      recordedAt: handover.submittedAt.recordedAt.toISOString(),
    },
  };
}

function handoverFromStored(handover: StoredHandover): DatabaseHandover {
  return {
    ...handover,
    confirmed: handover.confirmed
      ? {
          ...handover.confirmed,
          businessOccurredAt: new Date(handover.confirmed.businessOccurredAt),
          recordedAt: new Date(handover.confirmed.recordedAt),
        }
      : null,
    snapshot: handoverSnapshotFromStored(handover.snapshot),
    submittedAt: {
      businessOccurredAt: new Date(handover.submittedAt.businessOccurredAt),
      recordedAt: new Date(handover.submittedAt.recordedAt),
    },
  };
}

function handoverFromRow(row: HandoverRow): DatabaseHandover {
  return {
    confirmed:
      row.confirmation_business_at &&
      row.confirmation_recorded_at &&
      row.confirmer_display_name &&
      row.confirmer_employee_code
        ? {
            businessOccurredAt: row.confirmation_business_at,
            by: {
              displayName: row.confirmer_display_name,
              employeeCode: row.confirmer_employee_code,
            },
            recordedAt: row.confirmation_recorded_at,
          }
        : null,
    handoverId: row.handover_id,
    note: row.note,
    shiftId: row.shift_id,
    snapshot: handoverSnapshotFromStored(row.snapshot),
    submittedAt: {
      businessOccurredAt: row.submitted_business_at,
      recordedAt: row.submitted_recorded_at,
    },
    submittedBy: {
      displayName: row.submitter_display_name,
      employeeCode: row.submitter_employee_code,
    },
  };
}

const handoverSelect = `select handover.id as handover_id,
       handover.store_id, handover.shift_id, handover.submitted_by_employee_id,
       handover.note, handover.snapshot,
       handover.submitted_business_at, handover.submitted_recorded_at,
       submitter.display_name as submitter_display_name,
       submitter.employee_code as submitter_employee_code,
       confirmation.business_occurred_at as confirmation_business_at,
       confirmation.recorded_at as confirmation_recorded_at,
       confirmer.display_name as confirmer_display_name,
       confirmer.employee_code as confirmer_employee_code
  from handovers handover
  join employees submitter on submitter.id = handover.submitted_by_employee_id
  left join handover_confirmations confirmation
    on confirmation.sandbox_id = handover.sandbox_id
   and confirmation.handover_id = handover.id
  left join employees confirmer
    on confirmer.id = confirmation.confirmed_by_employee_id`;

async function readHandoverSnapshot(
  client: PoolClient,
  input: {
    readonly capturedAt: Date;
    readonly sandboxId: string;
    readonly storeId: string;
  },
): Promise<DatabaseHandoverSnapshot> {
  const reservations = await client.query<{
    customer_display_name: string;
    ends_at: Date;
    reservation_id: string;
    seat_code: string;
    starts_at: Date;
    status: DatabaseHandoverSnapshot["reservations"][number]["status"];
  }>(
    `select reservation.id as reservation_id, customer.display_name as customer_display_name,
            seat.code as seat_code, reservation.starts_at, reservation.ends_at,
            reservation.status
       from reservations reservation
       join demo_personas customer on customer.id = reservation.customer_persona_id
       join seats seat on seat.id = reservation.seat_id
      where reservation.sandbox_id = $1 and reservation.store_id = $2
        and reservation.status in ('pending-confirmation', 'confirmed', 'arrived', 'in-use')
      order by reservation.starts_at, reservation.id`,
    [input.sandboxId, input.storeId],
  );
  const orders = await client.query<{
    line_summary: string;
    order_id: string;
    seat_code: string;
    status: DatabaseHandoverSnapshot["orders"][number]["status"];
  }>(
    `select orders.id as order_id, orders.status, seat.code as seat_code,
            concat(
              coalesce(orders.order_snapshot->'lines'->0->>'productName', '柜台商品'),
              case when jsonb_array_length(orders.order_snapshot->'lines') > 1
                then concat(' 等 ', jsonb_array_length(orders.order_snapshot->'lines'), ' 项')
                else '' end
            ) as line_summary
       from customer_orders orders
       join reservations reservation on reservation.id = orders.reservation_id
       join seats seat on seat.id = reservation.seat_id
      where orders.sandbox_id = $1 and orders.store_id = $2
        and orders.status in ('pending-simulated-payment', 'simulated-paid', 'preparing', 'ready-for-pickup')
      order by orders.created_business_at, orders.id`,
    [input.sandboxId, input.storeId],
  );
  const repairs = await client.query<{
    description: string;
    priority: DatabaseRepairCreated["priority"];
    repair_id: string;
    seat_code: string;
    status: DatabaseHandoverSnapshot["repairs"][number]["status"];
  }>(
    `select repair.id as repair_id, repair.description, repair.priority,
            repair.status, seat.code as seat_code
       from repairs repair
       join seats seat on seat.id = repair.seat_id
      where repair.sandbox_id = $1 and repair.store_id = $2
        and repair.status <> 'closed'
      order by repair.created_business_at, repair.id`,
    [input.sandboxId, input.storeId],
  );
  const lowStockAlerts = await client.query<{
    available_quantity: number;
    display_name: string;
    inventory_item_id: string;
    low_stock_threshold: number;
    on_hand_quantity: number;
    reserved_quantity: number;
  }>(
    `select id as inventory_item_id, display_name, on_hand_quantity,
            reserved_quantity, on_hand_quantity - reserved_quantity as available_quantity,
            low_stock_threshold
       from inventory_items
      where sandbox_id = $1 and store_id = $2
        and on_hand_quantity - reserved_quantity <= low_stock_threshold
      order by display_name, id`,
    [input.sandboxId, input.storeId],
  );

  return {
    capturedAt: input.capturedAt,
    lowStockAlerts: lowStockAlerts.rows.map((row) => ({
      availableQuantity: row.available_quantity,
      displayName: row.display_name,
      inventoryItemId: row.inventory_item_id,
      lowStockThreshold: row.low_stock_threshold,
      onHandQuantity: row.on_hand_quantity,
      reservedQuantity: row.reserved_quantity,
    })),
    orders: orders.rows.map((row) => ({
      lineSummary: row.line_summary,
      orderId: row.order_id,
      seatCode: row.seat_code,
      status: row.status,
    })),
    repairs: repairs.rows.map((row) => ({
      description: row.description,
      priority: row.priority,
      repairId: row.repair_id,
      seatCode: row.seat_code,
      status: row.status,
    })),
    reservations: reservations.rows.map((row) => ({
      customerDisplayName: row.customer_display_name,
      endsAt: row.ends_at,
      reservationId: row.reservation_id,
      seatCode: row.seat_code,
      startsAt: row.starts_at,
      status: row.status,
    })),
  };
}

interface DueHandoverExceptionRow {
  confirmed_at: Date | null;
  employee_id: string;
  existing_kinds: HandoverExceptionKind[];
  handover_id: string | null;
  persona_id: string | null;
  role: FrontlineRole;
  shift_id: string;
  starts_at: Date;
  ends_at: Date;
  store_id: string;
  submitted_at: Date | null;
}

async function readDueHandoverExceptionRows(
  client: PoolClient,
  input: {
    readonly sandboxId: string;
    readonly targetBusinessTime: Date;
  },
) {
  return client.query<DueHandoverExceptionRow>(
    `select shift.id as shift_id, shift.store_id, shift.employee_id,
            shift.starts_at, shift.ends_at, employee.persona_id, employee.role,
            handover.id as handover_id,
            handover.submitted_business_at as submitted_at,
            confirmation.business_occurred_at as confirmed_at,
            coalesce(array_agg(exception.kind) filter (where exception.kind is not null), '{}') as existing_kinds
       from shifts shift
       join employees employee on employee.id = shift.employee_id
       join attendance_records attendance
         on attendance.sandbox_id = shift.sandbox_id
        and attendance.shift_id = shift.id
        and attendance.status in ('checked-in', 'checked-out')
       left join handovers handover
         on handover.sandbox_id = shift.sandbox_id
        and handover.shift_id = shift.id
       left join handover_confirmations confirmation
         on confirmation.sandbox_id = handover.sandbox_id
        and confirmation.handover_id = handover.id
       left join handover_exceptions exception
         on exception.sandbox_id = shift.sandbox_id
        and exception.shift_id = shift.id
      where shift.sandbox_id = $1 and shift.status = 'scheduled'
        and shift.ends_at + interval '30 minutes' <= $2
      group by shift.id, shift.store_id, shift.employee_id, shift.starts_at,
               shift.ends_at, employee.persona_id, employee.role,
               handover.id, handover.submitted_business_at,
               confirmation.business_occurred_at
      order by shift.ends_at, shift.id`,
    [input.sandboxId, input.targetBusinessTime],
  );
}

function pendingHandoverExceptionKinds(
  row: DueHandoverExceptionRow,
  currentTime: Date,
) {
  const existing = new Set(row.existing_kinds);
  return classifyHandoverExceptions({
    confirmedAt: row.confirmed_at,
    currentTime,
    shiftEndsAt: row.ends_at,
    submittedAt: row.submitted_at,
  }).filter((kind) => !existing.has(kind));
}

async function processDueHandoverExceptions(
  client: PoolClient,
  input: {
    readonly recordedAt: Date;
    readonly sandboxId: string;
    readonly targetBusinessTime: Date;
  },
): Promise<number> {
  const due = await readDueHandoverExceptionRows(client, input);
  let processed = 0;
  for (const row of due.rows) {
    for (const kind of pendingHandoverExceptionKinds(
      row,
      input.targetBusinessTime,
    )) {
      const occurredAt =
        kind === "late-submission" && row.submitted_at
          ? row.submitted_at
          : new Date(row.ends_at.getTime() + HANDOVER_EXCEPTION_GRACE_MS);
      const inserted = await client.query<{ id: string }>(
        `insert into handover_exceptions (
           id, sandbox_id, store_id, shift_id, handover_id, kind,
           business_occurred_at, recorded_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (sandbox_id, shift_id, kind) do nothing
         returning id`,
        [
          randomUUID(),
          input.sandboxId,
          row.store_id,
          row.shift_id,
          row.handover_id,
          kind,
          occurredAt,
          input.recordedAt,
        ],
      );
      if (!inserted.rows[0]) continue;
      await client.query(
        `insert into audit_events (
           id, sandbox_id, store_id, persona_id, role, action, object_type,
           object_id, result, reason, request_id, before_data, after_data,
           business_occurred_at, recorded_at
         ) values ($1, $2, $3, $4, $5, 'handover.exception', 'handover',
           $6, 'allowed', $7, $8, null, $9::jsonb, $10, $11)`,
        [
          randomUUID(),
          input.sandboxId,
          row.store_id,
          row.persona_id,
          row.role,
          row.handover_id ?? row.shift_id,
          kind,
          randomUUID(),
          JSON.stringify({ kind, shiftId: row.shift_id }),
          occurredAt,
          input.recordedAt,
        ],
      );
      processed += 1;
    }
  }
  return processed;
}

async function recordHandoverCommandDenial(
  client: PoolClient,
  input: {
    readonly action: "handover.confirm" | "handover.submit";
    readonly businessTime: Date;
    readonly objectId: string;
    readonly personaId: string;
    readonly reason: string;
    readonly recordedAt: Date;
    readonly requestId: string;
    readonly role: FrontlineRole;
    readonly sandboxId: string;
    readonly storeId: string;
  },
) {
  await client.query(
    `insert into audit_events (
       id, sandbox_id, store_id, persona_id, role, action, object_type,
       object_id, result, reason, request_id, before_data, after_data,
       business_occurred_at, recorded_at
     ) values ($1, $2, $3, $4, $5, $6, 'handover', $7, 'denied',
       $8, $9, null, null, $10, $11)`,
    [
      randomUUID(),
      input.sandboxId,
      input.storeId,
      input.personaId,
      input.role,
      input.action,
      input.objectId,
      input.reason,
      input.requestId,
      input.businessTime,
      input.recordedAt,
    ],
  );
}

function handoverDueHandlers(): DemoTimeDueHandlerRegistry {
  return {
    "handover-exception": {
      nextDueAt: async (context) => {
        const result = await context.client.query<{ due_at: Date | null }>(
          `select min(shift.ends_at + interval '30 minutes') as due_at
             from shifts shift
             join attendance_records attendance
               on attendance.sandbox_id = shift.sandbox_id
              and attendance.shift_id = shift.id
              and attendance.status in ('checked-in', 'checked-out')
             left join handovers handover
               on handover.sandbox_id = shift.sandbox_id
              and handover.shift_id = shift.id
             left join handover_confirmations confirmation
               on confirmation.sandbox_id = handover.sandbox_id
              and confirmation.handover_id = handover.id
            where shift.sandbox_id = $1 and shift.status = 'scheduled'
              and shift.ends_at + interval '30 minutes' > $2
              and (handover.id is null or confirmation.id is null)`,
          [context.sandboxId, context.currentBusinessTime],
        );
        return result.rows[0]?.due_at ?? null;
      },
      previewDue: async (context) => {
        const rows = await readDueHandoverExceptionRows(context.client, {
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        });
        return rows.rows.reduce(
          (count, row) =>
            count +
            pendingHandoverExceptionKinds(row, context.targetBusinessTime)
              .length,
          0,
        );
      },
      processDue: (context) =>
        processDueHandoverExceptions(context.client, {
          recordedAt: context.recordedAt,
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        }),
    },
  };
}

function attendanceDueHandlers(): DemoTimeDueHandlerRegistry {
  return {
    "attendance-absence": {
      nextDueAt: async (context) => {
        const result = await context.client.query<{ due_at: Date | null }>(
          `select min(shift.ends_at) as due_at
             from shifts shift
             left join attendance_records attendance
               on attendance.sandbox_id = shift.sandbox_id
              and attendance.shift_id = shift.id
            where shift.sandbox_id = $1 and shift.status = 'scheduled'
              and shift.ends_at > $2 and attendance.id is null`,
          [context.sandboxId, context.currentBusinessTime],
        );
        return result.rows[0]?.due_at ?? null;
      },
      previewDue: async (context) => {
        const result = await context.client.query<{ count: string }>(
          `select count(*)::text as count
             from shifts shift
            left join attendance_records attendance
               on attendance.sandbox_id = shift.sandbox_id
              and attendance.shift_id = shift.id
            where shift.sandbox_id = $1 and shift.status = 'scheduled'
              and shift.ends_at <= $2
              and attendance.id is null`,
          [context.sandboxId, context.targetBusinessTime],
        );
        return Number(result.rows[0]?.count ?? 0);
      },
      processDue: (context) =>
        processDueAttendanceAbsences(context.client, {
          recordedAt: context.recordedAt,
          sandboxId: context.sandboxId,
          targetBusinessTime: context.targetBusinessTime,
        }),
    },
  };
}

function staffShiftFromRows(
  row: ShiftAttendanceRow,
  facts: ReadonlyArray<AttendanceEventRow>,
  currentTime: Date,
): DatabaseStaffShift {
  const signInOpensAt = new Date(row.starts_at.getTime() - 30 * 60 * 1_000);
  const attendance = row.attendance_status
    ? {
        absence:
          row.absence_business_at && row.absence_recorded_at
            ? {
                businessOccurredAt: row.absence_business_at,
                recordedAt: row.absence_recorded_at,
              }
            : null,
        checkIn:
          row.check_in_business_at &&
          row.check_in_recorded_at &&
          row.check_in_outcome
            ? {
                businessOccurredAt: row.check_in_business_at,
                outcome: row.check_in_outcome,
                recordedAt: row.check_in_recorded_at,
                source: "simulated" as const,
              }
            : null,
        checkOut:
          row.check_out_business_at && row.check_out_recorded_at
            ? {
                businessOccurredAt: row.check_out_business_at,
                recordedAt: row.check_out_recorded_at,
                source: "manual" as const,
              }
            : null,
        status: row.attendance_status,
      }
    : null;
  const nextAction =
    row.attendance_status === "checked-in"
      ? ({ kind: "manual-check-out", label: "手动签退" } as const)
      : row.attendance_status === null &&
          currentTime.getTime() >= signInOpensAt.getTime() &&
          currentTime.getTime() < row.ends_at.getTime()
        ? ({ kind: "simulated-check-in", label: "模拟签到" } as const)
        : null;
  return {
    attendance,
    canManageSchedule:
      row.attendance_status === null &&
      row.starts_at.getTime() > currentTime.getTime(),
    facts: facts
      .filter((fact) => fact.shift_id === row.shift_id)
      .map((fact) => ({
        businessOccurredAt: fact.business_occurred_at,
        data: fact.event_data,
        recordedAt: fact.recorded_at,
        type: fact.event_type,
      })),
    nextAction,
    shiftId: row.shift_id,
    signInWindow: { closesAt: row.ends_at, opensAt: signInOpensAt },
    window: { endsAt: row.ends_at, startsAt: row.starts_at },
  };
}

async function assertRepairActorContext(
  client: PoolClient,
  input: ReadRoleContextInput,
  wallTime: Date,
) {
  const sandbox = await client.query<SandboxRow>(
    `select ${SANDBOX_ROW_COLUMNS} from sandboxes where id = $1`,
    [input.sandboxId],
  );
  const sandboxRow = sandbox.rows[0];
  assertSandboxAvailable(sandboxRow, wallTime);
  if (
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
  const personaRow = persona.rows[0];
  if (!personaRow) throw new RoleContextUnavailableError();
  return { sandbox: sandboxRow, storeId: personaRow.store_id };
}

function canAccessRepair(
  repair: RepairAuthorizationRow,
  input: ReadRoleContextInput,
  actorStoreId: string | null,
  access: "read" | "upload",
) {
  if (input.role === "customer") {
    return repair.customer_persona_id === input.personaId;
  }
  if (input.role === "staff") return repair.store_id === actorStoreId;
  if (access === "read" && input.role === "manager") {
    return repair.store_id === actorStoreId;
  }
  return access === "read" && input.role === "hq";
}

async function readAuthorizedRepair(
  client: PoolClient,
  input: RepairActorContextInput,
  wallTime: Date,
  access: "read" | "upload",
) {
  const actor = await assertRepairActorContext(client, input, wallTime);
  const repair = await client.query<RepairAuthorizationRow>(
    `select id as repair_id, store_id, customer_persona_id
       from repairs where sandbox_id = $1 and id = $2`,
    [input.sandboxId, input.repairId],
  );
  const row = repair.rows[0];
  if (!row || !canAccessRepair(row, input, actor.storeId, access)) {
    throw new RepairImageConflictError("not-found");
  }
  return { actor, repair: row };
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
  const relatedRepairs = await readRelatedRepairs(
    client,
    row.sandbox_id,
    row.id,
  );
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
    related: { orders: relatedOrders, repairs: relatedRepairs },
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

async function recordRepairCommandDenial(
  client: PoolClient,
  input: {
    readonly action:
      | "assign"
      | "spare-claim"
      | "spare-return"
      | "start"
      | "submit-resolution"
      | "verify-failure"
      | "verify-success";
    readonly actorStoreId: string;
    readonly businessTime: Date;
    readonly currentStatus: string | null;
    readonly personaId: string;
    readonly reason: RepairCommandConflictReason;
    readonly recordedAt: Date;
    readonly repairId: string;
    readonly requestId: string;
    readonly role: FrontlineRole;
    readonly sandboxId: string;
  },
) {
  await client.query(
    `insert into audit_events (
       id, sandbox_id, store_id, persona_id, role, action, object_type,
       object_id, result, reason, request_id, before_data, after_data,
       business_occurred_at, recorded_at
     ) values ($1, $2, $3, $4, $5, $6, 'repair', $7, 'denied',
       $8, $9, $10::jsonb, $11::jsonb, $12, $13)`,
    [
      randomUUID(),
      input.sandboxId,
      input.actorStoreId,
      input.personaId,
      input.role,
      `repair.${input.action}`,
      input.repairId,
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

async function recordManagerInventoryDenial(
  client: PoolClient,
  input: {
    readonly action: "compensation" | "receipt" | "stocktake";
    readonly actorStoreId: string;
    readonly businessTime: Date;
    readonly inventoryItemId: string;
    readonly onHandQuantity: number | null;
    readonly personaId: string;
    readonly reason: ManagerInventoryConflictReason;
    readonly recordedAt: Date;
    readonly requestId: string;
    readonly reservedQuantity: number | null;
    readonly sandboxId: string;
  },
) {
  const balance = {
    onHandQuantity: input.onHandQuantity,
    reservedQuantity: input.reservedQuantity,
  };
  await client.query(
    `insert into audit_events (
       id, sandbox_id, store_id, persona_id, role, action, object_type,
       object_id, result, reason, request_id, before_data, after_data,
       business_occurred_at, recorded_at
     ) values ($1, $2, $3, $4, 'manager', $5, 'inventory_item', $6,
       'denied', $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
    [
      randomUUID(),
      input.sandboxId,
      input.actorStoreId,
      input.personaId,
      `inventory.${input.action}`,
      input.inventoryItemId,
      input.reason,
      input.requestId,
      JSON.stringify(balance),
      JSON.stringify(balance),
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

function managerInventoryCommandFromStored(
  value: ManagerInventoryCommandRow["result_data"],
  replayed: boolean,
): DatabaseManagerInventoryCommand {
  return {
    ...value,
    businessOccurredAt: new Date(value.businessOccurredAt),
    replayed,
  };
}

function inventoryMovementFromRow(
  movement: InventoryMovementRow,
): DatabaseInventoryMovement {
  return {
    businessOccurredAt: movement.business_occurred_at,
    inventoryItemId: movement.inventory_item_id,
    inventoryItemName: movement.inventory_item_name,
    kind: movement.movement_kind,
    movementId: movement.movement_id,
    onHandAfter: movement.on_hand_after,
    onHandDelta: movement.on_hand_delta,
    orderId: movement.order_id,
    originalMovementId: movement.original_movement_id,
    reason: movement.reason,
  };
}

function buildRoleContext(
  sandbox: SandboxRow,
  persona: PersonaRow,
  stores: ReadonlyArray<StoreRow>,
  wallTime: Date,
): DatabaseRoleContext {
  const scopedStores =
    persona.role === "customer"
      ? stores
      : persona.role === "hq"
        ? stores.filter((store) =>
            HEADQUARTERS_FIXED_STORE_CODES.some((code) => code === store.code),
          )
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
  if (
    !sandboxRow ||
    sandboxRow.invalidated_at !== null ||
    sandboxRow.expires_at.getTime() <= wallTime.getTime()
  ) {
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
       from demo_personas
      where sandbox_id = $1 and role = any($2::text[]) and protected = true`,
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
       id, schema_version, seed_version, created_at, expires_at, role_context_role,
       business_time_anchor_at, business_time_anchor_wall_at
     ) values ($1, $2, $3, $6, $4, $5, $6, $6)`,
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
    `insert into sandbox_lifecycle_tasks (
       sandbox_id, expires_at, state, available_at, created_at, updated_at
     ) values ($1, $2, 'active', $3, $3, $3)`,
    [input.sandboxId, input.expiresAt, input.wallTime],
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
       opens_at, closes_at, closes_next_day, is_open_24_hours,
       fictitious_city, introduction
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[],
       $6::integer[], $7::time[], $8::time[], $9::boolean[], $10::boolean[],
       $11::text[], $12::text[]
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
      seededStores.map((store) => store.fictitiousCity),
      seededStores.map((store) => store.introduction),
    ],
  );

  const seededPersonas = personaSeeds.map((persona) => ({
    ...persona,
    id: randomUUID(),
    storeId: persona.storeCode
      ? (storeIds.get(persona.storeCode) ?? null)
      : null,
  }));
  const seededBackgroundPersonas = employeeSeeds
    .filter((employee) => !employee.protected)
    .map((employee) => ({
      displayName: employee.displayName,
      employeeCode: employee.employeeCode,
      id: randomUUID(),
      protected: false,
      role: employee.role,
      scope: `${employee.storeCode} · 背景员工`,
      storeId: storeIds.get(employee.storeCode) ?? null,
    }));
  const allSeededPersonas = [...seededPersonas, ...seededBackgroundPersonas];
  await input.client.query(
    `insert into demo_personas (
       id, sandbox_id, store_id, role, display_name, scope, protected
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[],
       $5::text[], $6::text[], $7::boolean[]
     )`,
    [
      allSeededPersonas.map((persona) => persona.id),
      allSeededPersonas.map(() => input.sandboxId),
      allSeededPersonas.map((persona) => persona.storeId),
      allSeededPersonas.map((persona) => persona.role),
      allSeededPersonas.map((persona) => persona.displayName),
      allSeededPersonas.map((persona) => persona.scope),
      allSeededPersonas.map((persona) => persona.protected),
    ],
  );

  const seededEmployees = employeeSeeds.map((employee) => {
    const persona = employee.protected
      ? seededPersonas.find(
          (candidate) =>
            candidate.displayName === employee.displayName &&
            candidate.role === employee.role &&
            candidate.storeId === storeIds.get(employee.storeCode),
        )
      : seededBackgroundPersonas.find(
          (candidate) => candidate.employeeCode === employee.employeeCode,
        );
    const storeId = storeIds.get(employee.storeCode);
    if (!persona || !storeId) {
      throw new Error("The deterministic employee persona is incomplete.");
    }
    return {
      ...employee,
      id: randomUUID(),
      personaId: persona.id,
      storeId,
    };
  });
  await input.client.query(
    `insert into employees (
       id, sandbox_id, store_id, persona_id, employee_code,
       display_name, role, active, protected
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[],
       $6::text[], $7::text[], $8::boolean[], $9::boolean[]
     )`,
    [
      seededEmployees.map((employee) => employee.id),
      seededEmployees.map(() => input.sandboxId),
      seededEmployees.map((employee) => employee.storeId),
      seededEmployees.map((employee) => employee.personaId),
      seededEmployees.map((employee) => employee.employeeCode),
      seededEmployees.map((employee) => employee.displayName),
      seededEmployees.map((employee) => employee.role),
      seededEmployees.map(() => true),
      seededEmployees.map((employee) => employee.protected),
    ],
  );
  const halfHourMilliseconds = 30 * 60 * 1_000;
  const currentShiftStartsAt = new Date(
    Math.ceil(input.wallTime.getTime() / halfHourMilliseconds) *
      halfHourMilliseconds,
  );
  const seededShifts = seededEmployees.flatMap((employee) =>
    (employee.protected ? [0, 24, 48] : [24, 48, 72]).map((offsetHours) => {
      const startsAt = new Date(
        currentShiftStartsAt.getTime() + offsetHours * 60 * 60 * 1_000,
      );
      return {
        employeeId: employee.id,
        endsAt: new Date(startsAt.getTime() + 8 * 60 * 60 * 1_000),
        id: randomUUID(),
        startsAt,
        storeId: employee.storeId,
      };
    }),
  );
  await input.client.query(
    `insert into shifts (
       id, sandbox_id, store_id, employee_id, starts_at, ends_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[],
       $5::timestamptz[], $6::timestamptz[]
     )`,
    [
      seededShifts.map((shift) => shift.id),
      seededShifts.map(() => input.sandboxId),
      seededShifts.map((shift) => shift.storeId),
      seededShifts.map((shift) => shift.employeeId),
      seededShifts.map((shift) => shift.startsAt),
      seededShifts.map((shift) => shift.endsAt),
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
      .flatMap((profile) => {
        const baseHourlyCents = store.baseHourlyCents[profile.code];
        const weekendHalfHourCents = legacyHalfHourCents(
          baseHourlyCents,
          11_500,
        );
        return [
          {
            endsAt: "18:00",
            endsNextDay: false,
            startsAt: "06:00",
            weekdayHalfHourCents: legacyHalfHourCents(baseHourlyCents, 10_000),
          },
          {
            endsAt: "00:00",
            endsNextDay: true,
            startsAt: "18:00",
            weekdayHalfHourCents: legacyHalfHourCents(baseHourlyCents, 12_000),
          },
          {
            endsAt: "06:00",
            endsNextDay: false,
            startsAt: "00:00",
            weekdayHalfHourCents: legacyHalfHourCents(baseHourlyCents, 9_000),
          },
        ].map((window) => ({
          ...window,
          areaId: area.id,
          baseHourlyCents,
          id: randomUUID(),
          machineProfileId: machineProfileIds.get(profile.code),
          storeId: store.id,
          weekendHalfHourCents,
        }));
      });
  });
  await input.client.query(
    `insert into price_plans (
       id, sandbox_id, store_id, area_id, machine_profile_id, version,
       base_hourly_cents, weekday_half_hour_cents, weekend_half_hour_cents,
       starts_at, ends_at, ends_next_day, pricing_model, effective_from, status
     )
     select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::integer[], $7::integer[], $8::integer[], $9::integer[],
       $10::time[], $11::time[], $12::boolean[], $13::text[],
       $14::timestamptz[], $15::text[]
     )`,
    [
      seededPricePlans.map((plan) => plan.id),
      seededPricePlans.map(() => input.sandboxId),
      seededPricePlans.map((plan) => plan.storeId),
      seededPricePlans.map((plan) => plan.areaId),
      seededPricePlans.map((plan) => plan.machineProfileId),
      seededPricePlans.map(() => 1),
      seededPricePlans.map((plan) => plan.baseHourlyCents),
      seededPricePlans.map((plan) => plan.weekdayHalfHourCents),
      seededPricePlans.map((plan) => plan.weekendHalfHourCents),
      seededPricePlans.map((plan) => plan.startsAt),
      seededPricePlans.map((plan) => plan.endsAt),
      seededPricePlans.map((plan) => plan.endsNextDay),
      seededPricePlans.map(() => "explicit-half-hour"),
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
  const seededProductScopes = seededProducts.flatMap((product) =>
    productAvailableStoreCodes[product.code].map((storeCode) => {
      const store = seededStores.find(
        (candidate) => candidate.code === storeCode,
      );
      if (!store) {
        throw new Error(
          "The product scope references an unknown seeded store.",
        );
      }
      return { productId: product.id, storeId: store.id };
    }),
  );
  await input.client.query(
    `insert into product_store_scopes (sandbox_id, product_id, store_id)
     select * from unnest($1::uuid[], $2::uuid[], $3::uuid[])`,
    [
      seededProductScopes.map(() => input.sandboxId),
      seededProductScopes.map((scope) => scope.productId),
      seededProductScopes.map((scope) => scope.storeId),
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
      { code: "spare-keyboard", displayName: "维修键盘", quantity: 7 },
      { code: "spare-mouse", displayName: "维修鼠标", quantity: 1 },
      {
        code: "spare-headset",
        displayName: "无品牌替换耳机",
        quantity: 2,
      },
      { code: "spare-display-cable", displayName: "显示线", quantity: 6 },
      { code: "spare-network-cable", displayName: "网线", quantity: 8 },
      { code: "spare-power-unit", displayName: "电源", quantity: 4 },
      { code: "spare-cooling-fan", displayName: "散热风扇", quantity: 5 },
      { code: "spare-memory", displayName: "内存", quantity: 3 },
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

  const dashboardDays = managerDashboardBusinessDays(input.wallTime);
  const dashboardProduct = seededProductInventory.find(
    (item) => item.storeId === flagshipStore.id && item.listed,
  );
  if (!dashboardProduct) {
    throw new Error("The dashboard history product seed is incomplete.");
  }
  const dashboardReservations = dashboardDays.map((day, index) => {
    const seat = seatByKey.get(
      `prism-flagship:A-${String(10 + (index % 8)).padStart(2, "0")}`,
    );
    const customer = staffQueueCustomers[index % staffQueueCustomers.length];
    if (!seat || !customer) {
      throw new Error("The dashboard reservation history seed is incomplete.");
    }
    const area = flagshipAreaById.get(seat.areaId);
    const profile = machineProfileByCode.get(seat.machineProfileCode);
    if (!area || !profile) {
      throw new Error("The dashboard reservation snapshot seed is incomplete.");
    }
    const startsAt = new Date(
      day.startsAt.getTime() +
        (index === dashboardDays.length - 1 ? 4 : 12) * 60 * 60 * 1_000,
    );
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1_000);
    const price = priceReservationWindow({
      baseHourlyCents: flagshipStore.baseHourlyCents[seat.machineProfileCode],
      endsAt,
      startsAt,
    });
    const id = randomUUID();
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
    return { customer, endsAt, id, seat, snapshot, startsAt };
  });
  await input.client.query(
    `insert into reservations (
       id, sandbox_id, store_id, customer_persona_id, seat_id, status,
       starts_at, ends_at, created_business_at, price_snapshot,
       simulated_payment_cents, confirmed_business_at, arrived_business_at,
       started_business_at, completed_business_at, terminal_reason
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::text[], $7::timestamptz[], $8::timestamptz[], $9::timestamptz[],
       $10::jsonb[], $11::integer[], $12::timestamptz[], $13::timestamptz[],
       $14::timestamptz[], $15::timestamptz[], $16::text[]
     )`,
    [
      dashboardReservations.map((reservation) => reservation.id),
      dashboardReservations.map(() => input.sandboxId),
      dashboardReservations.map(() => flagshipStore.id),
      dashboardReservations.map((reservation) => reservation.customer.id),
      dashboardReservations.map((reservation) => reservation.seat.id),
      dashboardReservations.map(() => "completed"),
      dashboardReservations.map((reservation) => reservation.startsAt),
      dashboardReservations.map((reservation) => reservation.endsAt),
      dashboardReservations.map(
        (reservation) =>
          new Date(reservation.startsAt.getTime() - 24 * 60 * 60 * 1_000),
      ),
      dashboardReservations.map((reservation) =>
        JSON.stringify(reservation.snapshot),
      ),
      dashboardReservations.map(
        (reservation) => reservation.snapshot.price.payableCents,
      ),
      dashboardReservations.map(
        (reservation) =>
          new Date(reservation.startsAt.getTime() - 12 * 60 * 60 * 1_000),
      ),
      dashboardReservations.map(
        (reservation) =>
          new Date(reservation.startsAt.getTime() - 5 * 60 * 1_000),
      ),
      dashboardReservations.map((reservation) => reservation.startsAt),
      dashboardReservations.map((reservation) => reservation.endsAt),
      dashboardReservations.map(() => "planned-end-auto-completed"),
    ],
  );
  const dashboardReservationEvents = dashboardReservations.flatMap(
    (reservation) => [
      {
        at: new Date(reservation.startsAt.getTime() - 24 * 60 * 60 * 1_000),
        data: { seeded: true },
        reservationId: reservation.id,
        type: "reservation.pending-created",
      },
      {
        at: new Date(reservation.startsAt.getTime() - 12 * 60 * 60 * 1_000),
        data: {
          simulatedPaymentCents: reservation.snapshot.price.payableCents,
        },
        reservationId: reservation.id,
        type: "reservation.simulated-payment-succeeded",
      },
      {
        at: new Date(reservation.startsAt.getTime() - 5 * 60 * 1_000),
        data: { seeded: true },
        reservationId: reservation.id,
        type: "reservation.arrived",
      },
      {
        at: reservation.startsAt,
        data: { seeded: true },
        reservationId: reservation.id,
        type: "reservation.started",
      },
      {
        at: reservation.endsAt,
        data: { reason: "planned-end", seeded: true },
        reservationId: reservation.id,
        type: "reservation.auto-completed",
      },
    ],
  );
  await input.client.query(
    `insert into reservation_business_events (
       id, sandbox_id, reservation_id, event_type, event_data,
       business_occurred_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::jsonb[],
       $6::timestamptz[]
     )`,
    [
      dashboardReservationEvents.map(() => randomUUID()),
      dashboardReservationEvents.map(() => input.sandboxId),
      dashboardReservationEvents.map((event) => event.reservationId),
      dashboardReservationEvents.map((event) => event.type),
      dashboardReservationEvents.map((event) => JSON.stringify(event.data)),
      dashboardReservationEvents.map((event) => event.at),
    ],
  );

  const dashboardOrders = dashboardReservations.map((reservation, index) => {
    const createdAt = new Date(reservation.startsAt.getTime() + 5 * 60_000);
    const paidAt = new Date(createdAt.getTime() + 60_000);
    const preparingAt = new Date(paidAt.getTime() + 2 * 60_000);
    const readyAt = new Date(preparingAt.getTime() + 8 * 60_000);
    const completedAt = new Date(readyAt.getTime() + 5 * 60_000);
    const id = randomUUID();
    const snapshot: CustomerOrderSnapshot = {
      coupon: null,
      discountCents: 0,
      lines: [
        {
          lineTotalCents: dashboardProduct.unitPriceCents,
          productId: dashboardProduct.productId,
          productName: dashboardProduct.displayName,
          quantity: 1,
          unitPriceCents: dashboardProduct.unitPriceCents,
        },
      ],
      payableCents: dashboardProduct.unitPriceCents,
      reservation: {
        reservationId: reservation.id,
        seatCode: reservation.seat.code,
        storeCode: flagshipStore.code,
        storeDisplayName: flagshipStore.displayName,
      },
      subtotalCents: dashboardProduct.unitPriceCents,
    };
    return {
      completedAt,
      createdAt,
      id,
      index,
      paidAt,
      preparingAt,
      readyAt,
      reservation,
      snapshot,
    };
  });
  await input.client.query(
    `update inventory_items set on_hand_quantity = on_hand_quantity + $3
      where sandbox_id = $1 and id = $2`,
    [input.sandboxId, dashboardProduct.id, dashboardOrders.length],
  );
  await input.client.query(
    `insert into customer_orders (
       id, sandbox_id, store_id, customer_persona_id, reservation_id, seat_id,
       status, hold_expires_at, created_business_at, order_snapshot,
       simulated_payment_cents, paid_business_at, preparing_business_at,
       ready_business_at, completed_business_at, terminal_reason
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::uuid[], $7::text[], $8::timestamptz[], $9::timestamptz[],
       $10::jsonb[], $11::integer[], $12::timestamptz[], $13::timestamptz[],
       $14::timestamptz[], $15::timestamptz[], $16::text[]
     )`,
    [
      dashboardOrders.map((order) => order.id),
      dashboardOrders.map(() => input.sandboxId),
      dashboardOrders.map(() => flagshipStore.id),
      dashboardOrders.map((order) => order.reservation.customer.id),
      dashboardOrders.map((order) => order.reservation.id),
      dashboardOrders.map((order) => order.reservation.seat.id),
      dashboardOrders.map(() => "completed"),
      dashboardOrders.map(
        (order) => new Date(order.createdAt.getTime() + 10 * 60_000),
      ),
      dashboardOrders.map((order) => order.createdAt),
      dashboardOrders.map((order) => JSON.stringify(order.snapshot)),
      dashboardOrders.map((order) => order.snapshot.payableCents),
      dashboardOrders.map((order) => order.paidAt),
      dashboardOrders.map((order) => order.preparingAt),
      dashboardOrders.map((order) => order.readyAt),
      dashboardOrders.map((order) => order.completedAt),
      dashboardOrders.map(() => "fulfilled"),
    ],
  );
  await input.client.query(
    `insert into order_inventory_reservations (
       id, sandbox_id, order_id, inventory_item_id, quantity, status,
       released_business_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::integer[],
       $6::text[], $7::timestamptz[]
     )`,
    [
      dashboardOrders.map(() => randomUUID()),
      dashboardOrders.map(() => input.sandboxId),
      dashboardOrders.map((order) => order.id),
      dashboardOrders.map(() => dashboardProduct.id),
      dashboardOrders.map(() => 1),
      dashboardOrders.map(() => "sold"),
      dashboardOrders.map((order) => order.completedAt),
    ],
  );
  await input.client.query(
    `insert into inventory_movements (
       id, sandbox_id, store_id, inventory_item_id, order_id, movement_kind,
       reason, on_hand_delta, on_hand_after, business_occurred_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::text[], $7::text[], $8::integer[], $9::integer[],
       $10::timestamptz[]
     )`,
    [
      dashboardOrders.map(() => randomUUID()),
      dashboardOrders.map(() => input.sandboxId),
      dashboardOrders.map(() => flagshipStore.id),
      dashboardOrders.map(() => dashboardProduct.id),
      dashboardOrders.map((order) => order.id),
      dashboardOrders.map(() => "sale"),
      dashboardOrders.map(() => "order-completed"),
      dashboardOrders.map(() => -1),
      dashboardOrders.map(
        (order) =>
          dashboardProduct.onHandQuantity +
          dashboardOrders.length -
          order.index -
          1,
      ),
      dashboardOrders.map((order) => order.completedAt),
    ],
  );
  await input.client.query(
    `update inventory_items set on_hand_quantity = on_hand_quantity - $3
      where sandbox_id = $1 and id = $2`,
    [input.sandboxId, dashboardProduct.id, dashboardOrders.length],
  );
  const dashboardOrderEvents = dashboardOrders.flatMap((order) => [
    {
      at: order.createdAt,
      data: { seeded: true },
      orderId: order.id,
      type: "order.pending-created",
    },
    {
      at: order.paidAt,
      data: { simulatedPaymentCents: order.snapshot.payableCents },
      orderId: order.id,
      type: "order.simulated-payment-succeeded",
    },
    {
      at: order.preparingAt,
      data: { seeded: true },
      orderId: order.id,
      type: "order.preparing",
    },
    {
      at: order.readyAt,
      data: { seeded: true },
      orderId: order.id,
      type: "order.ready-for-pickup",
    },
    {
      at: order.completedAt,
      data: { seeded: true },
      orderId: order.id,
      type: "order.completed",
    },
  ]);
  await input.client.query(
    `insert into order_business_events (
       id, sandbox_id, order_id, event_type, event_data, business_occurred_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::jsonb[],
       $6::timestamptz[]
     )`,
    [
      dashboardOrderEvents.map(() => randomUUID()),
      dashboardOrderEvents.map(() => input.sandboxId),
      dashboardOrderEvents.map((event) => event.orderId),
      dashboardOrderEvents.map((event) => event.type),
      dashboardOrderEvents.map((event) => JSON.stringify(event.data)),
      dashboardOrderEvents.map((event) => event.at),
    ],
  );

  for (const reservation of dashboardReservations) {
    const profile = seededMemberProfiles.find(
      (item) => item.customerPersonaId === reservation.customer.id,
    );
    const order = dashboardOrders.find(
      (item) => item.reservation.id === reservation.id,
    );
    if (!profile || !order) {
      throw new Error("The dashboard growth history seed is incomplete.");
    }
    const reservationGrowth = Math.floor(
      reservation.snapshot.price.payableCents / 100,
    );
    const orderGrowth = Math.floor(order.snapshot.payableCents / 100);
    await input.client.query(
      `insert into member_growth_events (
         id, sandbox_id, member_profile_id, customer_persona_id, source_kind,
         source_id, final_simulated_amount_cents, growth_points,
         business_occurred_at
       ) values
         ($1, $2, $3, $4, 'reservation', $5, $6, $7, $8),
         ($9, $2, $3, $4, 'order', $10, $11, $12, $13)`,
      [
        randomUUID(),
        input.sandboxId,
        profile.id,
        reservation.customer.id,
        reservation.id,
        reservation.snapshot.price.payableCents,
        reservationGrowth,
        reservation.endsAt,
        randomUUID(),
        order.id,
        order.snapshot.payableCents,
        orderGrowth,
        order.completedAt,
      ],
    );
    await input.client.query(
      `update member_profiles set growth_points = growth_points + $3
        where sandbox_id = $1 and id = $2`,
      [input.sandboxId, profile.id, reservationGrowth + orderGrowth],
    );
  }

  const dashboardStaff = seededEmployees.filter(
    (employee) =>
      employee.storeId === flagshipStore.id && employee.role === "staff",
  );
  const dashboardManager = seededEmployees.find(
    (employee) =>
      employee.storeId === flagshipStore.id && employee.role === "manager",
  );
  if (dashboardStaff.length === 0 || !dashboardManager) {
    throw new Error("The dashboard workforce history seed is incomplete.");
  }
  const dashboardShifts = dashboardDays.map((day, index) => {
    const employee = dashboardStaff[index % dashboardStaff.length];
    if (!employee) {
      throw new Error("The dashboard shift history seed is incomplete.");
    }
    const isCurrentBusinessDay = index === dashboardDays.length - 1;
    const startsAt = new Date(
      day.startsAt.getTime() + (isCurrentBusinessDay ? 2 : 4) * 60 * 60 * 1_000,
    );
    const endsAt = new Date(
      startsAt.getTime() + (isCurrentBusinessDay ? 4 : 8) * 60 * 60 * 1_000,
    );
    const outcome = (["on-time", "late", "absent"] as const)[index % 3]!;
    return {
      employee,
      endsAt,
      id: randomUUID(),
      outcome,
      startsAt,
    };
  });
  await input.client.query(
    `insert into shifts (
       id, sandbox_id, store_id, employee_id, starts_at, ends_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[],
       $5::timestamptz[], $6::timestamptz[]
     )`,
    [
      dashboardShifts.map((shift) => shift.id),
      dashboardShifts.map(() => input.sandboxId),
      dashboardShifts.map(() => flagshipStore.id),
      dashboardShifts.map((shift) => shift.employee.id),
      dashboardShifts.map((shift) => shift.startsAt),
      dashboardShifts.map((shift) => shift.endsAt),
    ],
  );
  const dashboardAttendance = dashboardShifts.map((shift) => {
    const absent = shift.outcome === "absent";
    const checkInAt = absent
      ? null
      : new Date(
          shift.startsAt.getTime() +
            (shift.outcome === "late" ? 10 * 60 * 1_000 : 0),
        );
    return {
      absentAt: absent ? shift.endsAt : null,
      checkInAt,
      checkOutAt: absent
        ? null
        : new Date(shift.endsAt.getTime() - 5 * 60 * 1_000),
      id: randomUUID(),
      shift,
      status: absent ? ("absent" as const) : ("checked-out" as const),
    };
  });
  await input.client.query(
    `insert into attendance_records (
       id, sandbox_id, store_id, employee_id, shift_id, status,
       check_in_outcome, check_in_business_at, check_in_recorded_at,
       check_out_business_at, check_out_recorded_at,
       absence_business_at, absence_recorded_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::text[], $7::text[], $8::timestamptz[], $9::timestamptz[],
       $10::timestamptz[], $11::timestamptz[], $12::timestamptz[],
       $13::timestamptz[]
     )`,
    [
      dashboardAttendance.map((attendance) => attendance.id),
      dashboardAttendance.map(() => input.sandboxId),
      dashboardAttendance.map(() => flagshipStore.id),
      dashboardAttendance.map((attendance) => attendance.shift.employee.id),
      dashboardAttendance.map((attendance) => attendance.shift.id),
      dashboardAttendance.map((attendance) => attendance.status),
      dashboardAttendance.map((attendance) =>
        attendance.status === "absent" ? null : attendance.shift.outcome,
      ),
      dashboardAttendance.map((attendance) => attendance.checkInAt),
      dashboardAttendance.map((attendance) => attendance.checkInAt),
      dashboardAttendance.map((attendance) => attendance.checkOutAt),
      dashboardAttendance.map((attendance) => attendance.checkOutAt),
      dashboardAttendance.map((attendance) => attendance.absentAt),
      dashboardAttendance.map((attendance) => attendance.absentAt),
    ],
  );
  const dashboardAttendanceEvents = dashboardAttendance.flatMap(
    (attendance) => {
      if (attendance.status === "absent") {
        return [
          {
            at: attendance.absentAt!,
            attendance,
            data: { reason: "seeded-shift-absence" },
            type: "attendance.absence-recorded",
          },
        ];
      }
      return [
        {
          at: attendance.checkInAt!,
          attendance,
          data: { outcome: attendance.shift.outcome },
          type: "attendance.simulated-check-in",
        },
        {
          at: attendance.checkOutAt!,
          attendance,
          data: { reason: "seeded-shift-complete" },
          type: "attendance.manual-check-out",
        },
      ];
    },
  );
  await input.client.query(
    `insert into attendance_events (
       id, sandbox_id, store_id, employee_id, shift_id,
       attendance_record_id, event_type, event_data,
       business_occurred_at, recorded_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::uuid[], $7::text[], $8::jsonb[], $9::timestamptz[],
       $10::timestamptz[]
     )`,
    [
      dashboardAttendanceEvents.map(() => randomUUID()),
      dashboardAttendanceEvents.map(() => input.sandboxId),
      dashboardAttendanceEvents.map(() => flagshipStore.id),
      dashboardAttendanceEvents.map(
        (event) => event.attendance.shift.employee.id,
      ),
      dashboardAttendanceEvents.map((event) => event.attendance.shift.id),
      dashboardAttendanceEvents.map((event) => event.attendance.id),
      dashboardAttendanceEvents.map((event) => event.type),
      dashboardAttendanceEvents.map((event) => JSON.stringify(event.data)),
      dashboardAttendanceEvents.map((event) => event.at),
      dashboardAttendanceEvents.map(() => input.wallTime),
    ],
  );
  const dashboardHandoverExceptions = dashboardAttendance
    .filter((attendance) => attendance.status !== "absent")
    .map((attendance) => attendance.shift);
  await input.client.query(
    `insert into handover_exceptions (
       id, sandbox_id, store_id, shift_id, handover_id, kind,
       business_occurred_at, recorded_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::text[], $7::timestamptz[], $8::timestamptz[]
     )`,
    [
      dashboardHandoverExceptions.map(() => randomUUID()),
      dashboardHandoverExceptions.map(() => input.sandboxId),
      dashboardHandoverExceptions.map(() => flagshipStore.id),
      dashboardHandoverExceptions.map((shift) => shift.id),
      dashboardHandoverExceptions.map(() => null),
      dashboardHandoverExceptions.map(() => "submission-overdue"),
      dashboardHandoverExceptions.map(
        (shift) => new Date(shift.endsAt.getTime() + 30 * 60 * 1_000),
      ),
      dashboardHandoverExceptions.map(() => input.wallTime),
    ],
  );

  const dashboardClosedRepairs = dashboardReservations.map(
    (reservation, index) => {
      const profileId = machineProfileIds.get(
        reservation.seat.machineProfileCode,
      );
      if (!profileId) {
        throw new Error("The dashboard repair profile seed is incomplete.");
      }
      const createdAt = new Date(
        dashboardDays[index]!.startsAt.getTime() + 2 * 60 * 60 * 1_000,
      );
      return {
        assignedAt: new Date(createdAt.getTime() + 5 * 60 * 1_000),
        closedAt: new Date(createdAt.getTime() + 45 * 60 * 1_000),
        createdAt,
        id: randomUUID(),
        priority: (["normal", "high", "urgent"] as const)[index % 3]!,
        processingAt: new Date(createdAt.getTime() + 10 * 60 * 1_000),
        profileId,
        reservation,
        resolvedAt: new Date(createdAt.getTime() + 35 * 60 * 1_000),
      };
    },
  );
  await input.client.query(
    `insert into repairs (
       id, sandbox_id, store_id, seat_id, machine_profile_id,
       reservation_id, customer_persona_id, created_by_persona_id,
       assigned_to_persona_id, source, description, priority, status,
       created_business_at, assigned_business_at, processing_business_at,
       resolution_note, resolution_submitted_by_persona_id,
       resolution_business_at, latest_verification_outcome,
       latest_verification_reason, verified_by_persona_id,
       verification_business_at, closed_business_at, created_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
       $6::uuid[], $7::uuid[], $8::uuid[], $9::uuid[], $10::text[],
       $11::text[], $12::text[], $13::text[], $14::timestamptz[],
       $15::timestamptz[], $16::timestamptz[], $17::text[], $18::uuid[],
       $19::timestamptz[], $20::text[], $21::text[], $22::uuid[],
       $23::timestamptz[], $24::timestamptz[], $25::timestamptz[]
     )`,
    [
      dashboardClosedRepairs.map((repair) => repair.id),
      dashboardClosedRepairs.map(() => input.sandboxId),
      dashboardClosedRepairs.map(() => flagshipStore.id),
      dashboardClosedRepairs.map((repair) => repair.reservation.seat.id),
      dashboardClosedRepairs.map((repair) => repair.profileId),
      dashboardClosedRepairs.map(() => null),
      dashboardClosedRepairs.map(() => null),
      dashboardClosedRepairs.map(
        (repair, index) =>
          dashboardStaff[index % dashboardStaff.length]!.personaId,
      ),
      dashboardClosedRepairs.map(
        (repair, index) =>
          dashboardStaff[index % dashboardStaff.length]!.personaId,
      ),
      dashboardClosedRepairs.map(() => "staff"),
      dashboardClosedRepairs.map(
        (repair) => `设备例行维修 · ${repair.reservation.seat.code}`,
      ),
      dashboardClosedRepairs.map((repair) => repair.priority),
      dashboardClosedRepairs.map(() => "closed"),
      dashboardClosedRepairs.map((repair) => repair.createdAt),
      dashboardClosedRepairs.map((repair) => repair.assignedAt),
      dashboardClosedRepairs.map((repair) => repair.processingAt),
      dashboardClosedRepairs.map(() => "完成例行检测并恢复可用"),
      dashboardClosedRepairs.map(
        (repair, index) =>
          dashboardStaff[index % dashboardStaff.length]!.personaId,
      ),
      dashboardClosedRepairs.map((repair) => repair.resolvedAt),
      dashboardClosedRepairs.map(() => "success"),
      dashboardClosedRepairs.map(() => "经理复核通过"),
      dashboardClosedRepairs.map(() => dashboardManager.personaId),
      dashboardClosedRepairs.map((repair) => repair.closedAt),
      dashboardClosedRepairs.map((repair) => repair.closedAt),
      dashboardClosedRepairs.map(() => input.wallTime),
    ],
  );
  const dashboardOpenRepairSeat = seatByKey.get("prism-flagship:A-20");
  const dashboardOpenRepairProfileId = dashboardOpenRepairSeat
    ? machineProfileIds.get(dashboardOpenRepairSeat.machineProfileCode)
    : null;
  const dashboardOpenRepairStaff = dashboardStaff[0];
  if (
    !dashboardOpenRepairSeat ||
    !dashboardOpenRepairProfileId ||
    !dashboardOpenRepairStaff
  ) {
    throw new Error("The dashboard open repair seed is incomplete.");
  }
  const dashboardOpenRepair = {
    assignedAt: new Date(input.wallTime.getTime() - 80 * 60 * 1_000),
    createdAt: new Date(input.wallTime.getTime() - 90 * 60 * 1_000),
    id: randomUUID(),
    processingAt: new Date(input.wallTime.getTime() - 60 * 60 * 1_000),
  };
  await input.client.query(
    `update seats set operational_status = 'maintenance'
      where sandbox_id = $1 and id = $2`,
    [input.sandboxId, dashboardOpenRepairSeat.id],
  );
  await input.client.query(
    `insert into repairs (
       id, sandbox_id, store_id, seat_id, machine_profile_id,
       reservation_id, customer_persona_id, created_by_persona_id,
       assigned_to_persona_id, source, description, priority, status,
       created_business_at, assigned_business_at, processing_business_at,
       created_at
     ) values ($1, $2, $3, $4, $5, null, null, $6, $6, 'staff', $7,
       'high', 'processing', $8, $9, $10, $11)`,
    [
      dashboardOpenRepair.id,
      input.sandboxId,
      flagshipStore.id,
      dashboardOpenRepairSeat.id,
      dashboardOpenRepairProfileId,
      dashboardOpenRepairStaff.personaId,
      "显示器间歇黑屏，正在排查信号链路",
      dashboardOpenRepair.createdAt,
      dashboardOpenRepair.assignedAt,
      dashboardOpenRepair.processingAt,
      input.wallTime,
    ],
  );
  const dashboardRepairEvents = [
    ...dashboardClosedRepairs.flatMap((repair) => [
      {
        at: repair.createdAt,
        data: { source: "staff" },
        repairId: repair.id,
        type: "repair.created",
      },
      {
        at: repair.processingAt,
        data: { priority: repair.priority },
        repairId: repair.id,
        type: "repair.processing-started",
      },
      {
        at: repair.closedAt,
        data: { outcome: "success" },
        repairId: repair.id,
        type: "repair.closed",
      },
    ]),
    {
      at: dashboardOpenRepair.createdAt,
      data: { source: "staff" },
      repairId: dashboardOpenRepair.id,
      type: "repair.created",
    },
    {
      at: dashboardOpenRepair.processingAt,
      data: { priority: "high" },
      repairId: dashboardOpenRepair.id,
      type: "repair.processing-started",
    },
  ];
  await input.client.query(
    `insert into repair_business_events (
       id, sandbox_id, repair_id, event_type, event_data,
       business_occurred_at, recorded_at
     ) select * from unnest(
       $1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::jsonb[],
       $6::timestamptz[], $7::timestamptz[]
     )`,
    [
      dashboardRepairEvents.map(() => randomUUID()),
      dashboardRepairEvents.map(() => input.sandboxId),
      dashboardRepairEvents.map((event) => event.repairId),
      dashboardRepairEvents.map((event) => event.type),
      dashboardRepairEvents.map((event) => JSON.stringify(event.data)),
      dashboardRepairEvents.map((event) => event.at),
      dashboardRepairEvents.map(() => input.wallTime),
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

const auditDiffAllowedKeys = new Set([
  "action",
  "active",
  "amountCents",
  "availableQuantity",
  "businessTime",
  "configVersion",
  "contextVersion",
  "correctedBusinessAt",
  "correctionKind",
  "dataType",
  "daySet",
  "effectiveFrom",
  "endsAt",
  "endsNextDay",
  "employeeCode",
  "employeeRole",
  "expectedVersion",
  "filters",
  "fromBusinessDay",
  "isOpen24Hours",
  "lifecycleStatus",
  "listed",
  "lowStockThreshold",
  "movementKind",
  "onHandAfter",
  "onHandDelta",
  "onHandQuantity",
  "objectType",
  "outcome",
  "personaId",
  "priority",
  "quantity",
  "reservedQuantity",
  "resetToRole",
  "result",
  "role",
  "rowCount",
  "search",
  "seedVersion",
  "sortDirection",
  "sortField",
  "startsAt",
  "status",
  "toBusinessDay",
  "unitPriceCents",
  "version",
  "weekdayHalfHourCents",
  "weekendHalfHourCents",
]);

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null) return value === null ? null : undefined;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return typeof value === "string" ? value.slice(0, 200) : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 50)
      .map((item) => sanitizeAuditValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!auditDiffAllowedKeys.has(key)) continue;
    const safe = sanitizeAuditValue(item, depth + 1);
    if (safe !== undefined) sanitized[key] = safe;
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function sanitizeAuditRecord(value: unknown): Record<string, unknown> | null {
  const sanitized = sanitizeAuditValue(value);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : null;
}

function sanitizeAuditReason(value: string | null): string | null {
  if (!value) return null;
  return isSafePlainTextReason(value)
    ? value
    : "已记录业务原因（内容已安全隐藏）";
}

function managerBusinessDaySelection(
  currentTime: Date,
  fromBusinessDay?: string,
  toBusinessDay?: string,
) {
  const availableBusinessDays = managerDashboardBusinessDays(currentTime);
  if (
    (fromBusinessDay && !toBusinessDay) ||
    (!fromBusinessDay && toBusinessDay)
  ) {
    throw new ManagerAuditExportError("invalid-filter");
  }
  const from = fromBusinessDay ?? availableBusinessDays.at(-1)!.key;
  const to = toBusinessDay ?? availableBusinessDays.at(-1)!.key;
  const fromIndex = availableBusinessDays.findIndex((day) => day.key === from);
  const toIndex = availableBusinessDays.findIndex((day) => day.key === to);
  if (fromIndex < 0 || toIndex < 0) {
    throw new ManagerAuditExportError("outside-seed-range");
  }
  if (fromIndex > toIndex) {
    throw new ManagerAuditExportError("reversed-range");
  }
  return {
    availableBusinessDays,
    endsAt: availableBusinessDays[toIndex]!.endsAt,
    fromBusinessDay: from,
    startsAt: availableBusinessDays[fromIndex]!.startsAt,
    toBusinessDay: to,
  };
}

interface ManagerScopedStore {
  code: string;
  display_name: string;
  id: string;
}

async function managerStoreWithClient(
  client: PoolClient,
  input: ReadRoleContextInput & {
    readonly role: FrontlineRole | "hq";
    readonly storeId: string;
  },
  wallTime: Date,
) {
  let sandbox: SandboxRow;
  let targetStoreId: string;
  if (input.role === "hq") {
    sandbox = await assertHeadquartersContext(
      client,
      { ...input, role: "hq" },
      wallTime,
    );
    targetStoreId = input.storeId;
  } else {
    const context = await assertFrontlineContext(
      client,
      { ...input, role: input.role },
      wallTime,
    );
    if (input.role !== "manager") throw new RoleContextStaleError();
    if (input.storeId !== context.actorStoreId) {
      throw new ManagerAuditExportError("store-not-found");
    }
    sandbox = context.sandbox;
    targetStoreId = context.actorStoreId;
  }
  const store = await client.query<ManagerScopedStore>(
    `select id, code, display_name from stores
      where sandbox_id = $1 and id = $2 and code = any($3::text[])`,
    [input.sandboxId, targetStoreId, HEADQUARTERS_FIXED_STORE_CODES],
  );
  const storeRow = store.rows[0];
  if (!storeRow) throw new ManagerAuditExportError("store-not-found");
  return { context: { sandbox }, store: storeRow };
}

interface ManagerAuditRow {
  action: string;
  actor_display_name: string | null;
  after_data: unknown;
  before_data: unknown;
  business_occurred_at: Date;
  id: string;
  object_id: string | null;
  object_type: string;
  persona_id: string | null;
  reason: string | null;
  recorded_at: Date;
  request_id: string;
  result: ManagerAuditResult;
  role: PublicRole;
  store_code: string | null;
  store_display_name: string | null;
  store_id: string | null;
}

function auditOrderBy(sort: ReadManagerAuditsInput["sort"]) {
  const expressions: Record<ManagerAuditSortField, string> = {
    action: "audit.action",
    businessOccurredAt: "audit.business_occurred_at",
    objectType: "audit.object_type",
    persona: "coalesce(persona.display_name, '系统')",
    recordedAt: "audit.recorded_at",
    result: "audit.result",
    role: "audit.role",
  };
  return `${expressions[sort.field]} ${sort.direction}, audit.id ${sort.direction}`;
}

async function managerAuditRowsWithClient(
  client: PoolClient,
  input: ReadManagerAuditsInput,
  range: { readonly endsAt: Date; readonly startsAt: Date },
) {
  const rows = await client.query<ManagerAuditRow>(
    `select audit.id, audit.action, audit.object_type, audit.object_id,
            audit.result, audit.reason, audit.request_id, audit.before_data,
            audit.after_data, audit.business_occurred_at, audit.recorded_at,
            audit.role, audit.persona_id,
            persona.display_name as actor_display_name,
            store.id as store_id, store.code as store_code,
            store.display_name as store_display_name
       from audit_events audit
       join stores store on store.id = audit.store_id
       left join demo_personas persona on persona.id = audit.persona_id
      where audit.sandbox_id = $1 and audit.store_id = $2
        and audit.business_occurred_at >= $3
        and audit.business_occurred_at < $4
        and ($5::uuid is null or audit.persona_id = $5)
        and ($6::text is null or audit.role = $6)
        and ($7::text is null or audit.action = $7)
        and ($8::text is null or audit.object_type = $8)
        and ($9::text is null or audit.result = $9)
      order by ${auditOrderBy(input.sort)}`,
    [
      input.sandboxId,
      input.storeId,
      range.startsAt,
      range.endsAt,
      input.filters.personaId ?? null,
      input.filters.role ?? null,
      input.filters.action ?? null,
      input.filters.objectType ?? null,
      input.filters.result ?? null,
    ],
  );
  return rows.rows.map((row): DatabaseManagerAuditEvent => ({
    action: row.action,
    actor: {
      displayName: row.actor_display_name ?? "系统",
      personaId: row.persona_id,
    },
    after: sanitizeAuditRecord(row.after_data),
    before: sanitizeAuditRecord(row.before_data),
    businessOccurredAt: row.business_occurred_at,
    eventId: row.id,
    objectId: row.object_id,
    objectType: row.object_type,
    reason: sanitizeAuditReason(row.reason),
    recordedAt: row.recorded_at,
    requestId: row.request_id,
    result: row.result,
    role: row.role,
    store: {
      code: row.store_code!,
      displayName: row.store_display_name!,
      storeId: row.store_id!,
    },
  }));
}

async function headquartersAuditRowsWithClient(
  client: PoolClient,
  input: ReadHeadquartersAuditsInput,
  range: { readonly endsAt: Date; readonly startsAt: Date },
  includeChainScope: boolean,
) {
  const rows = await client.query<ManagerAuditRow>(
    `select audit.id, audit.action, audit.object_type, audit.object_id,
            audit.result, audit.reason, audit.request_id, audit.before_data,
            audit.after_data, audit.business_occurred_at, audit.recorded_at,
            audit.role, audit.persona_id,
            persona.display_name as actor_display_name,
            store.id as store_id, store.code as store_code,
            store.display_name as store_display_name
       from audit_events audit
       left join stores store on store.id = audit.store_id
       left join demo_personas persona on persona.id = audit.persona_id
      where audit.sandbox_id = $1
        and (audit.store_id = any($2::uuid[])
          or ($3::boolean and audit.store_id is null))
        and audit.business_occurred_at >= $4
        and audit.business_occurred_at < $5
        and ($6::uuid is null or audit.persona_id = $6)
        and ($7::text is null or audit.role = $7)
        and ($8::text is null or audit.action = $8)
        and ($9::text is null or audit.object_type = $9)
        and ($10::text is null or audit.result = $10)
      order by ${auditOrderBy(input.sort)}`,
    [
      input.sandboxId,
      input.selectedStoreIds,
      includeChainScope,
      range.startsAt,
      range.endsAt,
      input.filters.personaId ?? null,
      input.filters.role ?? null,
      input.filters.action ?? null,
      input.filters.objectType ?? null,
      input.filters.result ?? null,
    ],
  );
  return rows.rows.map(
    (
      row,
    ): Omit<DatabaseManagerAuditEvent, "store"> & {
      readonly store: DatabaseManagerAuditEvent["store"] | null;
    } => ({
      action: row.action,
      actor: {
        displayName: row.actor_display_name ?? "系统",
        personaId: row.persona_id,
      },
      after: sanitizeAuditRecord(row.after_data),
      before: sanitizeAuditRecord(row.before_data),
      businessOccurredAt: row.business_occurred_at,
      eventId: row.id,
      objectId: row.object_id,
      objectType: row.object_type,
      reason: sanitizeAuditReason(row.reason),
      recordedAt: row.recorded_at,
      requestId: row.request_id,
      result: row.result,
      role: row.role,
      store:
        row.store_id && row.store_code && row.store_display_name
          ? {
              code: row.store_code,
              displayName: row.store_display_name,
              storeId: row.store_id,
            }
          : null,
    }),
  );
}

const exportColumns = {
  audits: [
    ["经营日", "text"],
    ["业务发生时间", "datetime"],
    ["服务器记录时间", "datetime"],
    ["演示人物", "text"],
    ["角色", "text"],
    ["门店", "text"],
    ["动作", "text"],
    ["对象类型", "text"],
    ["对象ID", "text"],
    ["结果", "text"],
    ["原因", "text"],
    ["请求关联ID", "text"],
    ["变更前", "json"],
    ["变更后", "json"],
  ],
  inventoryMovements: [
    ["经营日", "text"],
    ["流水ID", "text"],
    ["库存项目", "text"],
    ["流水类型", "text"],
    ["数量变化", "text"],
    ["变动后账面库存", "text"],
    ["业务发生时间", "datetime"],
    ["服务器记录时间", "datetime"],
    ["关联对象", "text"],
  ],
  orders: [
    ["经营日", "text"],
    ["订单ID", "text"],
    ["顾客", "text"],
    ["状态", "text"],
    ["关联预约ID", "text"],
    ["创建时间", "datetime"],
    ["模拟金额（元）", "money"],
  ],
  repairs: [
    ["经营日", "text"],
    ["报修ID", "text"],
    ["座位", "text"],
    ["机型档案", "text"],
    ["状态", "text"],
    ["优先级", "text"],
    ["创建时间", "datetime"],
    ["关闭时间", "datetime"],
  ],
  reservations: [
    ["经营日", "text"],
    ["预约ID", "text"],
    ["顾客", "text"],
    ["座位", "text"],
    ["状态", "text"],
    ["开始时间", "datetime"],
    ["结束时间", "datetime"],
    ["模拟金额（元）", "money"],
  ],
  shifts: [
    ["经营日", "text"],
    ["班次ID", "text"],
    ["员工编号", "text"],
    ["员工", "text"],
    ["角色", "text"],
    ["开始时间", "datetime"],
    ["结束时间", "datetime"],
    ["状态", "text"],
  ],
} as const satisfies Record<
  ManagerExportDataType,
  ReadonlyArray<readonly [string, ManagerExportCellKind]>
>;

async function managerExportRowsWithClient(
  client: PoolClient,
  input: ManagerExportInput,
  range: { readonly endsAt: Date; readonly startsAt: Date },
): Promise<ReadonlyArray<ReadonlyArray<Date | number | string | null>>> {
  const direction = input.sort.direction;
  if (input.dataType === "audits") {
    const events = await managerAuditRowsWithClient(
      client,
      {
        ...input,
        filters: input.filters,
      },
      range,
    );
    return events.map((event) => [
      businessDayKey(event.businessOccurredAt),
      event.businessOccurredAt,
      event.recordedAt,
      event.actor.displayName,
      event.role,
      event.store.displayName,
      event.action,
      event.objectType,
      event.objectId,
      event.result,
      event.reason,
      event.requestId,
      event.before ? JSON.stringify(event.before) : null,
      event.after ? JSON.stringify(event.after) : null,
    ]);
  }
  const search = input.filters.search?.trim() || null;
  const status = input.filters.status?.trim() || null;
  if (input.dataType === "reservations") {
    const result = await client.query<{
      amount_cents: number;
      customer_name: string;
      ends_at: Date;
      id: string;
      seat_code: string;
      starts_at: Date;
      status: string;
    }>(
      `select reservation.id, customer.display_name as customer_name,
              seat.code as seat_code, reservation.status,
              reservation.starts_at, reservation.ends_at,
              coalesce(reservation.simulated_payment_cents,
                (reservation.price_snapshot->'price'->>'payableCents')::integer,
                0) as amount_cents
         from reservations reservation
         join demo_personas customer on customer.id = reservation.customer_persona_id
         join seats seat on seat.id = reservation.seat_id
        where reservation.sandbox_id = $1 and reservation.store_id = $2
          and reservation.starts_at >= $3 and reservation.starts_at < $4
          and ($5::text is null or reservation.status = $5)
          and ($6::text is null or reservation.id::text ilike '%' || $6 || '%'
            or customer.display_name ilike '%' || $6 || '%'
            or seat.code ilike '%' || $6 || '%')
        order by ${input.sort.field === "amountCents" ? "amount_cents" : input.sort.field === "status" ? "reservation.status" : "reservation.starts_at"} ${direction}, reservation.id ${direction}`,
      [
        input.sandboxId,
        input.storeId,
        range.startsAt,
        range.endsAt,
        status,
        search,
      ],
    );
    return result.rows.map((row) => [
      businessDayKey(row.starts_at),
      row.id,
      row.customer_name,
      row.seat_code,
      row.status,
      row.starts_at,
      row.ends_at,
      row.amount_cents,
    ]);
  }
  if (input.dataType === "orders") {
    const result = await client.query<{
      amount_cents: number;
      created_business_at: Date;
      customer_name: string;
      id: string;
      reservation_id: string;
      status: string;
    }>(
      `select orders.id, customer.display_name as customer_name, orders.status,
              orders.reservation_id, orders.created_business_at,
              coalesce(orders.simulated_payment_cents,
                (orders.order_snapshot->>'payableCents')::integer, 0) as amount_cents
         from customer_orders orders
         join demo_personas customer on customer.id = orders.customer_persona_id
        where orders.sandbox_id = $1 and orders.store_id = $2
          and orders.created_business_at >= $3 and orders.created_business_at < $4
          and ($5::text is null or orders.status = $5)
          and ($6::text is null or orders.id::text ilike '%' || $6 || '%'
            or customer.display_name ilike '%' || $6 || '%')
        order by ${input.sort.field === "amountCents" ? "amount_cents" : input.sort.field === "status" ? "orders.status" : "orders.created_business_at"} ${direction}, orders.id ${direction}`,
      [
        input.sandboxId,
        input.storeId,
        range.startsAt,
        range.endsAt,
        status,
        search,
      ],
    );
    return result.rows.map((row) => [
      businessDayKey(row.created_business_at),
      row.id,
      row.customer_name,
      row.status,
      row.reservation_id,
      row.created_business_at,
      row.amount_cents,
    ]);
  }
  if (input.dataType === "inventoryMovements") {
    const result = await client.query<{
      business_occurred_at: Date;
      display_name: string;
      id: string;
      movement_kind: string | null;
      on_hand_after: number;
      on_hand_delta: number;
      order_id: string | null;
      recorded_at: Date;
      repair_id: string | null;
    }>(
      `select movement.id, item.display_name, movement.movement_kind,
              movement.on_hand_delta, movement.on_hand_after,
              movement.business_occurred_at, movement.recorded_at,
              movement.order_id, movement.repair_id
         from inventory_movements movement
         join inventory_items item on item.id = movement.inventory_item_id
        where movement.sandbox_id = $1 and movement.store_id = $2
          and movement.business_occurred_at >= $3
          and movement.business_occurred_at < $4
          and ($5::text is null or movement.movement_kind = $5)
          and ($6::text is null or movement.id::text ilike '%' || $6 || '%'
            or item.display_name ilike '%' || $6 || '%')
        order by ${input.sort.field === "status" ? "movement.movement_kind" : "movement.business_occurred_at"} ${direction}, movement.id ${direction}`,
      [
        input.sandboxId,
        input.storeId,
        range.startsAt,
        range.endsAt,
        status,
        search,
      ],
    );
    return result.rows.map((row) => [
      businessDayKey(row.business_occurred_at),
      row.id,
      row.display_name,
      row.movement_kind,
      row.on_hand_delta,
      row.on_hand_after,
      row.business_occurred_at,
      row.recorded_at,
      row.order_id ?? row.repair_id,
    ]);
  }
  if (input.dataType === "repairs") {
    const result = await client.query<{
      closed_business_at: Date | null;
      created_business_at: Date;
      id: string;
      machine_name: string;
      priority: string;
      seat_code: string;
      status: string;
    }>(
      `select repair.id, seat.code as seat_code,
              repair.machine_profile_snapshot->>'displayName' as machine_name,
              repair.status,
              repair.priority, repair.created_business_at,
              repair.closed_business_at
         from repairs repair
         join seats seat on seat.id = repair.seat_id
        where repair.sandbox_id = $1 and repair.store_id = $2
          and repair.created_business_at >= $3 and repair.created_business_at < $4
          and ($5::text is null or repair.status = $5)
          and ($6::text is null or repair.id::text ilike '%' || $6 || '%'
            or seat.code ilike '%' || $6 || '%'
            or repair.machine_profile_snapshot->>'displayName' ilike '%' || $6 || '%')
        order by ${input.sort.field === "status" ? "repair.status" : "repair.created_business_at"} ${direction}, repair.id ${direction}`,
      [
        input.sandboxId,
        input.storeId,
        range.startsAt,
        range.endsAt,
        status,
        search,
      ],
    );
    return result.rows.map((row) => [
      businessDayKey(row.created_business_at),
      row.id,
      row.seat_code,
      row.machine_name,
      row.status,
      row.priority,
      row.created_business_at,
      row.closed_business_at,
    ]);
  }
  const result = await client.query<{
    display_name: string;
    employee_code: string;
    ends_at: Date;
    id: string;
    role: string;
    starts_at: Date;
    status: string;
  }>(
    `select shift.id, employee.employee_code, employee.display_name,
            employee.role, shift.starts_at, shift.ends_at, shift.status
       from shifts shift
       join employees employee on employee.id = shift.employee_id
      where shift.sandbox_id = $1 and shift.store_id = $2
        and shift.starts_at >= $3 and shift.starts_at < $4
        and ($5::text is null or shift.status = $5)
        and ($6::text is null or shift.id::text ilike '%' || $6 || '%'
          or employee.employee_code ilike '%' || $6 || '%'
          or employee.display_name ilike '%' || $6 || '%')
      order by ${input.sort.field === "status" ? "shift.status" : "shift.starts_at"} ${direction}, shift.id ${direction}`,
    [
      input.sandboxId,
      input.storeId,
      range.startsAt,
      range.endsAt,
      status,
      search,
    ],
  );
  return result.rows.map((row) => [
    businessDayKey(row.starts_at),
    row.id,
    row.employee_code,
    row.display_name,
    row.role,
    row.starts_at,
    row.ends_at,
    row.status,
  ]);
}

export function createPublicSandboxDatabase(
  databaseUrl: string,
  options: PublicSandboxDatabaseOptions = {},
): PublicSandboxDatabase {
  const pool = new Pool({ connectionString: databaseUrl });
  const wallClock = options.wallClock ?? { now: () => new Date() };
  const admissionLimits = normalizeSandboxAdmissionLimits(
    options.admissionLimits,
  );

  async function holdSandboxAdmissionLock(client: PoolClient) {
    await client.query(
      "select pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["public-sandbox-admission-capacity"],
    );
  }

  async function scheduleExpiredSandboxCleanupWithClient(
    client: PoolClient,
    wallTime: Date,
  ): Promise<number> {
    const scheduled = await client.query<{ sandbox_id: string }>(
      `update sandbox_lifecycle_tasks
          set state = 'pending', cleanup_reason = 'expired',
              cleanup_phase = 'blobs', cleanup_started_at = coalesce(
                cleanup_started_at, $1
              ), attempts = 0, available_at = $1, last_failure = null,
              updated_at = $1
        where state = 'active' and expires_at <= $1
        returning sandbox_id`,
      [wallTime],
    );
    for (const task of scheduled.rows) {
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        task.sandbox_id,
      ]);
      await client.query(
        `update sandboxes
            set invalidated_at = coalesce(invalidated_at, $2),
                role_context_version = case
                  when invalidated_at is null then role_context_version + 1
                  else role_context_version
                end
          where id = $1`,
        [task.sandbox_id, wallTime],
      );
    }
    return scheduled.rowCount ?? 0;
  }

  async function consumeRateLimitWindow(
    client: PoolClient,
    input: {
      readonly limit: number;
      readonly operation: "create" | "reset";
      readonly subjectHash: string;
      readonly subjectKind: "ip" | "visitor";
      readonly wallTime: Date;
      readonly windowKind: "day" | "hour";
    },
  ) {
    const windowStartedAt =
      input.windowKind === "hour"
        ? hourWindowStart(input.wallTime)
        : dayWindowStart(input.wallTime);
    const consumed = await client.query(
      `insert into sandbox_request_rate_limits (
         operation, subject_kind, window_kind, subject_hash,
         window_started_at, request_count, updated_at
       ) values ($1, $2, $3, $4, $5, 1, $6)
       on conflict (
         operation, subject_kind, window_kind, subject_hash, window_started_at
       ) do update
          set request_count = sandbox_request_rate_limits.request_count + 1,
              updated_at = excluded.updated_at
        where sandbox_request_rate_limits.request_count < $7
       returning request_count`,
      [
        input.operation,
        input.subjectKind,
        input.windowKind,
        input.subjectHash,
        windowStartedAt,
        input.wallTime,
        input.limit,
      ],
    );
    if (consumed.rowCount === 1) return;
    const retryAt = new Date(
      windowStartedAt.getTime() +
        (input.windowKind === "hour" ? HOUR_MS : DAY_MS),
    );
    throw new PublicSandboxRateLimitedError(input.operation, retryAt);
  }

  async function consumeSandboxAdmission(
    client: PoolClient,
    input: {
      readonly clientIp: string | undefined;
      readonly operation: "create" | "reset";
      readonly visitorKey: string | undefined;
      readonly wallTime: Date;
    },
  ) {
    // A signed visitor remains rate-limited even when an adapter cannot provide
    // a trusted peer address. IP limits are additive, never a prerequisite.
    const perVisitor =
      input.operation === "create"
        ? admissionLimits.createPerVisitor
        : admissionLimits.resetPerVisitor;
    const perIp =
      input.operation === "create"
        ? admissionLimits.createPerIp
        : admissionLimits.resetPerIp;
    const subjects: Array<{
      limit: SandboxRequestRateLimit;
      subjectHash: string;
      subjectKind: "ip" | "visitor";
    }> = [];
    if (input.visitorKey) {
      subjects.push({
        limit: perVisitor,
        subjectHash: hash(input.visitorKey),
        subjectKind: "visitor",
      });
    }
    if (input.clientIp) {
      subjects.push({
        limit: perIp,
        subjectHash: hash(input.clientIp),
        subjectKind: "ip",
      });
    }
    for (const subject of subjects) {
      await consumeRateLimitWindow(client, {
        limit: subject.limit.perHour,
        operation: input.operation,
        subjectHash: subject.subjectHash,
        subjectKind: subject.subjectKind,
        wallTime: input.wallTime,
        windowKind: "hour",
      });
      await consumeRateLimitWindow(client, {
        limit: subject.limit.perDay,
        operation: input.operation,
        subjectHash: subject.subjectHash,
        subjectKind: subject.subjectKind,
        wallTime: input.wallTime,
        windowKind: "day",
      });
    }
  }

  async function assertSandboxCapacity(client: PoolClient, wallTime: Date) {
    await scheduleExpiredSandboxCleanupWithClient(client, wallTime);
    const active = await client.query<{
      active_count: string;
      next_expiry: Date | null;
    }>(
      `select count(*)::text as active_count, min(expires_at) as next_expiry
         from sandbox_lifecycle_tasks
        where state = 'active' and expires_at > $1`,
      [wallTime],
    );
    const current = active.rows[0];
    if (
      Number(current?.active_count ?? "0") < admissionLimits.activeSandboxLimit
    ) {
      return;
    }
    throw new PublicSandboxCapacityExceededError(
      current?.next_expiry ?? new Date(wallTime.getTime() + 60_000),
    );
  }

  const demoToolMethods = createSandboxDemoToolMethods(
    pool,
    {
      dueHandlers: {
        ...reservationDueHandlers(),
        ...attendanceDueHandlers(),
        ...handoverDueHandlers(),
        ...options.dueHandlers,
      },
      consumeResetAdmission: (client, input) =>
        consumeSandboxAdmission(client, {
          ...input,
          operation: "reset",
        }),
      holdSandboxAdmissionLock,
      sandboxLifetimeMilliseconds: SANDBOX_LIFETIME_MS,
      wallClock,
    },
    materializePublicSandbox,
    readSandboxResult,
  );

  async function executeManagerExport(
    input: ManagerExportInput,
    recordAudit: boolean,
  ): Promise<DatabaseManagerExport> {
    const client = await pool.connect();
    const wallTime = wallClock.now();
    try {
      await client.query("begin");
      await client.query("set local role jingshu_runtime");
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        input.sandboxId,
      ]);
      const { context, store } = await managerStoreWithClient(
        client,
        input,
        wallTime,
      );
      const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
      const selection = managerBusinessDaySelection(
        currentTime,
        input.fromBusinessDay,
        input.toBusinessDay,
      );
      const rows = await managerExportRowsWithClient(client, input, selection);
      if (recordAudit) {
        if (!input.requestId) {
          throw new ManagerAuditExportError("invalid-filter");
        }
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, 'export.csv', 'export', null,
             'allowed', null, $6, null, $7::jsonb, $8, $9)`,
          [
            randomUUID(),
            input.sandboxId,
            store.id,
            input.personaId,
            input.role,
            input.requestId,
            JSON.stringify({
              dataType: input.dataType,
              filters: input.filters,
              fromBusinessDay: selection.fromBusinessDay,
              rowCount: rows.length,
              sortDirection: input.sort.direction,
              sortField: input.sort.field,
              toBusinessDay: selection.toBusinessDay,
            }),
            currentTime,
            wallTime,
          ],
        );
      }
      await client.query("commit");
      return {
        columns: exportColumns[input.dataType].map(([header, kind]) => ({
          header,
          kind,
        })),
        dataType: input.dataType,
        range: {
          endsAt: selection.endsAt,
          fromBusinessDay: selection.fromBusinessDay,
          startsAt: selection.startsAt,
          toBusinessDay: selection.toBusinessDay,
        },
        rows,
        store: {
          code: store.code,
          displayName: store.display_name,
          storeId: store.id,
        },
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    ...demoToolMethods,
    async readDemoStory(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const story = await readDemoStoryWithClient(client, input, wallTime);
        await client.query("commit");
        return story;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async enqueueRepairImageCleanup(input) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query(
          `insert into repair_image_cleanup_jobs (
             id, sandbox_id, target_kind, object_key, reason, available_at
           ) values ($1, $2, $3, $4, $5, $6)`,
          [
            randomUUID(),
            input.sandboxId,
            input.targetKind,
            input.objectKey ?? null,
            input.reason,
            input.availableAt,
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
    async completeRepairImageCleanupForSandbox(sandboxId) {
      await pool.query(
        `update repair_image_cleanup_jobs
            set status = 'completed', completed_at = $2, last_failure = null
          where sandbox_id = $1 and target_kind = 'sandbox'
            and status = 'pending'`,
        [sandboxId, wallClock.now()],
      );
    },
    async completeRepairImageCleanupJob(jobId) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        const job = await client.query<{
          object_key: string | null;
          reason: string;
          sandbox_id: string;
          target_kind: "object" | "sandbox";
        }>(
          `select sandbox_id, target_kind, object_key, reason
             from repair_image_cleanup_jobs
            where id = $1 and status = 'pending'
            for update`,
          [jobId],
        );
        const jobRow = job.rows[0];
        if (!jobRow) {
          await client.query("commit");
          return;
        }
        if (
          jobRow.reason === "orphan-upload-intent" &&
          jobRow.target_kind === "object" &&
          jobRow.object_key
        ) {
          await client.query("select set_config('app.sandbox_id', $1, true)", [
            jobRow.sandbox_id,
          ]);
          await client.query(
            `delete from repair_upload_intents
              where sandbox_id = $1 and quarantine_object_key = $2
                and status <> 'consumed'`,
            [jobRow.sandbox_id, jobRow.object_key],
          );
        }
        await client.query(
          `update repair_image_cleanup_jobs
              set status = 'completed', completed_at = $2, last_failure = null
            where id = $1 and status = 'pending'`,
          [jobId, wallTime],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readDueRepairImageCleanupJobs(limit) {
      const jobs = await pool.query<{
        attempts: number;
        id: string;
        object_key: string | null;
        sandbox_id: string;
        target_kind: "object" | "sandbox";
      }>(
        `select id, sandbox_id, target_kind, object_key, attempts
           from repair_image_cleanup_jobs
          where status = 'pending' and available_at <= $1
          order by available_at, created_at
          limit $2`,
        [wallClock.now(), Math.max(1, Math.min(100, limit))],
      );
      return jobs.rows.map((job) => ({
        attempts: job.attempts,
        jobId: job.id,
        objectKey: job.object_key,
        sandboxId: job.sandbox_id,
        targetKind: job.target_kind,
      }));
    },
    async retryRepairImageCleanupJob(input) {
      await pool.query(
        `update repair_image_cleanup_jobs
            set attempts = attempts + 1, available_at = $2,
                last_failure = $3
          where id = $1 and status = 'pending'`,
        [input.jobId, input.availableAt, input.failure.slice(0, 500)],
      );
    },
    async scheduleExpiredSandboxCleanup() {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        const scheduled = await scheduleExpiredSandboxCleanupWithClient(
          client,
          wallTime,
        );
        await client.query("commit");
        return scheduled;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readDueSandboxCleanupTasks(limit) {
      await this.scheduleExpiredSandboxCleanup();
      const tasks = await pool.query<{
        attempts: number;
        cleanup_phase: "blobs" | "business";
        cleanup_reason: "expired" | "reset";
        sandbox_id: string;
      }>(
        `select sandbox_id, cleanup_reason, cleanup_phase, attempts
           from sandbox_lifecycle_tasks
          where state in ('pending', 'retry') and available_at <= $1
          order by available_at, cleanup_started_at, sandbox_id
          limit $2`,
        [wallClock.now(), Math.max(1, Math.min(100, limit))],
      );
      return tasks.rows.map((task) => ({
        attempts: task.attempts,
        phase: task.cleanup_phase,
        reason: task.cleanup_reason,
        sandboxId: task.sandbox_id,
      }));
    },
    async markSandboxCleanupBlobsDeleted(sandboxId) {
      const wallTime = wallClock.now();
      await pool.query(
        `update sandbox_lifecycle_tasks
            set state = 'pending', cleanup_phase = 'business',
                available_at = $2, last_failure = null, updated_at = $2
          where sandbox_id = $1 and state in ('pending', 'retry')
            and cleanup_phase = 'blobs'`,
        [sandboxId, wallTime],
      );
    },
    async deleteSandboxBusinessBatch(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      const batchSize = Math.max(1, Math.min(500, input.batchSize));
      try {
        await client.query("begin");
        const task = await client.query<{
          attempts: number;
          cleanup_phase: "blobs" | "business";
          cleanup_reason: "expired" | "reset";
          cleanup_started_at: Date | null;
        }>(
          `select cleanup_reason, cleanup_phase, cleanup_started_at, attempts
             from sandbox_lifecycle_tasks
            where sandbox_id = $1 and state in ('pending', 'retry')
            for update`,
          [input.sandboxId],
        );
        const taskRow = task.rows[0];
        if (!taskRow || taskRow.cleanup_phase !== "business") {
          await client.query("commit");
          return { completed: !taskRow, deletedRows: 0 };
        }
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        await client.query(
          "select set_config('app.sandbox_cleanup', 'true', true)",
        );
        for (const table of SANDBOX_BUSINESS_CLEANUP_TABLES) {
          const deleted = await client.query(
            `delete from ${table}
              where ctid in (
                select ctid from ${table}
                 where sandbox_id = $1
                 limit $2
              )`,
            [input.sandboxId, batchSize],
          );
          if ((deleted.rowCount ?? 0) > 0) {
            await client.query(
              `update sandbox_lifecycle_tasks
                  set available_at = $2, updated_at = $2
                where sandbox_id = $1`,
              [input.sandboxId, wallTime],
            );
            await client.query("commit");
            return { completed: false, deletedRows: deleted.rowCount ?? 0 };
          }
        }
        await client.query(
          `insert into sandbox_deletion_receipts (
             id, reason, requested_at, completed_at, attempts
           ) values ($1, $2, $3, $4, $5)`,
          [
            randomUUID(),
            taskRow.cleanup_reason,
            taskRow.cleanup_started_at ?? wallTime,
            wallTime,
            taskRow.attempts,
          ],
        );
        await client.query(
          "delete from sandbox_lifecycle_tasks where sandbox_id = $1",
          [input.sandboxId],
        );
        await client.query("delete from sandboxes where id = $1", [
          input.sandboxId,
        ]);
        await client.query("commit");
        return { completed: true, deletedRows: 0 };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async retrySandboxCleanupTask(input) {
      await pool.query(
        `update sandbox_lifecycle_tasks
            set state = 'retry', attempts = attempts + 1, available_at = $2,
                last_failure = $3, updated_at = $4
          where sandbox_id = $1 and state in ('pending', 'retry')`,
        [
          input.sandboxId,
          input.availableAt,
          input.failure.slice(0, 500),
          wallClock.now(),
        ],
      );
    },
    async createRepairSampleImage(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const authorized = await readAuthorizedRepair(
          client,
          input,
          wallTime,
          "upload",
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:repair-images:${input.repairId}`],
        );
        const existing = await client.query<{
          created_at: Date;
          image_id: string;
        }>(
          `select id as image_id, created_at
             from repair_images
            where sandbox_id = $1 and repair_id = $2
              and source = 'sample' and sample_asset_id = $3
            order by created_at desc
            limit 1`,
          [input.sandboxId, input.repairId, input.sampleAssetId],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          await client.query("commit");
          return {
            byteSize: 925729,
            contentType: "image/png",
            createdAt: existingRow.created_at,
            height: 720,
            imageId: existingRow.image_id,
            repairId: input.repairId,
            sampleAssetId: input.sampleAssetId,
            sandboxId: input.sandboxId,
            source: "sample",
            width: 960,
          };
        }
        const count = await client.query<{ count: number }>(
          `select count(*)::integer as count from repair_images
            where sandbox_id = $1 and repair_id = $2`,
          [input.sandboxId, input.repairId],
        );
        if ((count.rows[0]?.count ?? 0) >= 3) {
          throw new RepairImageConflictError("max-images");
        }
        const imageId = randomUUID();
        await client.query(
          `insert into repair_images (
             id, sandbox_id, repair_id, created_by_persona_id, source,
             content_type, object_key, sample_asset_id, byte_size, width,
             height, created_at
           ) values ($1, $2, $3, $4, 'sample', 'image/png', null, $5,
             925729, 960, 720, $6)`,
          [
            imageId,
            input.sandboxId,
            input.repairId,
            input.personaId,
            input.sampleAssetId,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action,
             object_type, object_id, result, request_id, after_data,
             business_occurred_at, recorded_at
          ) values ($1, $2, $3, $4, $5, 'repair.sample-image-saved',
             'repair', $6, 'allowed', $7, $8::jsonb, $9, $10)`,
          [
            randomUUID(),
            input.sandboxId,
            authorized.repair.store_id,
            input.personaId,
            input.role,
            input.repairId,
            input.requestId,
            JSON.stringify({ imageId, sampleAssetId: input.sampleAssetId }),
            businessTimeForSandbox(authorized.actor.sandbox, wallTime),
            wallTime,
          ],
        );
        await client.query("commit");
        return {
          byteSize: 925729,
          contentType: "image/png",
          createdAt: wallTime,
          height: 720,
          imageId,
          repairId: input.repairId,
          sampleAssetId: input.sampleAssetId,
          sandboxId: input.sandboxId,
          source: "sample",
          width: 960,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async createRepairImageIntent(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        await readAuthorizedRepair(client, input, wallTime, "upload");
        if (
          !Number.isInteger(input.declaredSize) ||
          input.declaredSize < 1 ||
          input.declaredSize > REPAIR_IMAGE_MAX_BYTES ||
          !repairImageExtensions[input.declaredContentType].has(
            input.filenameExtension,
          )
        ) {
          throw new RepairImageConflictError("image-invalid");
        }
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:repair-images:${input.repairId}`],
        );
        const count = await client.query<{ count: number }>(
          `select (
             (select count(*) from repair_images
               where sandbox_id = $1 and repair_id = $2) +
             (select count(*) from repair_upload_intents
               where sandbox_id = $1 and repair_id = $2
                 and status in ('issued', 'uploading', 'uploaded') and expires_at > $3)
           )::integer as count`,
          [input.sandboxId, input.repairId, wallTime],
        );
        if ((count.rows[0]?.count ?? 0) >= 3) {
          throw new RepairImageConflictError("max-images");
        }
        const intentId = randomUUID();
        const expiresAt = new Date(
          wallTime.getTime() + REPAIR_IMAGE_INTENT_LIFETIME_MS,
        );
        const quarantineObjectKey = `quarantine/${input.sandboxId}/${randomUUID()}`;
        await client.query(
          `insert into repair_upload_intents (
             id, sandbox_id, repair_id, actor_persona_id,
             filename_extension, declared_content_type, declared_size,
             quarantine_object_key, status, expires_at, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'issued', $9, $10)`,
          [
            intentId,
            input.sandboxId,
            input.repairId,
            input.personaId,
            input.filenameExtension,
            input.declaredContentType,
            input.declaredSize,
            quarantineObjectKey,
            expiresAt,
            wallTime,
          ],
        );
        await client.query(
          `insert into repair_image_cleanup_jobs (
             id, sandbox_id, target_kind, object_key, reason, available_at
           ) values ($1, $2, 'object', $3, 'orphan-upload-intent', $4)`,
          [
            randomUUID(),
            input.sandboxId,
            quarantineObjectKey,
            new Date(wallTime.getTime() + HOUR_MS),
          ],
        );
        await client.query("commit");
        return {
          declaredContentType: input.declaredContentType,
          declaredSize: input.declaredSize,
          expiresAt,
          filenameExtension: input.filenameExtension,
          intentId,
          quarantineObjectKey,
          repairId: input.repairId,
          sandboxId: input.sandboxId,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async claimRepairImageUpload(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const intent = await client.query<RepairImageIntentRow>(
          `select id as intent_id, sandbox_id, repair_id, actor_persona_id,
                  filename_extension, declared_content_type, declared_size,
                  quarantine_object_key, status, expires_at
             from repair_upload_intents
            where sandbox_id = $1 and id = $2
            for update`,
          [input.sandboxId, input.intentId],
        );
        const row = intent.rows[0];
        if (
          !row ||
          row.repair_id !== input.repairId ||
          row.quarantine_object_key !== input.quarantineObjectKey
        ) {
          throw new RepairImageConflictError("intent-invalid");
        }
        if (row.status !== "issued") {
          throw new RepairImageConflictError("intent-replay");
        }
        if (row.expires_at.getTime() <= wallTime.getTime()) {
          throw new RepairImageConflictError("intent-expired");
        }
        if (
          row.declared_content_type !== input.declaredContentType ||
          row.declared_size !== input.size
        ) {
          throw new RepairImageConflictError("content-type-mismatch");
        }
        await client.query(
          `update repair_upload_intents set status = 'uploading'
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, input.intentId],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async completeRepairImageUpload(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const updated = await client.query(
          `update repair_upload_intents
              set status = 'uploaded', uploaded_at = $3
            where sandbox_id = $1 and id = $2 and status = 'uploading'`,
          [input.sandboxId, input.intentId, wallTime],
        );
        if (updated.rowCount !== 1) {
          throw new RepairImageConflictError("intent-replay");
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async prepareRepairImageCompletion(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        await readAuthorizedRepair(client, input, wallTime, "upload");
        const intent = await client.query<RepairImageIntentRow>(
          `select id as intent_id, sandbox_id, repair_id, actor_persona_id,
                  filename_extension, declared_content_type, declared_size,
                  quarantine_object_key, status, expires_at
             from repair_upload_intents
            where sandbox_id = $1 and id = $2 and repair_id = $3
              and actor_persona_id = $4`,
          [input.sandboxId, input.intentId, input.repairId, input.personaId],
        );
        const row = intent.rows[0];
        if (!row) throw new RepairImageConflictError("intent-invalid");
        if (row.status === "consumed" || row.status === "failed") {
          throw new RepairImageConflictError("intent-replay");
        }
        if (row.expires_at.getTime() <= wallTime.getTime()) {
          throw new RepairImageConflictError("intent-expired");
        }
        if (row.status !== "uploaded") {
          throw new RepairImageConflictError("upload-not-staged");
        }
        await client.query("commit");
        return repairImageIntentFromRow(row);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async failRepairImageIntent(input) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        await client.query(
          `update repair_upload_intents
              set status = 'failed', failure_reason = $3
            where sandbox_id = $1 and id = $2
              and status in ('issued', 'uploading', 'uploaded')`,
          [input.sandboxId, input.intentId, input.reason.slice(0, 80)],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async finalizeRepairImage(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const authorized = await readAuthorizedRepair(
          client,
          input,
          wallTime,
          "upload",
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:repair-images:${input.repairId}`],
        );
        const intent = await client.query<RepairImageIntentRow>(
          `select id as intent_id, sandbox_id, repair_id, actor_persona_id,
                  filename_extension, declared_content_type, declared_size,
                  quarantine_object_key, status, expires_at
             from repair_upload_intents
            where sandbox_id = $1 and id = $2 and repair_id = $3
              and actor_persona_id = $4
            for update`,
          [input.sandboxId, input.intentId, input.repairId, input.personaId],
        );
        const intentRow = intent.rows[0];
        if (!intentRow) throw new RepairImageConflictError("intent-invalid");
        if (intentRow.status !== "uploaded") {
          throw new RepairImageConflictError("intent-replay");
        }
        if (intentRow.expires_at.getTime() <= wallTime.getTime()) {
          throw new RepairImageConflictError("intent-expired");
        }
        const count = await client.query<{ count: number }>(
          `select count(*)::integer as count from repair_images
            where sandbox_id = $1 and repair_id = $2`,
          [input.sandboxId, input.repairId],
        );
        if ((count.rows[0]?.count ?? 0) >= 3) {
          throw new RepairImageConflictError("max-images");
        }
        const imageId = randomUUID();
        await client.query(
          `insert into repair_images (
             id, sandbox_id, repair_id, created_by_persona_id, source,
             content_type, object_key, sample_asset_id, byte_size, width,
             height, created_at
           ) values ($1, $2, $3, $4, 'uploaded', $5, $6, null, $7, $8, $9,
             $10)`,
          [
            imageId,
            input.sandboxId,
            input.repairId,
            input.personaId,
            input.contentType,
            input.objectKey,
            input.byteSize,
            input.width,
            input.height,
            wallTime,
          ],
        );
        await client.query(
          `update repair_upload_intents
              set status = 'consumed', consumed_at = $3
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, input.intentId, wallTime],
        );
        await client.query(
          `delete from repair_image_cleanup_jobs
            where sandbox_id = $1 and target_kind = 'object'
              and object_key = any($2::text[]) and status = 'pending'`,
          [input.sandboxId, [input.objectKey, intentRow.quarantine_object_key]],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action,
             object_type, object_id, result, request_id, after_data,
             business_occurred_at, recorded_at
          ) values ($1, $2, $3, $4, $5, 'repair.image-saved',
             'repair', $6, 'allowed', $7, $8::jsonb, $9, $10)`,
          [
            randomUUID(),
            input.sandboxId,
            authorized.repair.store_id,
            input.personaId,
            input.role,
            input.repairId,
            input.requestId,
            JSON.stringify({
              byteSize: input.byteSize,
              contentType: input.contentType,
              height: input.height,
              imageId,
              width: input.width,
            }),
            businessTimeForSandbox(authorized.actor.sandbox, wallTime),
            wallTime,
          ],
        );
        await client.query("commit");
        return {
          byteSize: input.byteSize,
          contentType: input.contentType,
          createdAt: wallTime,
          height: input.height,
          imageId,
          objectKey: input.objectKey,
          repairId: input.repairId,
          sandboxId: input.sandboxId,
          source: "uploaded",
          width: input.width,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readRepairImage(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const actor = await assertRepairActorContext(client, input, wallTime);
        const image = await client.query<RepairImageRow>(
          `select image.id as image_id, image.sandbox_id, image.repair_id,
                  image.source, image.content_type, image.object_key,
                  image.sample_asset_id,
                  image.byte_size, image.width, image.height,
                  image.created_at, repair.store_id,
                  repair.customer_persona_id
             from repair_images image
             join repairs repair on repair.id = image.repair_id
            where image.sandbox_id = $1 and image.id = $2`,
          [input.sandboxId, input.imageId],
        );
        const row = image.rows[0];
        if (
          !row ||
          !canAccessRepair(
            {
              customer_persona_id: row.customer_persona_id,
              repair_id: row.repair_id,
              store_id: row.store_id,
            },
            input,
            actor.storeId,
            "read",
          )
        ) {
          throw new RepairImageConflictError("not-found");
        }
        const result = repairImageFromRow(row);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readRepairImages(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        await readAuthorizedRepair(client, input, wallTime, "read");
        const images = await client.query<RepairImageRow>(
          `select image.id as image_id, image.sandbox_id, image.repair_id,
                  image.source, image.content_type, image.object_key,
                  image.sample_asset_id, image.byte_size, image.width,
                  image.height, image.created_at, repair.store_id,
                  repair.customer_persona_id
             from repair_images image
             join repairs repair on repair.id = image.repair_id
            where image.sandbox_id = $1 and image.repair_id = $2
            order by image.created_at, image.id`,
          [input.sandboxId, input.repairId],
        );
        const result = images.rows.map(repairImageListItemFromRow);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readStaffRepairQueue(input) {
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
        const store = await client.query<{
          code: string;
          display_name: string;
        }>(
          `select code, display_name from stores
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, context.actorStoreId],
        );
        const storeRow = store.rows[0];
        if (!storeRow) throw new RoleContextUnavailableError();
        const repairs = await client.query<{
          created_at: Date;
          created_business_at: Date;
          description: string;
          machine_profile_code: MachineProfileCode;
          machine_profile_display_name: string;
          priority: DatabaseRepairCreated["priority"];
          repair_id: string;
          seat_code: string;
          source: DatabaseRepairCreated["source"];
          status: DatabaseRepairCreated["status"];
        }>(
          `select repair.id as repair_id, repair.description, repair.priority,
                  repair.status, repair.source, repair.created_at,
                  repair.created_business_at, seat.code as seat_code,
                  repair.machine_profile_snapshot->>'code' as machine_profile_code,
                  repair.machine_profile_snapshot->>'displayName'
                    as machine_profile_display_name
             from repairs repair
             join seats seat on seat.id = repair.seat_id
            where repair.sandbox_id = $1 and repair.store_id = $2
            order by case repair.priority
                       when 'urgent' then 0 when 'high' then 1 else 2 end,
                     repair.created_business_at, repair.id`,
          [input.sandboxId, context.actorStoreId],
        );
        await client.query("commit");
        return {
          currentTime,
          rows: repairs.rows.map((row) => ({
            createdAt: row.created_at,
            description: row.description,
            machineProfile: {
              code: row.machine_profile_code,
              displayName: row.machine_profile_display_name,
            },
            priority: row.priority,
            repairId: row.repair_id,
            seat: { code: row.seat_code },
            source: row.source,
            status: row.status,
            waitingMinutes: Math.max(
              0,
              Math.floor(
                (currentTime.getTime() - row.created_business_at.getTime()) /
                  60_000,
              ),
            ),
          })),
          store: {
            code: storeRow.code,
            displayName: storeRow.display_name,
          },
        } satisfies DatabaseStaffRepairQueue;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readStaffRepairIntake(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const handlers = await client.query<{
          display_name: string;
          persona_id: string;
          role: FrontlineRole;
        }>(
          `select persona.id as persona_id, employee.display_name, employee.role
             from employees employee
             join demo_personas persona on persona.id = employee.persona_id
            where employee.sandbox_id = $1 and employee.store_id = $2
              and employee.active = true and employee.role in ('staff', 'manager')
            order by case employee.role when 'staff' then 0 else 1 end,
                     employee.employee_code, employee.id`,
          [input.sandboxId, context.actorStoreId],
        );
        const rows = await client.query<StaffRepairIntakeRow>(
          `select seat.id as seat_id, seat.code as seat_code,
                  seat.operational_status, seat.machine_profile_id,
                  area.code as area_code,
                  area.display_name as area_display_name,
                  profile.code as machine_profile_code,
                  profile.display_name as machine_profile_display_name,
                  profile.experience_description
                    as machine_profile_experience_description,
                  store.id as store_id, store.code as store_code,
                  store.display_name as store_display_name,
                  repair.id as existing_repair_id,
                  repair.status as existing_repair_status
             from seats seat
             join store_areas area on area.id = seat.area_id
             join machine_profiles profile on profile.id = seat.machine_profile_id
             join stores store on store.id = seat.store_id
             left join repairs repair on repair.sandbox_id = seat.sandbox_id
              and repair.seat_id = seat.id and repair.status <> 'closed'
            where seat.sandbox_id = $1 and seat.store_id = $2
              and seat.lifecycle_status = 'active'
              and area.lifecycle_status = 'active'
            order by area.sort_order, seat.sort_order`,
          [input.sandboxId, context.actorStoreId],
        );
        const first = rows.rows[0];
        if (!first) throw new RepairIntakeConflictError("seat-not-found");
        const result: DatabaseStaffRepairIntake = {
          handlers: handlers.rows.map((handler) => ({
            displayName: handler.display_name,
            personaId: handler.persona_id,
            role: handler.role,
          })),
          seats: rows.rows.map((row) => ({
            area: {
              code: row.area_code,
              displayName: row.area_display_name,
            },
            code: row.seat_code,
            existingRepair:
              row.existing_repair_id && row.existing_repair_status
                ? {
                    repairId: row.existing_repair_id,
                    status: row.existing_repair_status,
                  }
                : null,
            id: row.seat_id,
            machineProfile: {
              code: row.machine_profile_code,
              displayName: row.machine_profile_display_name,
            },
            operationalStatus: row.operational_status,
            store: {
              code: row.store_code,
              displayName: row.store_display_name,
            },
          })),
          store: {
            code: first.store_code,
            displayName: first.store_display_name,
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
    async readRepairDetail(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        let authorized: Awaited<ReturnType<typeof readAuthorizedRepair>>;
        try {
          authorized = await readAuthorizedRepair(
            client,
            input,
            wallTime,
            "read",
          );
        } catch (error) {
          if (
            error instanceof RepairImageConflictError &&
            error.reason === "not-found"
          ) {
            throw new RepairCommandConflictError("not-found");
          }
          throw error;
        }
        const currentTime = businessTimeForSandbox(
          authorized.actor.sandbox,
          wallTime,
        );
        const result = await client.query<RepairDetailRow>(
          `select repair.id as repair_id, repair.store_id,
                  repair.reservation_id, repair.source, repair.description,
                  repair.priority, repair.status, repair.created_at,
                  seat.code as seat_code, seat.operational_status,
                  repair.machine_profile_snapshot->>'code'
                    as machine_profile_code,
                  repair.machine_profile_snapshot->>'displayName'
                    as machine_profile_display_name,
                  store.code as store_code,
                  store.display_name as store_display_name,
                  assignee.id as assigned_to_persona_id,
                  assignee.display_name as assigned_to_display_name,
                  assignee.role as assigned_to_role,
                  repair.resolution_note, repair.resolution_business_at,
                  resolution_submitter.id as resolution_submitted_by_persona_id,
                  resolution_submitter.display_name as resolution_submitted_by_display_name,
                  repair.latest_verification_outcome,
                  repair.latest_verification_reason,
                  repair.verification_business_at,
                  verifier.id as verified_by_persona_id,
                  verifier.display_name as verified_by_display_name
             from repairs repair
             join seats seat on seat.id = repair.seat_id
             join stores store on store.id = repair.store_id
             left join demo_personas assignee
               on assignee.id = repair.assigned_to_persona_id
             left join demo_personas resolution_submitter
               on resolution_submitter.id = repair.resolution_submitted_by_persona_id
             left join demo_personas verifier
               on verifier.id = repair.verified_by_persona_id
            where repair.sandbox_id = $1 and repair.id = $2`,
          [input.sandboxId, input.repairId],
        );
        const row = result.rows[0];
        if (!row) throw new RepairCommandConflictError("not-found");
        const events = await client.query<RepairEventRow>(
          `select event_type, event_data, business_occurred_at, recorded_at
             from repair_business_events
            where sandbox_id = $1 and repair_id = $2
            order by sequence, id`,
          [input.sandboxId, input.repairId],
        );
        const impacts = await client.query<{
          before_status: ReservationStatus;
          coupon_restored: boolean;
          customer_display_name: string;
          ends_at: Date;
          outcome: "cancelled" | "completed";
          reservation_id: string;
          simulated_refund_cents: number;
          starts_at: Date;
        }>(
          `select reservation.id as reservation_id,
                  customer.display_name as customer_display_name,
                  reservation.starts_at, reservation.ends_at,
                  event.event_data->>'previousStatus' as before_status,
                  event.event_data->>'outcome' as outcome,
                  coalesce((event.event_data->>'couponRestored')::boolean, false)
                    as coupon_restored,
                  coalesce((event.event_data->>'simulatedRefundCents')::integer, 0)
                    as simulated_refund_cents
             from reservation_business_events event
             join reservations reservation on reservation.id = event.reservation_id
             join demo_personas customer
               on customer.id = reservation.customer_persona_id
            where event.sandbox_id = $1
              and event.event_data->>'repairId' = $2
              and event.event_type in (
                'reservation.cancelled-for-maintenance',
                'reservation.completed-for-maintenance'
              )
              and ($3::boolean = false or reservation.customer_persona_id = $4)
            order by reservation.starts_at, reservation.id`,
          [
            input.sandboxId,
            input.repairId,
            input.role === "customer",
            input.personaId,
          ],
        );
        const frontline = input.role === "staff" || input.role === "manager";
        const canManageRepair =
          frontline &&
          (input.role === "manager" ||
            row.assigned_to_persona_id === input.personaId);
        const availableSpares = frontline
          ? (
              await client.query<{
                available_quantity: number;
                display_name: string;
                inventory_item_id: string;
                on_hand_quantity: number;
              }>(
                `select id as inventory_item_id, display_name,
                        on_hand_quantity,
                        on_hand_quantity - reserved_quantity as available_quantity
                   from inventory_items
                  where sandbox_id = $1 and store_id = $2 and kind = 'spare'
                  order by display_name, id`,
                [input.sandboxId, row.store_id],
              )
            ).rows
          : [];
        const usageRows = frontline
          ? (
              await client.query<{
                claimed_at: Date;
                claimed_by_display_name: string;
                claimed_by_persona_id: string;
                display_name: string;
                inventory_item_id: string;
                movement_id: string;
                quantity: number;
                recorded_at: Date;
                returned_quantity: number;
                usage_id: string;
              }>(
                `select usage.id as usage_id, usage.inventory_item_id,
                        item.display_name, usage.quantity,
                        usage.returned_quantity,
                        usage.inventory_movement_id as movement_id,
                        usage.business_occurred_at as claimed_at,
                        usage.recorded_at,
                        actor.id as claimed_by_persona_id,
                        actor.display_name as claimed_by_display_name
                   from repair_spare_usages usage
                   join inventory_items item on item.id = usage.inventory_item_id
                   join demo_personas actor on actor.id = usage.claimed_by_persona_id
                  where usage.sandbox_id = $1 and usage.repair_id = $2
                  order by usage.business_occurred_at, usage.recorded_at, usage.id`,
                [input.sandboxId, input.repairId],
              )
            ).rows
          : [];
        const returnRows = frontline
          ? (
              await client.query<{
                movement_id: string;
                quantity: number;
                recorded_at: Date;
                return_id: string;
                returned_at: Date;
                returned_by_display_name: string;
                returned_by_persona_id: string;
                usage_id: string;
              }>(
                `select spare_return.id as return_id, spare_return.usage_id,
                        spare_return.inventory_movement_id as movement_id,
                        spare_return.quantity,
                        spare_return.business_occurred_at as returned_at,
                        spare_return.recorded_at,
                        actor.id as returned_by_persona_id,
                        actor.display_name as returned_by_display_name
                   from repair_spare_returns spare_return
                   join demo_personas actor
                     on actor.id = spare_return.returned_by_persona_id
                  where spare_return.sandbox_id = $1
                    and spare_return.repair_id = $2
                  order by spare_return.business_occurred_at,
                           spare_return.recorded_at, spare_return.id`,
                [input.sandboxId, input.repairId],
              )
            ).rows
          : [];
        const internal =
          input.role === "customer"
            ? null
            : {
                audits: (
                  await client.query<{
                    action: string;
                    actor_display_name: string | null;
                    actor_persona_id: string | null;
                    business_occurred_at: Date;
                    recorded_at: Date;
                    result: "allowed" | "denied";
                  }>(
                    `select audit.action, audit.result,
                            audit.business_occurred_at, audit.recorded_at,
                            actor.id as actor_persona_id,
                            actor.display_name as actor_display_name
                       from audit_events audit
                       left join demo_personas actor on actor.id = audit.persona_id
                      where audit.sandbox_id = $1 and (
                        (audit.object_type = 'repair' and audit.object_id = $2::uuid)
                        or audit.after_data->>'repairId' = $2::text
                      )
                      order by audit.recorded_at, audit.id`,
                    [input.sandboxId, input.repairId],
                  )
                ).rows.map((audit) => ({
                  action: audit.action,
                  actor:
                    audit.actor_persona_id && audit.actor_display_name
                      ? {
                          displayName: audit.actor_display_name,
                          personaId: audit.actor_persona_id,
                        }
                      : null,
                  occurredAt: audit.business_occurred_at,
                  recordedAt: audit.recorded_at,
                  result: audit.result,
                })),
                events: events.rows.map((event) => ({
                  actor:
                    event.event_data.actorPersonaId &&
                    event.event_data.actorDisplayName
                      ? {
                          displayName: event.event_data.actorDisplayName,
                          personaId: event.event_data.actorPersonaId,
                        }
                      : null,
                  occurredAt: event.business_occurred_at,
                  recordedAt: event.recorded_at,
                  type: event.event_type,
                })),
                notes: frontline
                  ? events.rows.flatMap((event) =>
                      typeof event.event_data.internalNote === "string" &&
                      event.event_data.internalNote.length > 0
                        ? [event.event_data.internalNote]
                        : [],
                    )
                  : [],
              };
        const detail: DatabaseRepairDetail = {
          actions: {
            canAssign: frontline && row.status === "new",
            canClaimSpare: canManageRepair && row.status === "processing",
            canReturnSpare:
              canManageRepair &&
              row.status !== "closed" &&
              usageRows.some(
                (usage) => usage.returned_quantity < usage.quantity,
              ),
            canStart:
              frontline &&
              row.status === "assigned" &&
              (input.role === "manager" ||
                row.assigned_to_persona_id === input.personaId),
            canSubmitResolution: canManageRepair && row.status === "processing",
            canVerify:
              frontline &&
              row.status === "verification" &&
              row.assigned_to_persona_id !== input.personaId,
          },
          assignedTo:
            input.role !== "customer" &&
            row.assigned_to_persona_id &&
            row.assigned_to_display_name &&
            row.assigned_to_role
              ? {
                  displayName: row.assigned_to_display_name,
                  personaId: row.assigned_to_persona_id,
                  role: row.assigned_to_role,
                }
              : null,
          currentTime,
          description: row.description,
          impacts: impacts.rows.map((impact) => ({
            beforeStatus: impact.before_status,
            couponRestored: impact.coupon_restored,
            customerDisplayName:
              input.role === "customer" ? null : impact.customer_display_name,
            outcome: impact.outcome,
            reservationId: impact.reservation_id,
            simulatedRefundCents: impact.simulated_refund_cents,
            window: {
              endsAt: impact.ends_at,
              startsAt: impact.starts_at,
            },
          })),
          internal,
          machineProfile: {
            code: row.machine_profile_code,
            displayName: row.machine_profile_display_name,
          },
          priority: row.priority,
          publicUpdates: events.rows.flatMap((event) =>
            typeof event.event_data.publicNote === "string" &&
            event.event_data.publicNote.length > 0
              ? [
                  {
                    note: event.event_data.publicNote,
                    occurredAt: event.business_occurred_at,
                    type: event.event_type,
                  },
                ]
              : [],
          ),
          repairId: row.repair_id,
          resolution:
            row.resolution_note && row.resolution_business_at
              ? {
                  note: row.resolution_note,
                  submittedAt: row.resolution_business_at,
                  submittedBy:
                    input.role !== "customer" &&
                    row.resolution_submitted_by_persona_id &&
                    row.resolution_submitted_by_display_name
                      ? {
                          displayName: row.resolution_submitted_by_display_name,
                          personaId: row.resolution_submitted_by_persona_id,
                        }
                      : null,
                }
              : null,
          reservationId: row.reservation_id,
          seat: {
            code: row.seat_code,
            operationalStatus: row.operational_status,
          },
          source: row.source,
          spares: frontline
            ? {
                available: availableSpares.map((item) => ({
                  availableQuantity: item.available_quantity,
                  displayName: item.display_name,
                  inventoryItemId: item.inventory_item_id,
                  onHandQuantity: item.on_hand_quantity,
                })),
                usages: usageRows.map((usage) => ({
                  claimedAt: usage.claimed_at,
                  claimedBy: {
                    displayName: usage.claimed_by_display_name,
                    personaId: usage.claimed_by_persona_id,
                  },
                  consumedQuantity: usage.quantity - usage.returned_quantity,
                  inventoryItem: {
                    displayName: usage.display_name,
                    inventoryItemId: usage.inventory_item_id,
                  },
                  movementId: usage.movement_id,
                  quantity: usage.quantity,
                  recordedAt: usage.recorded_at,
                  returnedQuantity: usage.returned_quantity,
                  returns: returnRows
                    .filter((item) => item.usage_id === usage.usage_id)
                    .map((item) => ({
                      movementId: item.movement_id,
                      quantity: item.quantity,
                      recordedAt: item.recorded_at,
                      returnedAt: item.returned_at,
                      returnedBy: {
                        displayName: item.returned_by_display_name,
                        personaId: item.returned_by_persona_id,
                      },
                      returnId: item.return_id,
                    })),
                  usageId: usage.usage_id,
                })),
              }
            : null,
          status: row.status,
          latestVerification:
            row.latest_verification_outcome &&
            row.latest_verification_reason &&
            row.verification_business_at
              ? {
                  outcome: row.latest_verification_outcome,
                  reason: row.latest_verification_reason,
                  verifiedAt: row.verification_business_at,
                  verifiedBy:
                    input.role !== "customer" &&
                    row.verified_by_persona_id &&
                    row.verified_by_display_name
                      ? {
                          displayName: row.verified_by_display_name,
                          personaId: row.verified_by_persona_id,
                        }
                      : null,
                }
              : null,
          store: {
            code: row.store_code,
            displayName: row.store_display_name,
          },
        };
        await client.query("commit");
        return detail;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async executeRepairCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const businessTime = businessTimeForSandbox(context.sandbox, wallTime);
        const deny = async (
          reason: RepairCommandConflictReason,
          currentStatus: string | null = null,
        ): Promise<never> => {
          await recordRepairCommandDenial(client, {
            action: input.action,
            actorStoreId: context.actorStoreId,
            businessTime,
            currentStatus,
            personaId: input.personaId,
            reason,
            recordedAt: wallTime,
            repairId: input.repairId,
            requestId: input.requestId,
            role: input.role,
            sandboxId: input.sandboxId,
          });
          await client.query("commit");
          throw new RepairCommandConflictError(reason, currentStatus);
        };
        const publicNote = input.publicNote.normalize("NFC").trim();
        const internalNote = input.internalNote.normalize("NFC").trim();
        if (
          !isSafePlainTextReason(publicNote, 500) ||
          !isSafePlainTextReason(internalNote, 500)
        ) {
          await deny("note-invalid");
        }
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({
            action: input.action,
            assigneePersonaId: input.assigneePersonaId,
            internalNote,
            priority: input.priority,
            publicNote,
            repairId: input.repairId,
          }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:repair-state:${input.action}:${idempotencyKeyHash}`,
          ],
        );
        const previous = await client.query<RepairStateCommandRow>(
          `select payload_hash, result_data
             from repair_state_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and command_type = $3 and idempotency_key_hash = $4`,
          [input.sandboxId, input.personaId, input.action, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            await deny("idempotency-conflict");
          }
          await client.query("commit");
          return repairCommandFromStored(previousRow.result_data, true);
        }
        const repairs = await client.query<{
          assigned_to_persona_id: string | null;
          operational_status: "maintenance" | "normal";
          seat_id: string;
          status: DatabaseRepairCreated["status"];
          store_id: string;
        }>(
          `select repair.store_id, repair.seat_id, repair.status,
                  repair.assigned_to_persona_id, seat.operational_status
             from repairs repair
             join seats seat on seat.id = repair.seat_id
            where repair.sandbox_id = $1 and repair.id = $2
            for update of repair, seat`,
          [input.sandboxId, input.repairId],
        );
        const repair = repairs.rows[0];
        if (!repair) return await deny("not-found");
        if (repair.store_id !== context.actorStoreId) {
          await deny("cross-store");
        }
        if (input.action === "assign" && repair.status !== "new") {
          await deny("illegal-transition", repair.status);
        }
        if (
          input.action === "assign" &&
          (!input.assigneePersonaId || !input.priority)
        ) {
          await deny("assignee-not-found", repair.status);
        }
        if (input.action === "assign") {
          const assignees = await client.query<{
            display_name: string;
            role: FrontlineRole;
          }>(
            `select employee.display_name, employee.role
               from employees employee
               join demo_personas persona on persona.id = employee.persona_id
              where employee.sandbox_id = $1 and persona.id = $2
                and employee.store_id = $3 and employee.active = true
                and employee.role in ('staff', 'manager')`,
            [input.sandboxId, input.assigneePersonaId, context.actorStoreId],
          );
          const assignee = assignees.rows[0];
          if (!assignee) {
            return await deny("assignee-not-found", repair.status);
          }
          const updated = await client.query(
            `update repairs
              set status = 'assigned', priority = $3,
                  assigned_to_persona_id = $4, assigned_business_at = $5
            where sandbox_id = $1 and id = $2 and status = 'new'`,
            [
              input.sandboxId,
              input.repairId,
              input.priority,
              input.assigneePersonaId,
              businessTime,
            ],
          );
          if (updated.rowCount !== 1) {
            throw new RepairCommandConflictError(
              "illegal-transition",
              repair.status,
            );
          }
          await client.query(
            `insert into repair_business_events (
             id, sandbox_id, repair_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, 'repair.assigned', $4::jsonb, $5, $6)`,
            [
              randomUUID(),
              input.sandboxId,
              input.repairId,
              JSON.stringify({
                assigneeDisplayName: assignee.display_name,
                assigneePersonaId: input.assigneePersonaId,
                assigneeRole: assignee.role,
                internalNote,
                priority: input.priority,
                publicNote,
              }),
              businessTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, 'repair.assign', 'repair', $6,
             'allowed', $7, $8::jsonb, $9::jsonb, $10, $11)`,
            [
              randomUUID(),
              input.sandboxId,
              repair.store_id,
              input.personaId,
              input.role,
              input.repairId,
              input.requestId,
              JSON.stringify({ status: "new" }),
              JSON.stringify({
                assigneePersonaId: input.assigneePersonaId,
                priority: input.priority,
                status: "assigned",
              }),
              businessTime,
              wallTime,
            ],
          );
          const stored: RepairStateCommandRow["result_data"] = {
            action: "assign",
            affectedReservations: [],
            occurredAt: businessTime.toISOString(),
            repairId: input.repairId,
            seatOperationalStatus: repair.operational_status,
            status: "assigned",
          };
          await client.query(
            `insert into repair_state_command_requests (
             sandbox_id, actor_persona_id, repair_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
            [
              input.sandboxId,
              input.personaId,
              input.repairId,
              input.action,
              idempotencyKeyHash,
              payloadHash,
              JSON.stringify(stored),
            ],
          );
          await client.query("commit");
          return repairCommandFromStored(stored, false);
        }
        if (repair.status !== "assigned") {
          await deny("illegal-transition", repair.status);
        }
        if (
          input.role !== "manager" &&
          repair.assigned_to_persona_id !== input.personaId
        ) {
          await deny("not-assignee", repair.status);
        }
        await processFrontlineReservationDeadlines(client, {
          currentTime: businessTime,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
        });
        const reservations = await client.query<{
          coupon_id: string | null;
          customer_persona_id: string;
          ends_at: Date;
          id: string;
          price_snapshot: ReservationSnapshotRecord;
          starts_at: Date;
          status: "arrived" | "confirmed" | "in-use" | "pending-confirmation";
        }>(
          `select id, customer_persona_id, coupon_id, status, starts_at,
                  ends_at, price_snapshot
            from reservations
            where sandbox_id = $1 and seat_id = $2
              and status in ('pending-confirmation', 'confirmed', 'arrived', 'in-use')
            order by starts_at, id
            for update`,
          [input.sandboxId, repair.seat_id],
        );
        const affectedReservations: Array<
          DatabaseRepairCommand["affectedReservations"][number]
        > = [];
        for (const reservation of reservations.rows) {
          const isInUse = reservation.status === "in-use";
          const couponRestored = reservation.coupon_id !== null && !isInUse;
          if (couponRestored) {
            const expectedCouponStatus =
              reservation.status === "pending-confirmation"
                ? "reserved"
                : "redeemed";
            const restored = await client.query(
              `update experience_coupons
                  set status = 'available', reserved_reservation_id = null,
                      reserved_until = null
                where sandbox_id = $1 and reserved_reservation_id = $2
                  and status = $3`,
              [input.sandboxId, reservation.id, expectedCouponStatus],
            );
            if (restored.rowCount !== 1) {
              throw new Error(
                "The repair maintenance coupon could not be restored.",
              );
            }
          }
          const simulatedRefundCents =
            reservation.status === "pending-confirmation"
              ? 0
              : isInUse
                ? Math.min(
                    reservation.price_snapshot.price.payableCents,
                    reservation.price_snapshot.price.segments
                      .filter(
                        (segment) =>
                          new Date(segment.startsAt).getTime() >=
                          businessTime.getTime(),
                      )
                      .reduce(
                        (total, segment) => total + segment.amountCents,
                        0,
                      ),
                  )
                : reservation.price_snapshot.price.payableCents;
          if (simulatedRefundCents > 0) {
            await client.query(
              `insert into reservation_simulated_refunds (
                 id, sandbox_id, reservation_id, amount_cents, reason,
                 business_occurred_at, recorded_at
               ) values ($1, $2, $3, $4, 'repair-device-failure', $5, $6)`,
              [
                randomUUID(),
                input.sandboxId,
                reservation.id,
                simulatedRefundCents,
                businessTime,
                wallTime,
              ],
            );
          }
          const nextStatus = isInUse ? "completed" : "cancelled";
          const updatedReservation = await client.query(
            isInUse
              ? `update reservations
                    set status = 'completed', completed_business_at = $3,
                        terminal_reason = 'repair-device-failure'
                  where sandbox_id = $1 and id = $2 and status = $4`
              : `update reservations
                    set status = 'cancelled', cancelled_business_at = $3,
                        terminal_reason = 'repair-device-failure'
                  where sandbox_id = $1 and id = $2 and status = $4`,
            [input.sandboxId, reservation.id, businessTime, reservation.status],
          );
          if (updatedReservation.rowCount !== 1) {
            throw new Error(
              "The repair maintenance reservation could not be updated.",
            );
          }
          await processCustomerOrderDeadlines(client, {
            recordedAt: wallTime,
            reservationId: reservation.id,
            sandboxId: input.sandboxId,
            targetBusinessTime: businessTime,
          });
          const growthPoints = isInUse
            ? await awardCompletedReservationGrowth(client, {
                businessOccurredAt: businessTime,
                customerPersonaId: reservation.customer_persona_id,
                payableCents: reservation.price_snapshot.price.payableCents,
                recordedAt: wallTime,
                reservationId: reservation.id,
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
              reservation.id,
              isInUse
                ? "reservation.completed-for-maintenance"
                : "reservation.cancelled-for-maintenance",
              JSON.stringify({
                couponRestored,
                growthPoints,
                outcome: nextStatus,
                previousStatus: reservation.status,
                repairId: input.repairId,
                simulatedRefundCents,
              }),
              businessTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action, object_type,
               object_id, result, reason, request_id, before_data, after_data,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, $5, $6, 'reservation', $7, 'allowed',
               'repair-device-failure', $8, $9::jsonb, $10::jsonb, $11, $12)`,
            [
              randomUUID(),
              input.sandboxId,
              repair.store_id,
              input.personaId,
              input.role,
              isInUse
                ? "reservation.repair-maintenance-complete"
                : "reservation.repair-maintenance-cancel",
              reservation.id,
              input.requestId,
              JSON.stringify({ status: reservation.status }),
              JSON.stringify({
                couponRestored,
                repairId: input.repairId,
                simulatedRefundCents,
                status: nextStatus,
              }),
              businessTime,
              wallTime,
            ],
          );
          affectedReservations.push({
            couponRestored,
            outcome: nextStatus,
            reservationId: reservation.id,
            simulatedRefundCents,
          });
        }
        const maintained = await client.query(
          `update seats set operational_status = 'maintenance'
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, repair.seat_id],
        );
        if (maintained.rowCount !== 1) {
          throw new Error("The repair seat could not enter maintenance.");
        }
        const started = await client.query(
          `update repairs
              set status = 'processing', processing_business_at = $3
            where sandbox_id = $1 and id = $2 and status = 'assigned'`,
          [input.sandboxId, input.repairId, businessTime],
        );
        if (started.rowCount !== 1) {
          throw new RepairCommandConflictError(
            "illegal-transition",
            repair.status,
          );
        }
        await client.query(
          `insert into repair_business_events (
             id, sandbox_id, repair_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, 'repair.processing-started', $4::jsonb, $5, $6)`,
          [
            randomUUID(),
            input.sandboxId,
            input.repairId,
            JSON.stringify({ affectedReservations, internalNote, publicNote }),
            businessTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, 'repair.start', 'repair', $6,
             'allowed', $7, $8::jsonb, $9::jsonb, $10, $11)`,
          [
            randomUUID(),
            input.sandboxId,
            repair.store_id,
            input.personaId,
            input.role,
            input.repairId,
            input.requestId,
            JSON.stringify({
              seatOperationalStatus: repair.operational_status,
              status: repair.status,
            }),
            JSON.stringify({
              affectedReservations,
              seatOperationalStatus: "maintenance",
              status: "processing",
            }),
            businessTime,
            wallTime,
          ],
        );
        const stored: RepairStateCommandRow["result_data"] = {
          action: "start",
          affectedReservations,
          occurredAt: businessTime.toISOString(),
          repairId: input.repairId,
          seatOperationalStatus: "maintenance",
          status: "processing",
        };
        await client.query(
          `insert into repair_state_command_requests (
             sandbox_id, actor_persona_id, repair_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            input.repairId,
            input.action,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return repairCommandFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async executeRepairSpareCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      const commandType =
        input.action === "claim" ? "spare-claim" : "spare-return";
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const businessTime = businessTimeForSandbox(context.sandbox, wallTime);
        const deny = async (
          reason: RepairCommandConflictReason,
          currentStatus: string | null = null,
        ): Promise<never> => {
          await recordRepairCommandDenial(client, {
            action: commandType,
            actorStoreId: context.actorStoreId,
            businessTime,
            currentStatus,
            personaId: input.personaId,
            reason,
            recordedAt: wallTime,
            repairId: input.repairId,
            requestId: input.requestId,
            role: input.role,
            sandboxId: input.sandboxId,
          });
          await client.query("commit");
          throw new RepairCommandConflictError(reason, currentStatus);
        };
        if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
          await deny("quantity-invalid");
        }
        if (input.action === "claim" && !input.inventoryItemId) {
          await deny("inventory-item-not-found");
        }
        if (input.action === "return" && !input.usageId) {
          await deny("usage-not-found");
        }
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({
            action: input.action,
            inventoryItemId: input.inventoryItemId!,
            quantity: input.quantity,
            repairId: input.repairId,
            usageId: input.usageId,
          }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:repair-state:${commandType}:${idempotencyKeyHash}`,
          ],
        );
        const previous = await client.query<RepairSpareCommandRow>(
          `select payload_hash, result_data
             from repair_state_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and command_type = $3 and idempotency_key_hash = $4`,
          [input.sandboxId, input.personaId, commandType, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            await deny("idempotency-conflict");
          }
          await client.query("commit");
          return repairSpareCommandFromStored(previousRow.result_data, true);
        }
        const repairs = await client.query<{
          assigned_to_persona_id: string | null;
          status: DatabaseRepairCreated["status"];
          store_id: string;
        }>(
          `select store_id, status, assigned_to_persona_id
             from repairs
            where sandbox_id = $1 and id = $2
            for update`,
          [input.sandboxId, input.repairId],
        );
        const repair = repairs.rows[0];
        if (!repair) return await deny("not-found");
        if (repair.store_id !== context.actorStoreId) {
          await deny("cross-store", repair.status);
        }
        if (
          (input.action === "claim" && repair.status !== "processing") ||
          (input.action === "return" && repair.status === "closed")
        ) {
          await deny("illegal-transition", repair.status);
        }
        if (
          input.role !== "manager" &&
          repair.assigned_to_persona_id !== input.personaId
        ) {
          await deny("not-assignee", repair.status);
        }
        const actors = await client.query<{ display_name: string }>(
          `select display_name from demo_personas
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, input.personaId],
        );
        const actorDisplayName = actors.rows[0]?.display_name;
        if (!actorDisplayName) throw new RoleContextUnavailableError();
        if (input.action === "return") {
          const usages = await client.query<{
            display_name: string;
            inventory_item_id: string;
            on_hand_quantity: number;
            quantity: number;
            returned_quantity: number;
          }>(
            `select item.display_name, item.id as inventory_item_id,
                    item.on_hand_quantity, usage.quantity,
                    usage.returned_quantity
               from repair_spare_usages usage
               join inventory_items item on item.id = usage.inventory_item_id
              where usage.sandbox_id = $1 and usage.repair_id = $2
                and usage.id = $3 and item.store_id = $4
              for update of usage, item`,
            [
              input.sandboxId,
              input.repairId,
              input.usageId,
              context.actorStoreId,
            ],
          );
          const usage = usages.rows[0];
          if (!usage) return await deny("usage-not-found", repair.status);
          if (usage.returned_quantity + input.quantity > usage.quantity) {
            await deny("return-exceeds-claim", repair.status);
          }
          const returnedQuantity = usage.returned_quantity + input.quantity;
          const onHandAfter = usage.on_hand_quantity + input.quantity;
          const updatedUsage = await client.query(
            `update repair_spare_usages
                set returned_quantity = $4
              where sandbox_id = $1 and repair_id = $2 and id = $3
                and returned_quantity + $5 <= quantity`,
            [
              input.sandboxId,
              input.repairId,
              input.usageId,
              returnedQuantity,
              input.quantity,
            ],
          );
          if (updatedUsage.rowCount !== 1) {
            throw new RepairCommandConflictError(
              "return-exceeds-claim",
              repair.status,
            );
          }
          const updatedItem = await client.query(
            `update inventory_items
                set on_hand_quantity = $4
              where sandbox_id = $1 and id = $2 and store_id = $3`,
            [
              input.sandboxId,
              usage.inventory_item_id,
              context.actorStoreId,
              onHandAfter,
            ],
          );
          if (updatedItem.rowCount !== 1) {
            throw new RepairCommandConflictError(
              "inventory-item-not-found",
              repair.status,
            );
          }
          const movementId = randomUUID();
          const returnId = randomUUID();
          await client.query(
            `insert into inventory_movements (
               id, sandbox_id, store_id, inventory_item_id, order_id,
               repair_id, movement_kind, reason, on_hand_delta, on_hand_after,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, null, $5, 'spare-return',
               'repair-spare-return', $6, $7, $8, $9)`,
            [
              movementId,
              input.sandboxId,
              context.actorStoreId,
              usage.inventory_item_id,
              input.repairId,
              input.quantity,
              onHandAfter,
              businessTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into repair_spare_returns (
               id, sandbox_id, repair_id, usage_id, returned_by_persona_id,
               inventory_movement_id, quantity, business_occurred_at,
               recorded_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              returnId,
              input.sandboxId,
              input.repairId,
              input.usageId,
              input.personaId,
              movementId,
              input.quantity,
              businessTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into repair_business_events (
               id, sandbox_id, repair_id, event_type, event_data,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, 'repair.spare-returned', $4::jsonb, $5, $6)`,
            [
              randomUUID(),
              input.sandboxId,
              input.repairId,
              JSON.stringify({
                actorDisplayName,
                actorPersonaId: input.personaId,
                inventoryItemDisplayName: usage.display_name,
                inventoryItemId: usage.inventory_item_id,
                movementId,
                quantity: input.quantity,
                returnId,
                returnedQuantity,
                usageId: input.usageId,
              }),
              businessTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action, object_type,
               object_id, result, request_id, before_data, after_data,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, $5, 'repair.spare-return', 'repair',
               $6, 'allowed', $7, $8::jsonb, $9::jsonb, $10, $11)`,
            [
              randomUUID(),
              input.sandboxId,
              context.actorStoreId,
              input.personaId,
              input.role,
              input.repairId,
              input.requestId,
              JSON.stringify({
                returnedQuantity: usage.returned_quantity,
                status: repair.status,
              }),
              JSON.stringify({
                movementId,
                onHandQuantity: onHandAfter,
                quantity: input.quantity,
                repairId: input.repairId,
                returnedQuantity,
                status: repair.status,
                usageId: input.usageId,
              }),
              businessTime,
              wallTime,
            ],
          );
          const stored: RepairSpareCommandRow["result_data"] = {
            action: "return",
            businessOccurredAt: businessTime.toISOString(),
            inventoryItem: {
              displayName: usage.display_name,
              inventoryItemId: usage.inventory_item_id,
            },
            movementId,
            onHandAfter,
            quantity: input.quantity,
            recordedAt: wallTime.toISOString(),
            repairId: input.repairId,
            returnedQuantity,
            usageId: input.usageId!,
          };
          await client.query(
            `insert into repair_state_command_requests (
               sandbox_id, actor_persona_id, repair_id, command_type,
               idempotency_key_hash, payload_hash, result_data
             ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
            [
              input.sandboxId,
              input.personaId,
              input.repairId,
              commandType,
              idempotencyKeyHash,
              payloadHash,
              JSON.stringify(stored),
            ],
          );
          await client.query("commit");
          return repairSpareCommandFromStored(stored, false);
        }
        const items = await client.query<{
          available_quantity: number;
          display_name: string;
          on_hand_quantity: number;
        }>(
          `select display_name, on_hand_quantity,
                  on_hand_quantity - reserved_quantity as available_quantity
             from inventory_items
            where sandbox_id = $1 and id = $2 and store_id = $3
              and kind = 'spare'
            for update`,
          [input.sandboxId, input.inventoryItemId, context.actorStoreId],
        );
        const item = items.rows[0];
        if (!item) {
          return await deny("inventory-item-not-found", repair.status);
        }
        if (item.available_quantity < input.quantity) {
          await deny("inventory-insufficient", repair.status);
        }
        const onHandAfter = item.on_hand_quantity - input.quantity;
        const updated = await client.query(
          `update inventory_items
              set on_hand_quantity = $4
            where sandbox_id = $1 and id = $2 and store_id = $3
              and on_hand_quantity - reserved_quantity >= $5`,
          [
            input.sandboxId,
            input.inventoryItemId,
            context.actorStoreId,
            onHandAfter,
            input.quantity,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new RepairCommandConflictError(
            "inventory-insufficient",
            repair.status,
          );
        }
        const movementId = randomUUID();
        const usageId = randomUUID();
        await client.query(
          `insert into inventory_movements (
             id, sandbox_id, store_id, inventory_item_id, order_id,
             repair_id, movement_kind, reason, on_hand_delta, on_hand_after,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, null, $5, 'spare-usage',
             'repair-spare-claim', $6, $7, $8, $9)`,
          [
            movementId,
            input.sandboxId,
            context.actorStoreId,
            input.inventoryItemId,
            input.repairId,
            -input.quantity,
            onHandAfter,
            businessTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into repair_spare_usages (
             id, sandbox_id, repair_id, inventory_item_id,
             claimed_by_persona_id, inventory_movement_id, quantity,
             returned_quantity, business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9)`,
          [
            usageId,
            input.sandboxId,
            input.repairId,
            input.inventoryItemId,
            input.personaId,
            movementId,
            input.quantity,
            businessTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into repair_business_events (
             id, sandbox_id, repair_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, 'repair.spare-claimed', $4::jsonb, $5, $6)`,
          [
            randomUUID(),
            input.sandboxId,
            input.repairId,
            JSON.stringify({
              actorDisplayName,
              actorPersonaId: input.personaId,
              inventoryItemDisplayName: item.display_name,
              inventoryItemId: input.inventoryItemId,
              movementId,
              quantity: input.quantity,
              usageId,
            }),
            businessTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, 'repair.spare-claim', 'repair', $6,
             'allowed', $7, $8::jsonb, $9::jsonb, $10, $11)`,
          [
            randomUUID(),
            input.sandboxId,
            context.actorStoreId,
            input.personaId,
            input.role,
            input.repairId,
            input.requestId,
            JSON.stringify({
              availableQuantity: item.available_quantity,
              onHandQuantity: item.on_hand_quantity,
              status: repair.status,
            }),
            JSON.stringify({
              inventoryItemId: input.inventoryItemId,
              movementId,
              onHandQuantity: onHandAfter,
              quantity: input.quantity,
              repairId: input.repairId,
              status: repair.status,
              usageId,
            }),
            businessTime,
            wallTime,
          ],
        );
        const stored: RepairSpareCommandRow["result_data"] = {
          action: "claim",
          businessOccurredAt: businessTime.toISOString(),
          inventoryItem: {
            displayName: item.display_name,
            inventoryItemId: input.inventoryItemId!,
          },
          movementId,
          onHandAfter,
          quantity: input.quantity,
          recordedAt: wallTime.toISOString(),
          repairId: input.repairId,
          returnedQuantity: 0,
          usageId,
        };
        await client.query(
          `insert into repair_state_command_requests (
             sandbox_id, actor_persona_id, repair_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            input.repairId,
            commandType,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return repairSpareCommandFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async executeRepairResolutionCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      const commandType = "submit-resolution" as const;
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const businessTime = businessTimeForSandbox(context.sandbox, wallTime);
        const deny = async (
          reason: RepairCommandConflictReason,
          currentStatus: string | null = null,
        ): Promise<never> => {
          await recordRepairCommandDenial(client, {
            action: commandType,
            actorStoreId: context.actorStoreId,
            businessTime,
            currentStatus,
            personaId: input.personaId,
            reason,
            recordedAt: wallTime,
            repairId: input.repairId,
            requestId: input.requestId,
            role: input.role,
            sandboxId: input.sandboxId,
          });
          await client.query("commit");
          throw new RepairCommandConflictError(reason, currentStatus);
        };
        const resolutionNote = input.resolutionNote.normalize("NFC").trim();
        if (!isSafePlainTextReason(resolutionNote, 500)) {
          await deny("note-invalid");
        }
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({ repairId: input.repairId, resolutionNote }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:repair-state:${commandType}:${idempotencyKeyHash}`,
          ],
        );
        const previous = await client.query<RepairResolutionCommandRow>(
          `select payload_hash, result_data
             from repair_state_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and command_type = $3 and idempotency_key_hash = $4`,
          [input.sandboxId, input.personaId, commandType, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            await deny("idempotency-conflict");
          }
          await client.query("commit");
          return repairResolutionCommandFromStored(
            previousRow.result_data,
            true,
          );
        }
        const repairs = await client.query<{
          assigned_to_persona_id: string | null;
          operational_status: "maintenance" | "normal";
          status: DatabaseRepairCreated["status"];
          store_id: string;
        }>(
          `select repair.store_id, repair.status,
                  repair.assigned_to_persona_id, seat.operational_status
             from repairs repair
             join seats seat on seat.id = repair.seat_id
            where repair.sandbox_id = $1 and repair.id = $2
            for update of repair, seat`,
          [input.sandboxId, input.repairId],
        );
        const repair = repairs.rows[0];
        if (!repair) return await deny("not-found");
        if (repair.store_id !== context.actorStoreId) {
          await deny("cross-store", repair.status);
        }
        if (repair.status !== "processing") {
          await deny("illegal-transition", repair.status);
        }
        if (
          input.role !== "manager" &&
          repair.assigned_to_persona_id !== input.personaId
        ) {
          await deny("not-assignee", repair.status);
        }
        if (repair.operational_status !== "maintenance") {
          throw new Error(
            "A processing repair must keep its seat in maintenance.",
          );
        }
        const actors = await client.query<{ display_name: string }>(
          `select display_name from demo_personas
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, input.personaId],
        );
        const actorDisplayName = actors.rows[0]?.display_name;
        if (!actorDisplayName) throw new RoleContextUnavailableError();
        const updated = await client.query(
          `update repairs
              set status = 'verification', resolution_note = $3,
                  resolution_submitted_by_persona_id = $4,
                  resolution_business_at = $5,
                  latest_verification_outcome = null,
                  latest_verification_reason = null,
                  verified_by_persona_id = null,
                  verification_business_at = null
            where sandbox_id = $1 and id = $2 and status = 'processing'`,
          [
            input.sandboxId,
            input.repairId,
            resolutionNote,
            input.personaId,
            businessTime,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new RepairCommandConflictError(
            "illegal-transition",
            repair.status,
          );
        }
        await client.query(
          `insert into repair_business_events (
             id, sandbox_id, repair_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, 'repair.resolution-submitted', $4::jsonb,
             $5, $6)`,
          [
            randomUUID(),
            input.sandboxId,
            input.repairId,
            JSON.stringify({
              actorDisplayName,
              actorPersonaId: input.personaId,
              publicNote: resolutionNote,
              resolutionNote,
            }),
            businessTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, 'repair.submit-resolution',
             'repair', $6, 'allowed', $7, $8::jsonb, $9::jsonb, $10, $11)`,
          [
            randomUUID(),
            input.sandboxId,
            context.actorStoreId,
            input.personaId,
            input.role,
            input.repairId,
            input.requestId,
            JSON.stringify({ status: repair.status }),
            JSON.stringify({
              resolutionNote,
              status: "verification",
            }),
            businessTime,
            wallTime,
          ],
        );
        const stored: RepairResolutionCommandRow["result_data"] = {
          occurredAt: businessTime.toISOString(),
          recordedAt: wallTime.toISOString(),
          repairId: input.repairId,
          seatOperationalStatus: "maintenance",
          status: "verification",
        };
        await client.query(
          `insert into repair_state_command_requests (
             sandbox_id, actor_persona_id, repair_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            input.repairId,
            commandType,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return repairResolutionCommandFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async executeRepairVerificationCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      const commandType =
        input.outcome === "success" ? "verify-success" : "verify-failure";
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const businessTime = businessTimeForSandbox(context.sandbox, wallTime);
        const deny = async (
          denialReason: RepairCommandConflictReason,
          currentStatus: string | null = null,
        ): Promise<never> => {
          await recordRepairCommandDenial(client, {
            action: commandType,
            actorStoreId: context.actorStoreId,
            businessTime,
            currentStatus,
            personaId: input.personaId,
            reason: denialReason,
            recordedAt: wallTime,
            repairId: input.repairId,
            requestId: input.requestId,
            role: input.role,
            sandboxId: input.sandboxId,
          });
          await client.query("commit");
          throw new RepairCommandConflictError(denialReason, currentStatus);
        };
        const reason = input.reason.normalize("NFC").trim();
        if (!isSafePlainTextReason(reason, 200)) {
          await deny("note-invalid");
        }
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({
            outcome: input.outcome,
            reason,
            repairId: input.repairId,
          }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:repair-state:${commandType}:${idempotencyKeyHash}`,
          ],
        );
        const previous = await client.query<RepairVerificationCommandRow>(
          `select payload_hash, result_data
             from repair_state_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and command_type = $3 and idempotency_key_hash = $4`,
          [input.sandboxId, input.personaId, commandType, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            await deny("idempotency-conflict");
          }
          await client.query("commit");
          return repairVerificationCommandFromStored(
            previousRow.result_data,
            true,
          );
        }
        const repairs = await client.query<{
          assigned_to_persona_id: string | null;
          operational_status: "maintenance" | "normal";
          seat_id: string;
          status: DatabaseRepairCreated["status"];
          store_id: string;
        }>(
          `select repair.store_id, repair.seat_id, repair.status,
                  repair.assigned_to_persona_id, seat.operational_status
             from repairs repair
             join seats seat on seat.id = repair.seat_id
            where repair.sandbox_id = $1 and repair.id = $2
            for update of repair, seat`,
          [input.sandboxId, input.repairId],
        );
        const repair = repairs.rows[0];
        if (!repair) return await deny("not-found");
        if (repair.store_id !== context.actorStoreId) {
          await deny("cross-store", repair.status);
        }
        if (repair.status !== "verification") {
          await deny("illegal-transition", repair.status);
        }
        if (repair.assigned_to_persona_id === input.personaId) {
          await deny("verifier-not-independent", repair.status);
        }
        if (repair.operational_status !== "maintenance") {
          throw new Error(
            "A repair awaiting verification must keep its seat in maintenance.",
          );
        }
        const actors = await client.query<{ display_name: string }>(
          `select display_name from demo_personas
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, input.personaId],
        );
        const actorDisplayName = actors.rows[0]?.display_name;
        if (!actorDisplayName) throw new RoleContextUnavailableError();
        const nextStatus =
          input.outcome === "success" ? "closed" : "processing";
        const nextSeatStatus =
          input.outcome === "success" ? "normal" : "maintenance";
        const updated = await client.query(
          `update repairs
              set status = $3, latest_verification_outcome = $4,
                  latest_verification_reason = $5,
                  verified_by_persona_id = $6,
                  verification_business_at = $7,
                  closed_business_at = case when $4::text = 'success'
                    then $7::timestamptz else null end
            where sandbox_id = $1 and id = $2 and status = 'verification'`,
          [
            input.sandboxId,
            input.repairId,
            nextStatus,
            input.outcome,
            reason,
            input.personaId,
            businessTime,
          ],
        );
        if (updated.rowCount !== 1) {
          throw new RepairCommandConflictError(
            "illegal-transition",
            repair.status,
          );
        }
        if (input.outcome === "success") {
          const restored = await client.query(
            `update seats set operational_status = 'normal'
              where sandbox_id = $1 and id = $2
                and operational_status = 'maintenance'`,
            [input.sandboxId, repair.seat_id],
          );
          if (restored.rowCount !== 1) {
            throw new Error("The verified repair seat could not be restored.");
          }
        }
        const eventType =
          input.outcome === "success"
            ? "repair.closed"
            : "repair.verification-failed";
        await client.query(
          `insert into repair_business_events (
             id, sandbox_id, repair_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [
            randomUUID(),
            input.sandboxId,
            input.repairId,
            eventType,
            JSON.stringify({
              actorDisplayName,
              actorPersonaId: input.personaId,
              outcome: input.outcome,
              publicNote: reason,
              reason,
              seatOperationalStatus: nextSeatStatus,
            }),
            businessTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, $6, 'repair', $7, 'allowed', $8,
             $9::jsonb, $10::jsonb, $11, $12)`,
          [
            randomUUID(),
            input.sandboxId,
            context.actorStoreId,
            input.personaId,
            input.role,
            `repair.${commandType}`,
            input.repairId,
            input.requestId,
            JSON.stringify({
              seatOperationalStatus: repair.operational_status,
              status: repair.status,
            }),
            JSON.stringify({
              outcome: input.outcome,
              reason,
              seatOperationalStatus: nextSeatStatus,
              status: nextStatus,
            }),
            businessTime,
            wallTime,
          ],
        );
        const stored: RepairVerificationCommandRow["result_data"] = {
          occurredAt: businessTime.toISOString(),
          outcome: input.outcome,
          recordedAt: wallTime.toISOString(),
          repairId: input.repairId,
          seatOperationalStatus: nextSeatStatus,
          status: nextStatus,
        };
        await client.query(
          `insert into repair_state_command_requests (
             sandbox_id, actor_persona_id, repair_id, command_type,
             idempotency_key_hash, payload_hash, result_data
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            input.repairId,
            commandType,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return repairVerificationCommandFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async createStaffRepair(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        const businessTime = businessTimeForSandbox(context.sandbox, wallTime);
        const description = normalizeRepairDescription(input.description);
        if (!description) {
          throw new RepairIntakeConflictError("description-invalid");
        }
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({ description, seatId: input.seatId }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:repair:${idempotencyKeyHash}`,
          ],
        );
        const previous = await client.query<RepairCommandRow>(
          `select payload_hash, result_data
             from repair_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            throw new RepairIntakeConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return repairCreatedFromStored(previousRow.result_data);
        }
        const seat = await client.query<StaffRepairSeatRow>(
          `select seat.id as seat_id, seat.code as seat_code,
                  seat.operational_status, seat.machine_profile_id,
                  area.code as area_code,
                  area.display_name as area_display_name,
                  profile.code as machine_profile_code,
                  profile.display_name as machine_profile_display_name,
                  profile.experience_description
                    as machine_profile_experience_description,
                  store.id as store_id, store.code as store_code,
                  store.display_name as store_display_name
             from seats seat
             join store_areas area on area.id = seat.area_id
             join machine_profiles profile on profile.id = seat.machine_profile_id
             join stores store on store.id = seat.store_id
            where seat.sandbox_id = $1 and seat.store_id = $2
              and seat.id = $3 and seat.lifecycle_status = 'active'
              and area.lifecycle_status = 'active'
            for update of seat`,
          [input.sandboxId, context.actorStoreId, input.seatId],
        );
        const seatRow = seat.rows[0];
        if (!seatRow) throw new RepairIntakeConflictError("seat-not-found");
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:repair-seat:${seatRow.seat_id}`],
        );
        const selectRepair = `select repair.id as repair_id,
                  repair.reservation_id, repair.source, repair.description,
                  repair.priority, repair.status, repair.created_at,
                  seat.code as seat_code, seat.operational_status,
                  repair.machine_profile_snapshot->>'code'
                    as machine_profile_code,
                  repair.machine_profile_snapshot->>'displayName'
                    as machine_profile_display_name,
                  store.code as store_code,
                  store.display_name as store_display_name
             from repairs repair
             join seats seat on seat.id = repair.seat_id
             join stores store on store.id = repair.store_id`;
        const existing = await client.query<RepairRow>(
          `${selectRepair}
            where repair.sandbox_id = $1 and repair.seat_id = $2
              and repair.status <> 'closed'
            limit 1`,
          [input.sandboxId, seatRow.seat_id],
        );
        let result: DatabaseRepairCreated;
        if (existing.rows[0]) {
          result = repairCreatedFromRow(existing.rows[0], true);
        } else {
          const repairId = randomUUID();
          await client.query(
            `insert into repairs (
               id, sandbox_id, store_id, seat_id, machine_profile_id,
               machine_profile_snapshot,
               reservation_id, customer_persona_id, created_by_persona_id,
               source, description, priority, status, created_business_at,
               created_at
             ) values ($1, $2, $3, $4, $5, $6::jsonb, null, null, $7,
               'staff', $8, 'normal', 'new', $9, $10)`,
            [
              repairId,
              input.sandboxId,
              seatRow.store_id,
              seatRow.seat_id,
              seatRow.machine_profile_id,
              JSON.stringify({
                code: seatRow.machine_profile_code,
                displayName: seatRow.machine_profile_display_name,
                experienceDescription:
                  seatRow.machine_profile_experience_description,
              }),
              input.personaId,
              description,
              businessTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into repair_business_events (
               id, sandbox_id, repair_id, event_type, event_data,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, 'repair.created', $4::jsonb, $5, $6)`,
            [
              randomUUID(),
              input.sandboxId,
              repairId,
              JSON.stringify({ source: "staff" }),
              businessTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, request_id, after_data,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, 'staff', 'repair.create',
               'repair', $5, 'allowed', $6, $7::jsonb, $8, $9)`,
            [
              randomUUID(),
              input.sandboxId,
              seatRow.store_id,
              input.personaId,
              repairId,
              input.requestId,
              JSON.stringify({ status: "new" }),
              businessTime,
              wallTime,
            ],
          );
          const inserted = await client.query<RepairRow>(
            `${selectRepair} where repair.sandbox_id = $1 and repair.id = $2`,
            [input.sandboxId, repairId],
          );
          const insertedRow = inserted.rows[0];
          if (!insertedRow) {
            throw new Error("The created repair could not be read back.");
          }
          result = repairCreatedFromRow(insertedRow, false);
        }
        const storedResult = {
          ...result,
          createdAt: result.createdAt.toISOString(),
        } satisfies RepairCommandRow["result_data"];
        await client.query(
          `insert into repair_command_requests (
             sandbox_id, actor_persona_id, idempotency_key_hash, payload_hash,
             repair_id, result_data
           ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            idempotencyKeyHash,
            payloadHash,
            result.repairId,
            JSON.stringify(storedResult),
          ],
        );
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async createCustomerRepair(input) {
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
        const businessTime = businessTimeForSandbox(sandbox, wallTime);
        const description = normalizeRepairDescription(input.description);
        if (!description) {
          throw new RepairIntakeConflictError("description-invalid");
        }
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({ description, reservationId: input.reservationId }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:repair:${idempotencyKeyHash}`,
          ],
        );
        const previous = await client.query<RepairCommandRow>(
          `select payload_hash, result_data
             from repair_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            throw new RepairIntakeConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return repairCreatedFromStored(previousRow.result_data);
        }
        const reservation = await client.query<CustomerRepairReservationRow>(
          `select reservation.id, reservation.status, reservation.store_id,
                  reservation.seat_id, seat.machine_profile_id,
                  seat.code as seat_code,
                  seat.operational_status,
                  profile.code as machine_profile_code,
                  profile.display_name as machine_profile_display_name,
                  profile.experience_description
                    as machine_profile_experience_description,
                  store.code as store_code,
                  store.display_name as store_display_name
             from reservations reservation
             join seats seat on seat.id = reservation.seat_id
             join machine_profiles profile on profile.id = seat.machine_profile_id
             join stores store on store.id = reservation.store_id
            where reservation.sandbox_id = $1
              and reservation.customer_persona_id = $2
              and reservation.id = $3
            for update of reservation`,
          [input.sandboxId, input.personaId, input.reservationId],
        );
        const reservationRow = reservation.rows[0];
        if (!reservationRow) {
          throw new RepairIntakeConflictError("reservation-not-found");
        }
        if (reservationRow.status !== "in-use") {
          throw new RepairIntakeConflictError("reservation-ineligible");
        }
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:repair-seat:${reservationRow.seat_id}`],
        );
        const selectRepair = `select repair.id as repair_id,
                  repair.reservation_id, repair.source, repair.description,
                  repair.priority, repair.status, repair.created_at,
                  seat.code as seat_code, seat.operational_status,
                  repair.machine_profile_snapshot->>'code'
                    as machine_profile_code,
                  repair.machine_profile_snapshot->>'displayName'
                    as machine_profile_display_name,
                  store.code as store_code,
                  store.display_name as store_display_name
             from repairs repair
             join seats seat on seat.id = repair.seat_id
             join stores store on store.id = repair.store_id`;
        const existing = await client.query<RepairRow>(
          `${selectRepair}
            where repair.sandbox_id = $1 and repair.seat_id = $2
              and repair.status <> 'closed'
            limit 1`,
          [input.sandboxId, reservationRow.seat_id],
        );
        let result: DatabaseRepairCreated;
        if (existing.rows[0]) {
          result = repairCreatedFromRow(existing.rows[0], true);
        } else {
          const repairId = randomUUID();
          await client.query(
            `insert into repairs (
               id, sandbox_id, store_id, seat_id, machine_profile_id,
               machine_profile_snapshot,
               reservation_id, customer_persona_id, created_by_persona_id,
               source, description, priority, status, created_business_at,
               created_at
             ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $8,
               'customer', $9, 'normal', 'new', $10, $11)`,
            [
              repairId,
              input.sandboxId,
              reservationRow.store_id,
              reservationRow.seat_id,
              reservationRow.machine_profile_id,
              JSON.stringify({
                code: reservationRow.machine_profile_code,
                displayName: reservationRow.machine_profile_display_name,
                experienceDescription:
                  reservationRow.machine_profile_experience_description,
              }),
              reservationRow.id,
              input.personaId,
              description,
              businessTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into repair_business_events (
               id, sandbox_id, repair_id, event_type, event_data,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, 'repair.created', $4::jsonb, $5, $6)`,
            [
              randomUUID(),
              input.sandboxId,
              repairId,
              JSON.stringify({
                reservationId: reservationRow.id,
                source: "customer",
              }),
              businessTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, request_id, after_data,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, 'customer', 'repair.create',
               'repair', $5, 'allowed', $6, $7::jsonb, $8, $9)`,
            [
              randomUUID(),
              input.sandboxId,
              reservationRow.store_id,
              input.personaId,
              repairId,
              input.requestId,
              JSON.stringify({ status: "new" }),
              businessTime,
              wallTime,
            ],
          );
          const inserted = await client.query<RepairRow>(
            `${selectRepair} where repair.sandbox_id = $1 and repair.id = $2`,
            [input.sandboxId, repairId],
          );
          const insertedRow = inserted.rows[0];
          if (!insertedRow) {
            throw new Error("The created repair could not be read back.");
          }
          result = repairCreatedFromRow(insertedRow, false);
        }
        const storedResult = {
          ...result,
          createdAt: result.createdAt.toISOString(),
        } satisfies RepairCommandRow["result_data"];
        await client.query(
          `insert into repair_command_requests (
             sandbox_id, actor_persona_id, idempotency_key_hash, payload_hash,
             repair_id, result_data
           ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
          [
            input.sandboxId,
            input.personaId,
            idempotencyKeyHash,
            payloadHash,
            result.repairId,
            JSON.stringify(storedResult),
          ],
        );
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readOwnHandovers(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertEmployeeContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await processDueHandoverExceptions(client, {
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const shifts = await client.query<
          ShiftAttendanceRow & { handover_id: string | null }
        >(
          `select shift.id as shift_id, shift.starts_at, shift.ends_at,
                  attendance.id as attendance_id,
                  attendance.status as attendance_status,
                  attendance.check_in_outcome,
                  attendance.check_in_business_at,
                  attendance.check_in_recorded_at,
                  attendance.check_out_business_at,
                  attendance.check_out_recorded_at,
                  attendance.absence_business_at,
                  attendance.absence_recorded_at,
                  handover.id as handover_id
             from shifts shift
             left join attendance_records attendance
               on attendance.sandbox_id = shift.sandbox_id
              and attendance.shift_id = shift.id
             left join handovers handover
               on handover.sandbox_id = shift.sandbox_id
              and handover.shift_id = shift.id
            where shift.sandbox_id = $1 and shift.employee_id = $2
              and shift.status = 'scheduled'
            order by shift.starts_at, shift.id`,
          [input.sandboxId, context.employee.id],
        );
        const currentShift =
          shifts.rows.find(
            (shift) => shift.attendance_status === "checked-in",
          ) ??
          shifts.rows.find(
            (shift) =>
              shift.starts_at.getTime() <= currentTime.getTime() &&
              shift.ends_at.getTime() > currentTime.getTime(),
          ) ??
          shifts.rows.find(
            (shift) =>
              shift.starts_at.getTime() - 30 * 60_000 <=
                currentTime.getTime() &&
              shift.ends_at.getTime() > currentTime.getTime(),
          ) ??
          null;
        const ownHandovers = await client.query<HandoverRow>(
          `${handoverSelect}
            where handover.sandbox_id = $1
              and handover.submitted_by_employee_id = $2
            order by handover.submitted_business_at desc, handover.id desc`,
          [input.sandboxId, context.employee.id],
        );
        const currentHandover = currentShift
          ? ownHandovers.rows.find(
              (handover) => handover.shift_id === currentShift.shift_id,
            )
          : ownHandovers.rows[0];
        const outgoingShift =
          currentShift ??
          (currentHandover
            ? (shifts.rows.find(
                (shift) => shift.shift_id === currentHandover.shift_id,
              ) ?? null)
            : null);
        const outgoingHandover = currentHandover
          ? handoverFromRow(currentHandover)
          : null;
        const snapshotPreview = outgoingShift
          ? (outgoingHandover?.snapshot ??
            (await readHandoverSnapshot(client, {
              capturedAt: currentTime,
              sandboxId: input.sandboxId,
              storeId: context.employee.store_id,
            })))
          : null;
        const incomingRows = await client.query<HandoverRow>(
          `${handoverSelect}
            where handover.sandbox_id = $1 and handover.store_id = $2
              and handover.submitted_by_employee_id <> $3
              and confirmation.id is null
            order by handover.submitted_business_at, handover.id`,
          [input.sandboxId, context.employee.store_id, context.employee.id],
        );
        const result: DatabaseOwnHandovers = {
          currentTime,
          employee: {
            displayName: context.employee.display_name,
            employeeCode: context.employee.employee_code,
            role: context.employee.role,
          },
          incoming: incomingRows.rows.map((handover) => ({
            canConfirm: shifts.rows.some(
              (shift) => shift.attendance_status === "checked-in",
            ),
            handover: handoverFromRow(handover),
          })),
          outgoing:
            outgoingShift && snapshotPreview
              ? {
                  canSubmit:
                    outgoingShift.attendance_status === "checked-in" &&
                    outgoingHandover === null,
                  handover: outgoingHandover,
                  shiftId: outgoingShift.shift_id,
                  snapshotPreview,
                  window: {
                    endsAt: outgoingShift.ends_at,
                    startsAt: outgoingShift.starts_at,
                  },
                }
              : null,
          store: {
            code: context.employee.store_code,
            displayName: context.employee.store_display_name,
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
    async submitOwnHandover(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertEmployeeContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        const note = normalizeHandoverNote(input.note);
        if (note === null) throw new HandoverConflictError("note-invalid");
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:${context.employee.id}:handover-state`],
        );
        await processDueHandoverExceptions(client, {
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({ note, shiftId: input.shiftId }),
        );
        const previous = await client.query<{
          payload_hash: string;
          result_data: StoredHandover;
        }>(
          `select payload_hash, result_data
             from handover_command_requests
            where sandbox_id = $1 and employee_id = $2
              and command_type = 'submit' and idempotency_key_hash = $3`,
          [input.sandboxId, context.employee.id, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            throw new HandoverConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return {
            ...handoverFromStored(previousRow.result_data),
            replayed: true,
          };
        }
        const shift = await client.query<
          LockedShiftRow & { attendance_status: AttendanceStatus | null }
        >(
          `select shift.id as shift_id, shift.store_id, shift.employee_id,
                  shift.starts_at, shift.ends_at,
                  attendance.status as attendance_status
             from shifts shift
             left join attendance_records attendance
               on attendance.sandbox_id = shift.sandbox_id
              and attendance.shift_id = shift.id
            where shift.sandbox_id = $1 and shift.id = $2
              and shift.status = 'scheduled'
            for update of shift`,
          [input.sandboxId, input.shiftId],
        );
        const shiftRow = shift.rows[0];
        if (
          !shiftRow ||
          shiftRow.employee_id !== context.employee.id ||
          shiftRow.store_id !== context.employee.store_id ||
          shiftRow.attendance_status !== "checked-in"
        ) {
          await recordHandoverCommandDenial(client, {
            action: "handover.submit",
            businessTime: currentTime,
            objectId: input.shiftId,
            personaId: input.personaId,
            reason: "shift-not-eligible",
            recordedAt: wallTime,
            requestId: input.requestId,
            role: input.role,
            sandboxId: input.sandboxId,
            storeId: context.employee.store_id,
          });
          await client.query("commit");
          throw new HandoverConflictError("shift-not-eligible");
        }
        const existing = await client.query<{ id: string }>(
          `select id from handovers where sandbox_id = $1 and shift_id = $2`,
          [input.sandboxId, input.shiftId],
        );
        if (existing.rows[0]) {
          await recordHandoverCommandDenial(client, {
            action: "handover.submit",
            businessTime: currentTime,
            objectId: existing.rows[0].id,
            personaId: input.personaId,
            reason: "already-submitted",
            recordedAt: wallTime,
            requestId: input.requestId,
            role: input.role,
            sandboxId: input.sandboxId,
            storeId: context.employee.store_id,
          });
          await client.query("commit");
          throw new HandoverConflictError("already-submitted");
        }
        const snapshot = await readHandoverSnapshot(client, {
          capturedAt: currentTime,
          sandboxId: input.sandboxId,
          storeId: context.employee.store_id,
        });
        const handoverId = randomUUID();
        await client.query(
          `insert into handovers (
             id, sandbox_id, store_id, shift_id, submitted_by_employee_id,
             note, snapshot, submitted_business_at, submitted_recorded_at
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)`,
          [
            handoverId,
            input.sandboxId,
            context.employee.store_id,
            input.shiftId,
            context.employee.id,
            note,
            JSON.stringify(storedHandoverSnapshot(snapshot)),
            currentTime,
            wallTime,
          ],
        );
        const exceptionKinds = classifyHandoverExceptions({
          confirmedAt: null,
          currentTime,
          shiftEndsAt: shiftRow.ends_at,
          submittedAt: currentTime,
        });
        for (const kind of exceptionKinds) {
          const occurredAt =
            kind === "late-submission"
              ? currentTime
              : new Date(
                  shiftRow.ends_at.getTime() + HANDOVER_EXCEPTION_GRACE_MS,
                );
          await client.query(
            `insert into handover_exceptions (
               id, sandbox_id, store_id, shift_id, handover_id, kind,
               business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8)
             on conflict (sandbox_id, shift_id, kind) do nothing`,
            [
              randomUUID(),
              input.sandboxId,
              context.employee.store_id,
              input.shiftId,
              handoverId,
              kind,
              occurredAt,
              wallTime,
            ],
          );
        }
        const handover: DatabaseHandover = {
          confirmed: null,
          handoverId,
          note,
          shiftId: input.shiftId,
          snapshot,
          submittedAt: {
            businessOccurredAt: currentTime,
            recordedAt: wallTime,
          },
          submittedBy: {
            displayName: context.employee.display_name,
            employeeCode: context.employee.employee_code,
          },
        };
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, 'handover.submit', 'handover',
             $6, 'allowed', $7, null, $8::jsonb, $9, $10)`,
          [
            randomUUID(),
            input.sandboxId,
            context.employee.store_id,
            input.personaId,
            input.role,
            handoverId,
            input.requestId,
            JSON.stringify({
              noteLength: note.length,
              shiftId: input.shiftId,
              snapshotCounts: {
                lowStockAlerts: snapshot.lowStockAlerts.length,
                orders: snapshot.orders.length,
                repairs: snapshot.repairs.length,
                reservations: snapshot.reservations.length,
              },
            }),
            currentTime,
            wallTime,
          ],
        );
        const stored = storedHandoverFromDatabase(handover);
        await client.query(
          `insert into handover_command_requests (
             sandbox_id, employee_id, command_type, idempotency_key_hash,
             payload_hash, result_data
           ) values ($1, $2, 'submit', $3, $4, $5::jsonb)`,
          [
            input.sandboxId,
            context.employee.id,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return { ...handover, replayed: false };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async confirmHandover(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertEmployeeContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:handover:${input.handoverId}`],
        );
        await processDueHandoverExceptions(client, {
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({ handoverId: input.handoverId }),
        );
        const previous = await client.query<{
          payload_hash: string;
          result_data: StoredHandover;
        }>(
          `select payload_hash, result_data
             from handover_command_requests
            where sandbox_id = $1 and employee_id = $2
              and command_type = 'confirm' and idempotency_key_hash = $3`,
          [input.sandboxId, context.employee.id, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            throw new HandoverConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return {
            ...handoverFromStored(previousRow.result_data),
            replayed: true,
          };
        }
        const handoverRows = await client.query<
          HandoverRow & {
            store_id: string;
            submitted_by_employee_id: string;
          }
        >(
          `${handoverSelect}
            where handover.sandbox_id = $1 and handover.id = $2`,
          [input.sandboxId, input.handoverId],
        );
        const handoverRow = handoverRows.rows[0];
        if (
          !handoverRow ||
          handoverRow.store_id !== context.employee.store_id
        ) {
          await recordHandoverCommandDenial(client, {
            action: "handover.confirm",
            businessTime: currentTime,
            objectId: input.handoverId,
            personaId: input.personaId,
            reason: handoverRow ? "cross-store" : "handover-not-found",
            recordedAt: wallTime,
            requestId: input.requestId,
            role: input.role,
            sandboxId: input.sandboxId,
            storeId: context.employee.store_id,
          });
          await client.query("commit");
          throw new HandoverConflictError("handover-not-found");
        }
        if (handoverRow.confirmation_business_at) {
          await recordHandoverCommandDenial(client, {
            action: "handover.confirm",
            businessTime: currentTime,
            objectId: input.handoverId,
            personaId: input.personaId,
            reason: "already-confirmed",
            recordedAt: wallTime,
            requestId: input.requestId,
            role: input.role,
            sandboxId: input.sandboxId,
            storeId: context.employee.store_id,
          });
          await client.query("commit");
          throw new HandoverConflictError("already-confirmed");
        }
        const eligibility = await client.query<{ shift_id: string }>(
          `select attendance.shift_id
             from attendance_records attendance
            where attendance.sandbox_id = $1 and attendance.employee_id = $2
              and attendance.status = 'checked-in'
            order by attendance.check_in_business_at desc limit 1`,
          [input.sandboxId, context.employee.id],
        );
        const denialReason =
          handoverRow.submitted_by_employee_id === context.employee.id
            ? "self-confirmation"
            : !eligibility.rows[0]
              ? "confirmation-not-checked-in"
              : null;
        if (denialReason) {
          await recordHandoverCommandDenial(client, {
            action: "handover.confirm",
            businessTime: currentTime,
            objectId: input.handoverId,
            personaId: input.personaId,
            reason: denialReason,
            recordedAt: wallTime,
            requestId: input.requestId,
            role: input.role,
            sandboxId: input.sandboxId,
            storeId: context.employee.store_id,
          });
          await client.query("commit");
          throw new HandoverConflictError("confirmation-not-eligible");
        }
        await client.query(
          `insert into handover_confirmations (
             id, sandbox_id, store_id, handover_id, confirmed_by_employee_id,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            input.sandboxId,
            context.employee.store_id,
            input.handoverId,
            context.employee.id,
            currentTime,
            wallTime,
          ],
        );
        const handover: DatabaseHandover = {
          ...handoverFromRow(handoverRow),
          confirmed: {
            businessOccurredAt: currentTime,
            by: {
              displayName: context.employee.display_name,
              employeeCode: context.employee.employee_code,
            },
            recordedAt: wallTime,
          },
        };
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, 'handover.confirm', 'handover',
             $6, 'allowed', $7, $8::jsonb, $9::jsonb, $10, $11)`,
          [
            randomUUID(),
            input.sandboxId,
            context.employee.store_id,
            input.personaId,
            input.role,
            input.handoverId,
            input.requestId,
            JSON.stringify({ confirmed: false }),
            JSON.stringify({
              confirmed: true,
              confirmedByEmployeeCode: context.employee.employee_code,
            }),
            currentTime,
            wallTime,
          ],
        );
        const stored = storedHandoverFromDatabase(handover);
        await client.query(
          `insert into handover_command_requests (
             sandbox_id, employee_id, command_type, idempotency_key_hash,
             payload_hash, result_data
           ) values ($1, $2, 'confirm', $3, $4, $5::jsonb)`,
          [
            input.sandboxId,
            context.employee.id,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
          ],
        );
        await client.query("commit");
        return { ...handover, replayed: false };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readManagerHandoverExceptions(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertEmployeeContext(client, input, wallTime);
        if (context.employee.role !== "manager") {
          throw new RoleContextStaleError();
        }
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await processDueHandoverExceptions(client, {
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const rows = await client.query<{
          business_occurred_at: Date;
          display_name: string;
          employee_code: string;
          ends_at: Date;
          handover_id: string | null;
          kind: HandoverExceptionKind;
          recorded_at: Date;
          shift_id: string;
          starts_at: Date;
        }>(
          `select exception.kind, exception.business_occurred_at,
                  exception.recorded_at, exception.shift_id,
                  exception.handover_id, shift.starts_at, shift.ends_at,
                  employee.display_name, employee.employee_code
             from handover_exceptions exception
             join shifts shift on shift.id = exception.shift_id
             join employees employee on employee.id = shift.employee_id
            where exception.sandbox_id = $1 and exception.store_id = $2
            order by exception.business_occurred_at desc, exception.id desc`,
          [input.sandboxId, context.employee.store_id],
        );
        const handoverIds = [
          ...new Set(
            rows.rows.flatMap((row) =>
              row.handover_id ? [row.handover_id] : [],
            ),
          ),
        ];
        const handovers =
          handoverIds.length === 0
            ? { rows: [] as HandoverRow[] }
            : await client.query<HandoverRow>(
                `${handoverSelect}
                  where handover.sandbox_id = $1
                    and handover.id = any($2::uuid[])`,
                [input.sandboxId, handoverIds],
              );
        const handoversById = new Map(
          handovers.rows.map((row) => [row.handover_id, handoverFromRow(row)]),
        );
        const result: DatabaseManagerHandoverExceptions = {
          currentTime,
          exceptions: rows.rows.map((row) => ({
            businessOccurredAt: row.business_occurred_at,
            employee: {
              displayName: row.display_name,
              employeeCode: row.employee_code,
            },
            handover: row.handover_id
              ? (handoversById.get(row.handover_id) ?? null)
              : null,
            kind: row.kind,
            recordedAt: row.recorded_at,
            shiftId: row.shift_id,
            window: { endsAt: row.ends_at, startsAt: row.starts_at },
          })),
          store: {
            code: context.employee.store_code,
            displayName: context.employee.store_display_name,
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
    async readOwnShiftAttendance(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertEmployeeContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:${context.employee.id}:attendance-state`],
        );
        await processDueAttendanceAbsences(client, {
          employeeId: context.employee.id,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const rows = await client.query<ShiftAttendanceRow>(
          `select shift.id as shift_id, shift.starts_at, shift.ends_at,
                  attendance.id as attendance_id,
                  attendance.status as attendance_status,
                  attendance.check_in_outcome,
                  attendance.check_in_business_at,
                  attendance.check_in_recorded_at,
                  attendance.check_out_business_at,
                  attendance.check_out_recorded_at,
                  attendance.absence_business_at,
                  attendance.absence_recorded_at
             from shifts shift
             left join attendance_records attendance
               on attendance.sandbox_id = shift.sandbox_id
              and attendance.shift_id = shift.id
            where shift.sandbox_id = $1 and shift.employee_id = $2
              and shift.status = 'scheduled'
            order by shift.starts_at, shift.id`,
          [input.sandboxId, context.employee.id],
        );
        const shiftIds = rows.rows.map((row) => row.shift_id);
        const facts =
          shiftIds.length === 0
            ? { rows: [] as AttendanceEventRow[] }
            : await client.query<AttendanceEventRow>(
                `select shift_id, event_type, event_data,
                        business_occurred_at, recorded_at
                   from attendance_events
                  where sandbox_id = $1 and shift_id = any($2::uuid[])
                  order by business_occurred_at, recorded_at, id`,
                [input.sandboxId, shiftIds],
              );
        const shifts = rows.rows.map((row) =>
          staffShiftFromRows(row, facts.rows, currentTime),
        );
        const awaitingSignOut = shifts.find(
          (shift) => shift.attendance?.status === "checked-in",
        );
        const active = shifts.find(
          (shift) =>
            shift.window.startsAt.getTime() <= currentTime.getTime() &&
            shift.window.endsAt.getTime() > currentTime.getTime(),
        );
        const current =
          awaitingSignOut ??
          active ??
          shifts.find(
            (shift) =>
              shift.signInWindow.opensAt.getTime() <= currentTime.getTime() &&
              shift.window.endsAt.getTime() > currentTime.getTime(),
          ) ??
          null;
        const result: DatabaseOwnShiftAttendance = {
          currentTime,
          employee: {
            displayName: context.employee.display_name,
            employeeCode: context.employee.employee_code,
            role: context.employee.role,
          },
          shifts: {
            current,
            future: shifts.filter(
              (shift) =>
                shift.shiftId !== current?.shiftId &&
                shift.window.startsAt.getTime() > currentTime.getTime(),
            ),
            recent: shifts
              .filter(
                (shift) =>
                  shift.shiftId !== current?.shiftId &&
                  shift.window.endsAt.getTime() <= currentTime.getTime(),
              )
              .toReversed()
              .slice(0, 3),
          },
          store: {
            code: context.employee.store_code,
            displayName: context.employee.store_display_name,
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
    async executeOwnAttendanceCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertEmployeeContext(client, input, wallTime);
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`${input.sandboxId}:${context.employee.id}:attendance-state`],
        );
        await processDueAttendanceAbsences(client, {
          employeeId: context.employee.id,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(
          JSON.stringify({ action: input.action, shiftId: input.shiftId }),
        );
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${context.employee.id}:attendance:${idempotencyKeyHash}`,
          ],
        );
        const previous = await client.query<{
          payload_hash: string;
          result_data: StoredAttendanceCommand;
        }>(
          `select payload_hash, result_data
             from attendance_command_requests
            where sandbox_id = $1 and employee_id = $2
              and idempotency_key_hash = $3`,
          [input.sandboxId, context.employee.id, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            throw new AttendanceConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return {
            ...previousRow.result_data,
            occurredAt: new Date(previousRow.result_data.occurredAt),
            replayed: true,
          };
        }
        const shiftResult = await client.query<LockedShiftRow>(
          `select shift.id as shift_id, shift.store_id, shift.employee_id,
                  shift.starts_at, shift.ends_at
             from shifts shift
            where shift.sandbox_id = $1 and shift.id = $2
              and shift.status = 'scheduled'
            for update of shift`,
          [input.sandboxId, input.shiftId],
        );
        const lockedShift = shiftResult.rows[0];
        if (!lockedShift || lockedShift.employee_id !== context.employee.id) {
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, $5, $6, 'shift', $7,
               'denied', 'not-own-shift', $8, null, null, $9, $10)`,
            [
              randomUUID(),
              input.sandboxId,
              context.employee.store_id,
              input.personaId,
              input.role,
              `attendance.${input.action}`,
              input.shiftId,
              input.requestId,
              currentTime,
              wallTime,
            ],
          );
          await client.query("commit");
          throw new AttendanceConflictError("not-own-shift");
        }
        const attendanceResult = await client.query<
          Omit<ShiftAttendanceRow, "ends_at" | "shift_id" | "starts_at">
        >(
          `select attendance.id as attendance_id,
                  attendance.status as attendance_status,
                  attendance.check_in_outcome,
                  attendance.check_in_business_at,
                  attendance.check_in_recorded_at,
                  attendance.check_out_business_at,
                  attendance.check_out_recorded_at,
                  attendance.absence_business_at,
                  attendance.absence_recorded_at
             from attendance_records attendance
            where attendance.sandbox_id = $1 and attendance.shift_id = $2`,
          [input.sandboxId, input.shiftId],
        );
        const attendance = attendanceResult.rows[0];
        const shift: ShiftAttendanceRow & LockedShiftRow = {
          absence_business_at: attendance?.absence_business_at ?? null,
          absence_recorded_at: attendance?.absence_recorded_at ?? null,
          attendance_id: attendance?.attendance_id ?? null,
          attendance_status: attendance?.attendance_status ?? null,
          check_in_business_at: attendance?.check_in_business_at ?? null,
          check_in_outcome: attendance?.check_in_outcome ?? null,
          check_in_recorded_at: attendance?.check_in_recorded_at ?? null,
          check_out_business_at: attendance?.check_out_business_at ?? null,
          check_out_recorded_at: attendance?.check_out_recorded_at ?? null,
          ...lockedShift,
        };
        if (
          input.action === "simulated-check-in" &&
          shift.attendance_status === null
        ) {
          const otherOpenAttendance = await client.query<{ shift_id: string }>(
            `select shift_id from attendance_records
              where sandbox_id = $1 and employee_id = $2
                and status = 'checked-in' and shift_id <> $3
              order by shift_id limit 1`,
            [input.sandboxId, context.employee.id, input.shiftId],
          );
          if (otherOpenAttendance.rows[0]) {
            await client.query(
              `insert into audit_events (
                 id, sandbox_id, store_id, persona_id, role, action,
                 object_type, object_id, result, reason, request_id,
                 before_data, after_data, business_occurred_at, recorded_at
               ) values ($1, $2, $3, $4, $5, $6, 'shift', $7,
                 'denied', 'employee-already-checked-in', $8, $9::jsonb,
                 null, $10, $11)`,
              [
                randomUUID(),
                input.sandboxId,
                context.employee.store_id,
                input.personaId,
                input.role,
                `attendance.${input.action}`,
                input.shiftId,
                input.requestId,
                JSON.stringify({
                  openShiftId: otherOpenAttendance.rows[0].shift_id,
                }),
                currentTime,
                wallTime,
              ],
            );
            await client.query("commit");
            throw new AttendanceConflictError("employee-already-checked-in");
          }
        }
        const decision = decideAttendanceAction({
          action: input.action,
          businessTime: currentTime,
          endsAt: shift.ends_at,
          startsAt: shift.starts_at,
          status: shift.attendance_status,
        });
        if (decision.status === "invalid") {
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, $5, $6, 'shift', $7,
               'denied', $8, $9, $10::jsonb, null, $11, $12)`,
            [
              randomUUID(),
              input.sandboxId,
              context.employee.store_id,
              input.personaId,
              input.role,
              `attendance.${input.action}`,
              input.shiftId,
              decision.reason,
              input.requestId,
              JSON.stringify({ status: shift.attendance_status }),
              currentTime,
              wallTime,
            ],
          );
          await client.query("commit");
          throw new AttendanceConflictError(
            decision.reason,
            shift.attendance_status,
          );
        }
        let attendanceId = shift.attendance_id;
        if (input.action === "simulated-check-in") {
          attendanceId = randomUUID();
          await client.query(
            `insert into attendance_records (
               id, sandbox_id, store_id, employee_id, shift_id, status,
               check_in_outcome, check_in_business_at, check_in_recorded_at
             ) values ($1, $2, $3, $4, $5, 'checked-in', $6, $7, $8)`,
            [
              attendanceId,
              input.sandboxId,
              context.employee.store_id,
              context.employee.id,
              input.shiftId,
              decision.outcome,
              currentTime,
              wallTime,
            ],
          );
        } else {
          if (!attendanceId) {
            throw new Error("A checked-in shift has no attendance record.");
          }
          const updated = await client.query(
            `update attendance_records
                set status = 'checked-out', check_out_business_at = $3,
                    check_out_recorded_at = $4
              where sandbox_id = $1 and id = $2 and status = 'checked-in'`,
            [input.sandboxId, attendanceId, currentTime, wallTime],
          );
          if (updated.rowCount !== 1) {
            throw new Error("The attendance record could not be checked out.");
          }
        }
        const outcome =
          input.action === "simulated-check-in"
            ? decision.outcome
            : shift.check_in_outcome;
        if (!attendanceId) {
          throw new Error("The attendance command has no record identifier.");
        }
        await client.query(
          `insert into attendance_events (
             id, sandbox_id, store_id, employee_id, shift_id,
             attendance_record_id, event_type, event_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
          [
            randomUUID(),
            input.sandboxId,
            context.employee.store_id,
            context.employee.id,
            input.shiftId,
            attendanceId,
            `attendance.${input.action}`,
            JSON.stringify(
              input.action === "simulated-check-in"
                ? { outcome, simulated: true }
                : { source: "manual" },
            ),
            currentTime,
            wallTime,
          ],
        );
        const result: DatabaseAttendanceCommand = {
          action: input.action,
          occurredAt: currentTime,
          outcome,
          replayed: false,
          shiftId: input.shiftId,
          status: decision.nextStatus,
        };
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action,
             object_type, object_id, result, request_id, before_data,
             after_data, business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, $6, 'shift', $7, 'allowed',
             $8, $9::jsonb, $10::jsonb, $11, $12)`,
          [
            randomUUID(),
            input.sandboxId,
            context.employee.store_id,
            input.personaId,
            input.role,
            `attendance.${input.action}`,
            input.shiftId,
            input.requestId,
            JSON.stringify({ status: shift.attendance_status }),
            JSON.stringify({ outcome, status: result.status }),
            currentTime,
            wallTime,
          ],
        );
        const storedResult = {
          action: result.action,
          occurredAt: result.occurredAt.toISOString(),
          outcome: result.outcome,
          shiftId: result.shiftId,
          status: result.status,
        } satisfies StoredAttendanceCommand;
        await client.query(
          `insert into attendance_command_requests (
             sandbox_id, employee_id, idempotency_key_hash, payload_hash,
             result_data
           ) values ($1, $2, $3, $4, $5::jsonb)`,
          [
            input.sandboxId,
            context.employee.id,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(storedResult),
          ],
        );
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
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
    async executeManagerInventoryCommand(input) {
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
        const deny = async (
          denialReason: ManagerInventoryConflictReason,
          balance?: {
            readonly id: string;
            readonly on_hand_quantity: number;
            readonly reserved_quantity: number;
          },
        ): Promise<never> => {
          await recordManagerInventoryDenial(client, {
            action: input.action,
            actorStoreId: context.actorStoreId,
            businessTime: currentTime,
            inventoryItemId: balance?.id ?? input.inventoryItemId,
            onHandQuantity: balance?.on_hand_quantity ?? null,
            personaId: input.personaId,
            reason: denialReason,
            recordedAt: wallTime,
            requestId: input.requestId,
            reservedQuantity: balance?.reserved_quantity ?? null,
            sandboxId: input.sandboxId,
          });
          await client.query("commit");
          throw new ManagerInventoryConflictError(denialReason);
        };
        const reason = input.reason.trim();
        if (!isSafePlainTextReason(reason)) await deny("invalid-reason");
        const payloadHash = hash(
          JSON.stringify({
            action: input.action,
            inventoryItemId: input.inventoryItemId,
            reason,
            ...(input.action === "receipt"
              ? { quantity: input.quantity }
              : input.action === "stocktake"
                ? { actualQuantity: input.actualQuantity }
                : {
                    onHandDelta: input.onHandDelta,
                    originalMovementId: input.originalMovementId,
                  }),
          }),
        );
        const idempotencyKeyHash = hash(input.idempotencyKey);
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:manager-inventory:${idempotencyKeyHash}`,
          ],
        );
        const existing = await client.query<ManagerInventoryCommandRow>(
          `select payload_hash, result_data
             from inventory_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            await deny("idempotency-conflict");
          }
          await client.query("commit");
          return managerInventoryCommandFromStored(
            existingRow.result_data,
            true,
          );
        }
        const item = await client.query<{
          id: string;
          low_stock_threshold: number;
          on_hand_quantity: number;
          reserved_quantity: number;
          store_id: string;
        }>(
          `select id, store_id, on_hand_quantity, reserved_quantity,
                  low_stock_threshold
             from inventory_items
            where sandbox_id = $1 and id = $2
            for update`,
          [input.sandboxId, input.inventoryItemId],
        );
        const itemRow = item.rows[0];
        if (!itemRow) {
          return await deny("not-found");
        }
        if (itemRow.store_id !== context.actorStoreId) {
          await deny("cross-store", itemRow);
        }
        let onHandDelta: number;
        let onHandAfter: number;
        let originalMovementId: string | null = null;
        if (input.action === "receipt") {
          if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
            await deny("invalid-quantity", itemRow);
          }
          onHandDelta = input.quantity;
          onHandAfter = itemRow.on_hand_quantity + onHandDelta;
        } else if (input.action === "stocktake") {
          if (
            !Number.isInteger(input.actualQuantity) ||
            input.actualQuantity < 0
          ) {
            await deny("invalid-quantity", itemRow);
          }
          if (input.actualQuantity < itemRow.reserved_quantity) {
            await deny("reserved-inventory", itemRow);
          }
          onHandAfter = input.actualQuantity;
          onHandDelta = onHandAfter - itemRow.on_hand_quantity;
          if (onHandDelta === 0) {
            await deny("no-change", itemRow);
          }
        } else {
          if (!Number.isInteger(input.onHandDelta) || input.onHandDelta === 0) {
            await deny("invalid-quantity", itemRow);
          }
          onHandDelta = input.onHandDelta;
          onHandAfter = itemRow.on_hand_quantity + onHandDelta;
          if (onHandAfter < itemRow.reserved_quantity) {
            await deny("reserved-inventory", itemRow);
          }
          originalMovementId = input.originalMovementId;
          if (originalMovementId) {
            const original = await client.query<{ id: string }>(
              `select id from inventory_movements
                where sandbox_id = $1 and store_id = $2
                  and inventory_item_id = $3 and id = $4`,
              [
                input.sandboxId,
                context.actorStoreId,
                itemRow.id,
                originalMovementId,
              ],
            );
            if (!original.rows[0]) {
              await deny("original-movement-not-found", itemRow);
            }
          }
        }
        const beforeAlerting =
          itemRow.on_hand_quantity - itemRow.reserved_quantity <=
          itemRow.low_stock_threshold;
        const alerting =
          onHandAfter - itemRow.reserved_quantity <=
          itemRow.low_stock_threshold;
        const alertTransition =
          beforeAlerting === alerting
            ? "unchanged"
            : alerting
              ? "activated"
              : "resolved";
        const movementId = randomUUID();
        await client.query(
          `update inventory_items set on_hand_quantity = $3
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, itemRow.id, onHandAfter],
        );
        await client.query(
          `insert into inventory_movements (
             id, sandbox_id, store_id, inventory_item_id, order_id,
             movement_kind, compensates_movement_id, reason, on_hand_delta,
             on_hand_after, business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, null, $5, $6, $7, $8, $9, $10, $11)`,
          [
            movementId,
            input.sandboxId,
            context.actorStoreId,
            itemRow.id,
            input.action,
            originalMovementId,
            reason,
            onHandDelta,
            onHandAfter,
            currentTime,
            wallTime,
          ],
        );
        const stored: ManagerInventoryCommandRow["result_data"] = {
          action: input.action,
          alerting,
          alertTransition,
          businessOccurredAt: currentTime.toISOString(),
          inventoryItemId: itemRow.id,
          movementId,
          onHandAfter,
          onHandDelta,
          originalMovementId,
          reason,
        };
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, 'manager', $5, 'inventory_item', $6,
             'allowed', $7, $8, $9::jsonb, $10::jsonb, $11, $12)`,
          [
            randomUUID(),
            input.sandboxId,
            context.actorStoreId,
            input.personaId,
            `inventory.${input.action}`,
            itemRow.id,
            reason,
            input.requestId,
            JSON.stringify({
              alerting: beforeAlerting,
              onHandQuantity: itemRow.on_hand_quantity,
              reservedQuantity: itemRow.reserved_quantity,
            }),
            JSON.stringify({
              alerting,
              movementId,
              onHandQuantity: onHandAfter,
              reservedQuantity: itemRow.reserved_quantity,
            }),
            currentTime,
            wallTime,
          ],
        );
        await client.query(
          `insert into inventory_command_requests (
             sandbox_id, actor_persona_id, inventory_item_id, command_type,
             idempotency_key_hash, payload_hash, result_data, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            input.sandboxId,
            input.personaId,
            itemRow.id,
            input.action,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
            wallTime,
          ],
        );
        await client.query("commit");
        return managerInventoryCommandFromStored(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readStoreInventory(input) {
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
        const store = await client.query<{
          code: string;
          display_name: string;
        }>(
          `select code, display_name from stores
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, context.actorStoreId],
        );
        const storeRow = store.rows[0];
        if (!storeRow) throw new RoleContextUnavailableError();
        const result = await client.query<{
          available_quantity: number;
          code: string;
          display_name: string;
          id: string;
          kind: "product" | "spare";
          low_stock_threshold: number;
          on_hand_quantity: number;
          reserved_quantity: number;
        }>(
          `select id, kind, code, display_name, on_hand_quantity,
                  reserved_quantity, low_stock_threshold,
                  on_hand_quantity - reserved_quantity as available_quantity
             from inventory_items
            where sandbox_id = $1 and store_id = $2
            order by kind, display_name, id`,
          [input.sandboxId, context.actorStoreId],
        );
        const movementResult = await client.query<InventoryMovementRow>(
          `select movement.id as movement_id,
                  movement.inventory_item_id,
                  item.display_name as inventory_item_name,
                  coalesce(
                    movement.movement_kind,
                    case when movement.reason = 'order-waste' then 'waste' else 'sale' end
                  ) as movement_kind,
                  movement.on_hand_delta, movement.on_hand_after,
                  movement.reason, movement.order_id,
                  movement.compensates_movement_id as original_movement_id,
                  movement.business_occurred_at
             from inventory_movements movement
             join inventory_items item on item.id = movement.inventory_item_id
            where movement.sandbox_id = $1 and movement.store_id = $2
            order by movement.sequence desc
            limit 20`,
          [input.sandboxId, context.actorStoreId],
        );
        const latestMovementResult = await client.query<InventoryMovementRow>(
          `select distinct on (movement.inventory_item_id)
                  movement.id as movement_id,
                  movement.inventory_item_id,
                  item.display_name as inventory_item_name,
                  coalesce(
                    movement.movement_kind,
                    case when movement.reason = 'order-waste' then 'waste' else 'sale' end
                  ) as movement_kind,
                  movement.on_hand_delta, movement.on_hand_after,
                  movement.reason, movement.order_id,
                  movement.compensates_movement_id as original_movement_id,
                  movement.business_occurred_at
             from inventory_movements movement
             join inventory_items item on item.id = movement.inventory_item_id
            where movement.sandbox_id = $1 and movement.store_id = $2
            order by movement.inventory_item_id, movement.sequence desc`,
          [input.sandboxId, context.actorStoreId],
        );
        const movements = movementResult.rows.map(inventoryMovementFromRow);
        const latestMovementByItem = new Map(
          latestMovementResult.rows.map((movement) => [
            movement.inventory_item_id,
            inventoryMovementFromRow(movement),
          ]),
        );
        const items = result.rows.map((item) => ({
          alerting: item.available_quantity <= item.low_stock_threshold,
          availableQuantity: item.available_quantity,
          code: item.code,
          displayName: item.display_name,
          inventoryItemId: item.id,
          kind: item.kind,
          lowStockThreshold: item.low_stock_threshold,
          onHandQuantity: item.on_hand_quantity,
          recentMovement: latestMovementByItem.get(item.id) ?? null,
          reservedQuantity: item.reserved_quantity,
        }));
        await client.query("commit");
        return {
          currentTime,
          items,
          movements,
          store: {
            code: storeRow.code,
            displayName: storeRow.display_name,
          },
          summary: {
            alertCount: items.filter((item) => item.alerting).length,
            itemCount: items.length,
            productCount: items.filter((item) => item.kind === "product")
              .length,
            spareCount: items.filter((item) => item.kind === "spare").length,
          },
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readManagerAudits(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const { context, store } = await managerStoreWithClient(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        const selection = managerBusinessDaySelection(
          currentTime,
          input.fromBusinessDay,
          input.toBusinessDay,
        );
        const events = await managerAuditRowsWithClient(
          client,
          input,
          selection,
        );
        const options = await client.query<{
          actions: string[];
          object_types: string[];
          personas: Array<{ displayName: string; personaId: string }>;
          roles: PublicRole[];
        }>(
          `select
             coalesce(array_agg(distinct audit.action order by audit.action)
               filter (where audit.action is not null), '{}') as actions,
             coalesce(array_agg(distinct audit.object_type order by audit.object_type)
               filter (where audit.object_type is not null), '{}') as object_types,
             coalesce(array_agg(distinct audit.role order by audit.role)
               filter (where audit.role is not null), '{}') as roles,
             coalesce(jsonb_agg(distinct jsonb_build_object(
               'personaId', persona.id, 'displayName', persona.display_name
             )) filter (where persona.id is not null), '[]'::jsonb) as personas
           from audit_events audit
           left join demo_personas persona on persona.id = audit.persona_id
          where audit.sandbox_id = $1 and audit.store_id = $2`,
          [input.sandboxId, store.id],
        );
        const filterOptions = options.rows[0];
        await client.query("commit");
        return {
          availableBusinessDays: selection.availableBusinessDays,
          currentTime,
          events,
          filterOptions: {
            actions: filterOptions?.actions ?? [],
            objectTypes: filterOptions?.object_types ?? [],
            personas: (filterOptions?.personas ?? []).toSorted((left, right) =>
              left.displayName.localeCompare(right.displayName, "zh-CN"),
            ),
            roles: filterOptions?.roles ?? [],
          },
          range: {
            endsAt: selection.endsAt,
            fromBusinessDay: selection.fromBusinessDay,
            startsAt: selection.startsAt,
            toBusinessDay: selection.toBusinessDay,
          },
          sort: input.sort,
          store: {
            code: store.code,
            displayName: store.display_name,
            storeId: store.id,
          },
          totalCount: events.length,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readHeadquartersAudits(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertHeadquartersContext(
          client,
          input,
          wallTime,
        );
        const allStores = await client.query<ManagerScopedStore>(
          `select id, code, display_name from stores
            where sandbox_id = $1 and code = any($2::text[])
            order by array_position($2::text[], code)`,
          [input.sandboxId, HEADQUARTERS_FIXED_STORE_CODES],
        );
        if (allStores.rows.length !== HEADQUARTERS_FIXED_STORE_CODES.length) {
          throw new RoleContextUnavailableError();
        }
        const availableStoreIds = new Set(
          allStores.rows.map((store) => store.id),
        );
        if (
          input.selectedStoreIds.length < 1 ||
          input.selectedStoreIds.length >
            HEADQUARTERS_FIXED_STORE_CODES.length ||
          new Set(input.selectedStoreIds).size !==
            input.selectedStoreIds.length ||
          input.selectedStoreIds.some(
            (storeId) => !availableStoreIds.has(storeId),
          )
        ) {
          throw new ManagerAuditExportError("store-not-found");
        }
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const selection = managerBusinessDaySelection(
          currentTime,
          input.fromBusinessDay,
          input.toBusinessDay,
        );
        const includeChainScope =
          input.selectedStoreIds.length ===
          HEADQUARTERS_FIXED_STORE_CODES.length;
        const events = await headquartersAuditRowsWithClient(
          client,
          input,
          selection,
          includeChainScope,
        );
        const options = await client.query<{
          actions: string[];
          object_types: string[];
          personas: Array<{ displayName: string; personaId: string }>;
          roles: PublicRole[];
        }>(
          `select
             coalesce(array_agg(distinct audit.action order by audit.action)
               filter (where audit.action is not null), '{}') as actions,
             coalesce(array_agg(distinct audit.object_type order by audit.object_type)
               filter (where audit.object_type is not null), '{}') as object_types,
             coalesce(array_agg(distinct audit.role order by audit.role)
               filter (where audit.role is not null), '{}') as roles,
             coalesce(jsonb_agg(distinct jsonb_build_object(
               'personaId', persona.id, 'displayName', persona.display_name
             )) filter (where persona.id is not null), '[]'::jsonb) as personas
           from audit_events audit
           left join demo_personas persona on persona.id = audit.persona_id
          where audit.sandbox_id = $1
            and (audit.store_id = any($2::uuid[])
              or ($3::boolean and audit.store_id is null))`,
          [input.sandboxId, input.selectedStoreIds, includeChainScope],
        );
        const filterOptions = options.rows[0];
        await client.query("commit");
        return {
          availableBusinessDays: selection.availableBusinessDays,
          currentTime,
          events,
          filterOptions: {
            actions: filterOptions?.actions ?? [],
            objectTypes: filterOptions?.object_types ?? [],
            personas: (filterOptions?.personas ?? []).toSorted((left, right) =>
              left.displayName.localeCompare(right.displayName, "zh-CN"),
            ),
            roles: filterOptions?.roles ?? [],
          },
          range: {
            endsAt: selection.endsAt,
            fromBusinessDay: selection.fromBusinessDay,
            startsAt: selection.startsAt,
            toBusinessDay: selection.toBusinessDay,
          },
          selectedStoreIds: input.selectedStoreIds,
          sort: input.sort,
          stores: allStores.rows.map((store) => ({
            code: store.code,
            displayName: store.display_name,
            storeId: store.id,
          })),
          totalCount: events.length,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async prepareManagerExport(input) {
      return executeManagerExport(input, false);
    },
    async createManagerExport(input) {
      return executeManagerExport(input, true);
    },
    async recordHeadquartersExport(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertHeadquartersContext(
          client,
          input,
          wallTime,
        );
        const stores = await client.query<{ id: string }>(
          `select id from stores
            where sandbox_id = $1 and id = any($2::uuid[])
              and code = any($3::text[])`,
          [
            input.sandboxId,
            input.stores.map((store) => store.storeId),
            HEADQUARTERS_FIXED_STORE_CODES,
          ],
        );
        if (
          input.stores.length < 1 ||
          new Set(input.stores.map((store) => store.storeId)).size !==
            input.stores.length ||
          stores.rows.length !== input.stores.length
        ) {
          throw new ManagerAuditExportError("store-not-found");
        }
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const selection = managerBusinessDaySelection(
          currentTime,
          input.fromBusinessDay,
          input.toBusinessDay,
        );
        const ids = input.stores.map(() => randomUUID());
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) select event_id, sandbox_id, store_id, persona_id, 'hq',
                    'export.csv', 'export', null, 'allowed', null, request_id,
                    null, after_data, business_occurred_at, recorded_at
               from unnest(
                 $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::uuid[],
                 $6::jsonb[], $7::timestamptz[], $8::timestamptz[]
               ) as item(event_id, sandbox_id, store_id, persona_id,
                         request_id, after_data, business_occurred_at, recorded_at)`,
          [
            ids,
            input.stores.map(() => input.sandboxId),
            input.stores.map((store) => store.storeId),
            input.stores.map(() => input.personaId),
            input.stores.map(() => input.requestId),
            input.stores.map((store) =>
              JSON.stringify({
                dataType: input.dataType,
                filters: input.filters,
                fromBusinessDay: selection.fromBusinessDay,
                rowCount: store.rowCount,
                sortDirection: input.sort.direction,
                sortField: input.sort.field,
                toBusinessDay: selection.toBusinessDay,
              }),
            ),
            input.stores.map(() => currentTime),
            input.stores.map(() => wallTime),
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
    async readManagerDashboard(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        let sandbox: SandboxRow;
        let targetStoreId: string;
        if (input.role === "hq") {
          sandbox = await assertHeadquartersContext(
            client,
            { ...input, role: "hq" },
            wallTime,
          );
          if (!input.storeId) throw new RoleContextStaleError();
          targetStoreId = input.storeId;
        } else {
          const context = await assertFrontlineContext(
            client,
            { ...input, role: input.role },
            wallTime,
          );
          if (input.role !== "manager") throw new RoleContextStaleError();
          sandbox = context.sandbox;
          targetStoreId = context.actorStoreId;
        }
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        await processFrontlineReservationDeadlines(client, {
          currentTime,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
        });
        await processDueAttendanceAbsences(client, {
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        await processDueHandoverExceptions(client, {
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });

        const store = await client.query<{
          closes_at: string;
          closes_next_day: boolean;
          code: string;
          display_name: string;
          id: string;
          is_open_24_hours: boolean;
          opens_at: string;
        }>(
          `select id, code, display_name, opens_at, closes_at,
                  closes_next_day, is_open_24_hours
             from stores where sandbox_id = $1 and id = $2
              and code = any($3::text[])`,
          [input.sandboxId, targetStoreId, HEADQUARTERS_FIXED_STORE_CODES],
        );
        const storeRow = store.rows[0];
        if (!storeRow) throw new RoleContextUnavailableError();

        const availableBusinessDays = managerDashboardBusinessDays(currentTime);
        if (
          (input.fromBusinessDay && !input.toBusinessDay) ||
          (!input.fromBusinessDay && input.toBusinessDay)
        ) {
          throw new ManagerDashboardRangeError("incomplete-range");
        }
        const fromBusinessDay =
          input.fromBusinessDay ?? availableBusinessDays.at(-1)!.key;
        const toBusinessDay =
          input.toBusinessDay ?? availableBusinessDays.at(-1)!.key;
        const fromIndex = availableBusinessDays.findIndex(
          (day) => day.key === fromBusinessDay,
        );
        const toIndex = availableBusinessDays.findIndex(
          (day) => day.key === toBusinessDay,
        );
        if (fromIndex < 0 || toIndex < 0) {
          throw new ManagerDashboardRangeError("outside-seed-range");
        }
        if (fromIndex > toIndex) {
          throw new ManagerDashboardRangeError("reversed-range");
        }

        const baselineHours: StoreBusinessHoursSelection = storeRow;
        const businessWindows = [];
        for (const day of availableBusinessDays) {
          const hours = await businessHoursFor(client, {
            at: day.startsAt,
            baseline: baselineHours,
            sandboxId: input.sandboxId,
            storeId: targetStoreId,
          });
          businessWindows.push(dashboardBusinessWindow(day, hours));
        }
        const selectedWindows = businessWindows.slice(fromIndex, toIndex + 1);
        const trendWindows = businessWindows.slice(-7);
        const selectedKeys = new Set(selectedWindows.map((day) => day.key));
        const currentBusinessDay = businessDayKey(currentTime);

        const activeSeats = await client.query<{ count: number }>(
          `select count(*)::integer as count from seats
            where sandbox_id = $1 and store_id = $2
              and lifecycle_status = 'active'`,
          [input.sandboxId, targetStoreId],
        );
        const reservations = await client.query<{
          completed_business_at: Date | null;
          customer_display_name: string;
          id: string;
          price_snapshot: ReservationSnapshotRecord | null;
          refund_cents: number;
          seat_code: string;
          simulated_payment_cents: number | null;
          started_business_at: Date | null;
          starts_at: Date;
          status: ReservationStatus;
          terminal_reason: string | null;
        }>(
          `select reservation.id, reservation.status, reservation.starts_at,
                  reservation.started_business_at,
                  reservation.completed_business_at,
                  reservation.simulated_payment_cents,
                  reservation.price_snapshot, reservation.terminal_reason,
                  seat.code as seat_code,
                  customer.display_name as customer_display_name,
                  coalesce((
                    select sum(refund.amount_cents)::integer
                      from reservation_simulated_refunds refund
                     where refund.sandbox_id = reservation.sandbox_id
                       and refund.reservation_id = reservation.id
                  ), 0) as refund_cents
             from reservations reservation
             join seats seat on seat.id = reservation.seat_id
             join demo_personas customer
               on customer.id = reservation.customer_persona_id
            where reservation.sandbox_id = $1 and reservation.store_id = $2
            order by reservation.starts_at, reservation.id`,
          [input.sandboxId, targetStoreId],
        );
        const orders = await client.query<{
          cancelled_business_at: Date | null;
          completed_business_at: Date | null;
          created_business_at: Date;
          customer_display_name: string;
          id: string;
          order_snapshot: CustomerOrderSnapshot;
          refund_cents: number;
          seat_code: string;
          simulated_payment_cents: number | null;
          status: CustomerOrderStatus;
          wasted_quantity: number;
        }>(
          `select orders.id, orders.status, orders.created_business_at,
                  orders.completed_business_at, orders.cancelled_business_at,
                  orders.simulated_payment_cents, orders.order_snapshot,
                  seat.code as seat_code,
                  customer.display_name as customer_display_name,
                  coalesce((
                    select sum(refund.amount_cents)::integer
                      from order_simulated_refunds refund
                     where refund.sandbox_id = orders.sandbox_id
                       and refund.order_id = orders.id
                  ), 0) as refund_cents,
                  coalesce((
                    select sum(item.quantity)::integer
                      from order_inventory_reservations item
                     where item.sandbox_id = orders.sandbox_id
                       and item.order_id = orders.id and item.status = 'wasted'
                  ), 0) as wasted_quantity
             from customer_orders orders
             join seats seat on seat.id = orders.seat_id
             join demo_personas customer
               on customer.id = orders.customer_persona_id
            where orders.sandbox_id = $1 and orders.store_id = $2
            order by orders.created_business_at, orders.id`,
          [input.sandboxId, targetStoreId],
        );
        const repairs = await client.query<{
          closed_business_at: Date | null;
          created_business_at: Date;
          description: string;
          id: string;
          priority: "high" | "normal" | "urgent";
          processing_business_at: Date | null;
          seat_code: string;
          status: "assigned" | "closed" | "new" | "processing" | "verification";
        }>(
          `select repair.id, repair.description, repair.priority,
                  repair.status, repair.created_business_at,
                  repair.processing_business_at, repair.closed_business_at,
                  seat.code as seat_code
             from repairs repair
             join seats seat on seat.id = repair.seat_id
            where repair.sandbox_id = $1 and repair.store_id = $2
            order by repair.created_business_at, repair.id`,
          [input.sandboxId, targetStoreId],
        );
        const attendance = await client.query<{
          business_occurred_at: Date;
          display_name: string;
          employee_code: string;
          id: string;
          outcome: "absent" | "late" | "on-time";
          status: AttendanceStatus;
        }>(
          `select attendance.id, attendance.status,
                  employee.display_name, employee.employee_code,
                  case
                    when attendance.status = 'absent' then 'absent'
                    when coalesce(latest_late.corrected_business_at,
                                       attendance.check_in_business_at)
                         > shift.starts_at then 'late'
                    else 'on-time'
                  end as outcome,
                  coalesce(latest_late.corrected_business_at,
                           attendance.check_in_business_at,
                           attendance.absence_business_at) as business_occurred_at
             from attendance_records attendance
             join employees employee on employee.id = attendance.employee_id
             join shifts shift on shift.id = attendance.shift_id
             left join lateral (
               select correction.corrected_business_at
                 from attendance_corrections correction
                where correction.sandbox_id = attendance.sandbox_id
                  and correction.attendance_record_id = attendance.id
                  and correction.correction_kind = 'late'
                order by correction.business_occurred_at desc,
                         correction.recorded_at desc, correction.id desc
                limit 1
             ) latest_late on true
            where attendance.sandbox_id = $1 and attendance.store_id = $2
            order by business_occurred_at, attendance.id`,
          [input.sandboxId, targetStoreId],
        );
        const handoverExceptions = await client.query<{
          business_occurred_at: Date;
          display_name: string;
          id: string;
          kind: HandoverExceptionKind;
        }>(
          `select exception.id, exception.kind,
                  exception.business_occurred_at, employee.display_name
             from handover_exceptions exception
             join shifts shift on shift.id = exception.shift_id
             join employees employee on employee.id = shift.employee_id
            where exception.sandbox_id = $1 and exception.store_id = $2
            order by exception.business_occurred_at, exception.id`,
          [input.sandboxId, targetStoreId],
        );
        const inventory = await client.query<{
          available_quantity: number;
          code: string;
          display_name: string;
          id: string;
          low_stock_threshold: number;
        }>(
          `select id, code, display_name, low_stock_threshold,
                  on_hand_quantity - reserved_quantity as available_quantity
             from inventory_items
            where sandbox_id = $1 and store_id = $2
              and on_hand_quantity - reserved_quantity <= low_stock_threshold
            order by display_name, id`,
          [input.sandboxId, targetStoreId],
        );

        const reservationFacts = reservations.rows
          .filter(
            (reservation) =>
              reservation.price_snapshot !== null &&
              reservation.simulated_payment_cents !== null,
          )
          .map((reservation) => ({
            completedAt: reservation.completed_business_at,
            id: reservation.id,
            paidCents: reservation.simulated_payment_cents!,
            priceSegments: reservation.price_snapshot!.price.segments.map(
              (segment) => ({
                amountCents: segment.amountCents,
                endsAt: new Date(segment.endsAt),
                startsAt: new Date(segment.startsAt),
              }),
            ),
            refundCents: reservation.refund_cents,
            refundFrom:
              reservation.status === "completed" &&
              reservation.refund_cents > 0 &&
              reservation.terminal_reason === "repair-device-failure"
                ? reservation.completed_business_at
                : null,
            startedAt: reservation.started_business_at,
            status: reservation.status,
          }));
        const reservationFactsById = new Map(
          reservationFacts.map((fact) => [fact.id, fact]),
        );
        const orderFacts = orders.rows.map((order) => ({
          completedAt: order.completed_business_at,
          createdAt: order.created_business_at,
          paidCents: order.simulated_payment_cents,
          refundCents: order.refund_cents,
          status: order.status,
          terminalAt:
            order.completed_business_at ?? order.cancelled_business_at,
          wasteCents:
            order.wasted_quantity > 0 ? order.order_snapshot.subtotalCents : 0,
          wasteQuantity: order.wasted_quantity,
        }));
        const repairFacts = repairs.rows.map((repair) => ({
          closedAt: repair.closed_business_at,
          createdAt: repair.created_business_at,
          priority: repair.priority,
          processingAt: repair.processing_business_at,
        }));
        const metricInput = {
          activeSeatCount: activeSeats.rows[0]?.count ?? 0,
          attendance: attendance.rows.map((item) => ({
            businessOccurredAt: item.business_occurred_at,
            outcome: item.outcome,
          })),
          currentTime,
          handoverExceptions: handoverExceptions.rows.map((item) => ({
            businessOccurredAt: item.business_occurred_at,
          })),
          inventory: {
            lowStockCount: inventory.rows.length,
          },
          orders: orderFacts,
          repairs: repairFacts,
          reservations: reservationFacts,
        } as const;
        const selectedMetrics = calculateManagerDashboardMetrics({
          ...metricInput,
          businessDays: selectedWindows,
        });
        const trendMetrics = calculateManagerDashboardMetrics({
          ...metricInput,
          businessDays: trendWindows,
        });

        const recentEvidence: DatabaseManagerDashboard["recentEvidence"] = [
          ...reservations.rows.flatMap((reservation) => {
            const occurredAt =
              reservation.completed_business_at ??
              reservation.started_business_at ??
              reservation.starts_at;
            return [
              {
                action: `reservation.${reservation.status}`,
                businessDayKey: businessDayKey(occurredAt),
                detail: `${reservation.customer_display_name} · ${reservation.seat_code}`,
                objectId: reservation.id,
                objectType: "reservation" as const,
                occurredAt,
                title: `预约${reservation.status === "completed" ? "已完成" : "状态更新"}`,
              },
            ];
          }),
          ...orders.rows.map((order) => {
            const occurredAt =
              order.completed_business_at ??
              order.cancelled_business_at ??
              order.created_business_at;
            return {
              action: `order.${order.status}`,
              businessDayKey: businessDayKey(occurredAt),
              detail: `${order.customer_display_name} · ${order.seat_code}`,
              objectId: order.id,
              objectType: "order" as const,
              occurredAt,
              title: `商品订单${order.status === "completed" ? "已完成" : "状态更新"}`,
            };
          }),
          ...repairs.rows.map((repair) => {
            const occurredAt =
              repair.closed_business_at ??
              repair.processing_business_at ??
              repair.created_business_at;
            return {
              action: `repair.${repair.status}`,
              businessDayKey: businessDayKey(occurredAt),
              detail: `${repair.seat_code} · ${repair.description}`,
              objectId: repair.id,
              objectType: "repair" as const,
              occurredAt,
              title: `报修${repair.status === "closed" ? "已关闭" : "状态更新"}`,
            };
          }),
          ...attendance.rows.map((item) => ({
            action: `attendance.${item.outcome}`,
            businessDayKey: businessDayKey(item.business_occurred_at),
            detail: `${item.display_name} · ${item.employee_code}`,
            objectId: item.id,
            objectType: "attendance" as const,
            occurredAt: item.business_occurred_at,
            title:
              item.outcome === "absent"
                ? "考勤缺勤"
                : item.outcome === "late"
                  ? "考勤迟到"
                  : "考勤准时",
          })),
          ...handoverExceptions.rows.map((item) => ({
            action: `handover.${item.kind}`,
            businessDayKey: businessDayKey(item.business_occurred_at),
            detail: item.display_name,
            objectId: item.id,
            objectType: "handover" as const,
            occurredAt: item.business_occurred_at,
            title: "交接异常",
          })),
        ]
          .filter((item) => selectedKeys.has(item.businessDayKey))
          .sort(
            (left, right) =>
              right.occurredAt.getTime() - left.occurredAt.getTime(),
          )
          .slice(0, 6);

        const rangeRows: Array<
          NonNullable<DatabaseManagerDashboard["drilldown"]>["rows"][number]
        > = [];
        for (const reservation of reservations.rows) {
          if (
            !reservation.price_snapshot ||
            reservation.simulated_payment_cents === null
          ) {
            continue;
          }
          const fact = reservationFactsById.get(reservation.id);
          if (!fact) continue;
          for (const segment of attributeManagerReservationRevenue(fact)) {
            if (!selectedKeys.has(segment.businessDayKey)) continue;
            rangeRows.push({
              amountCents: segment.amountCents,
              businessDayKey: segment.businessDayKey,
              detail: `${reservation.customer_display_name} · ${segment.startsAt.toISOString()}–${segment.endsAt.toISOString()}`,
              objectId: reservation.id,
              objectType: "reservation",
              occurredAt: segment.startsAt,
              status: reservation.status,
              title: `预约 ${reservation.seat_code} · 半小时价格片段`,
            });
          }
        }
        for (const order of orders.rows) {
          const occurredAt =
            order.completed_business_at ??
            order.cancelled_business_at ??
            order.created_business_at;
          const key = businessDayKey(occurredAt);
          if (!selectedKeys.has(key)) continue;
          rangeRows.push({
            amountCents:
              order.status === "completed" &&
              order.simulated_payment_cents !== null
                ? Math.max(
                    0,
                    order.simulated_payment_cents - order.refund_cents,
                  )
                : null,
            businessDayKey: key,
            detail: `${order.customer_display_name} · ${order.order_snapshot.lines.map((line) => `${line.productName}×${line.quantity}`).join("、")}`,
            objectId: order.id,
            objectType: "order",
            occurredAt,
            status: order.status,
            title: `商品订单 ${order.seat_code}`,
          });
        }
        for (const repair of repairs.rows) {
          const occurredAt =
            repair.closed_business_at ??
            repair.processing_business_at ??
            repair.created_business_at;
          const key = businessDayKey(occurredAt);
          if (!selectedKeys.has(key)) continue;
          rangeRows.push({
            amountCents: null,
            businessDayKey: key,
            detail: repair.description,
            objectId: repair.id,
            objectType: "repair",
            occurredAt,
            status: repair.status,
            title: `报修 ${repair.seat_code}`,
          });
        }
        for (const item of attendance.rows) {
          const key = businessDayKey(item.business_occurred_at);
          if (!selectedKeys.has(key)) continue;
          rangeRows.push({
            amountCents: null,
            businessDayKey: key,
            detail: `${item.display_name} · ${item.employee_code}`,
            objectId: item.id,
            objectType: "attendance",
            occurredAt: item.business_occurred_at,
            status: item.outcome,
            title: "考勤事实",
          });
        }
        for (const item of handoverExceptions.rows) {
          const key = businessDayKey(item.business_occurred_at);
          if (!selectedKeys.has(key)) continue;
          rangeRows.push({
            amountCents: null,
            businessDayKey: key,
            detail: item.display_name,
            objectId: item.id,
            objectType: "handover",
            occurredAt: item.business_occurred_at,
            status: item.kind,
            title: "交接异常",
          });
        }
        for (const item of inventory.rows) {
          rangeRows.push({
            amountCents: null,
            businessDayKey: currentBusinessDay,
            detail: `可用 ${item.available_quantity} · 阈值 ${item.low_stock_threshold}`,
            objectId: item.id,
            objectType: "inventory",
            occurredAt: currentTime,
            status: "low-stock",
            title: item.display_name,
          });
        }
        const drilldownRows =
          input.drilldown === "revenue"
            ? rangeRows.filter(
                (row) =>
                  row.amountCents !== null &&
                  (row.objectType === "order" ||
                    row.objectType === "reservation"),
              )
            : input.drilldown === "orders"
              ? rangeRows.filter((row) => row.objectType === "order")
              : input.drilldown === "repairs"
                ? rangeRows.filter((row) => row.objectType === "repair")
                : input.drilldown === "inventory"
                  ? rangeRows.filter((row) => row.objectType === "inventory")
                  : input.drilldown === "attendance"
                    ? rangeRows.filter((row) => row.objectType === "attendance")
                    : input.drilldown === "handover"
                      ? rangeRows.filter((row) => row.objectType === "handover")
                      : input.drilldown === "seats"
                        ? rangeRows.filter(
                            (row) =>
                              row.objectType === "reservation" ||
                              row.objectType === "repair",
                          )
                        : input.drilldown === "evidence"
                          ? recentEvidence.map((item) => ({
                              amountCents: null,
                              businessDayKey: item.businessDayKey,
                              detail: item.detail,
                              objectId: item.objectId,
                              objectType: item.objectType,
                              occurredAt: item.occurredAt,
                              status: item.action,
                              title: item.title,
                            }))
                          : [];

        const result: DatabaseManagerDashboard = {
          availableBusinessDays,
          currentTime,
          days: selectedMetrics.days,
          drilldown: input.drilldown
            ? {
                fromBusinessDay:
                  input.drilldown === "inventory"
                    ? currentBusinessDay
                    : fromBusinessDay,
                kind: input.drilldown,
                rows: drilldownRows.sort(
                  (left, right) =>
                    right.occurredAt.getTime() - left.occurredAt.getTime(),
                ),
                storeCode: storeRow.code,
                toBusinessDay:
                  input.drilldown === "inventory"
                    ? currentBusinessDay
                    : toBusinessDay,
              }
            : null,
          range: {
            endsAt: new Date(
              selectedWindows.at(-1)!.startsAt.getTime() + 24 * 60 * 60 * 1_000,
            ),
            fromBusinessDay,
            preset:
              input.fromBusinessDay || input.toBusinessDay
                ? "custom"
                : "current",
            startsAt: selectedWindows[0]!.startsAt,
            toBusinessDay,
          },
          recentEvidence,
          store: {
            code: storeRow.code,
            displayName: storeRow.display_name,
          },
          summary: selectedMetrics.summary,
          trend: trendMetrics.days,
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
    async readManagerPeopleSchedule(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        if (input.role !== "manager") throw new RoleContextStaleError();
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await processDueAttendanceAbsences(client, {
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
          targetBusinessTime: currentTime,
        });
        const store = await client.query<{
          code: string;
          display_name: string;
          id: string;
        }>(
          `select id, code, display_name from stores
            where sandbox_id = $1 and id = $2`,
          [input.sandboxId, context.actorStoreId],
        );
        const storeRow = store.rows[0];
        if (!storeRow) throw new RoleContextUnavailableError();
        const employees = await client.query<{
          active: boolean;
          config_version: number;
          current_or_future_shifts: number;
          display_name: string;
          employee_code: string;
          future_shifts: number;
          id: string;
          open_repair_assignments: number;
          protected: boolean;
          role: FrontlineRole;
        }>(
          `select employee.id, employee.employee_code, employee.display_name,
                  employee.role, employee.active, employee.protected,
                  employee.config_version,
                  (select count(*)::integer from shifts shift
                    where shift.sandbox_id = employee.sandbox_id
                      and shift.employee_id = employee.id
                      and shift.status = 'scheduled' and shift.ends_at > $3)
                    as current_or_future_shifts,
                  (select count(*)::integer from shifts shift
                    where shift.sandbox_id = employee.sandbox_id
                      and shift.employee_id = employee.id
                      and shift.status = 'scheduled' and shift.starts_at > $3)
                    as future_shifts,
                  (select count(*)::integer from repairs repair
                    where repair.sandbox_id = employee.sandbox_id
                      and repair.assigned_to_persona_id = employee.persona_id
                      and repair.status <> 'closed') as open_repair_assignments
             from employees employee
            where employee.sandbox_id = $1 and employee.store_id = $2
            order by employee.protected desc, employee.role desc,
                     employee.employee_code, employee.id`,
          [input.sandboxId, context.actorStoreId, currentTime],
        );
        const shifts = await client.query<{
          attendance_record_id: string | null;
          display_name: string;
          employee_code: string;
          employee_id: string;
          ends_at: Date;
          role: FrontlineRole;
          shift_id: string;
          starts_at: Date;
          status: "cancelled" | "scheduled";
        }>(
          `select shift.id as shift_id, shift.starts_at, shift.ends_at,
                  shift.status, employee.id as employee_id,
                  employee.employee_code, employee.display_name, employee.role,
                  attendance.id as attendance_record_id
             from shifts shift
             join employees employee on employee.id = shift.employee_id
             left join attendance_records attendance
               on attendance.sandbox_id = shift.sandbox_id
              and attendance.shift_id = shift.id
            where shift.sandbox_id = $1 and shift.store_id = $2
              and shift.ends_at > $3::timestamptz - interval '14 days'
              and shift.starts_at < $3::timestamptz + interval '8 days'
            order by shift.starts_at, employee.employee_code, shift.id`,
          [input.sandboxId, context.actorStoreId, currentTime],
        );
        const attendance = await client.query<{
          absence_business_at: Date | null;
          attendance_record_id: string;
          attendance_status: AttendanceStatus;
          check_in_business_at: Date | null;
          check_in_outcome: "late" | "on-time" | null;
          check_out_business_at: Date | null;
          display_name: string;
          employee_code: string;
          employee_id: string;
          ends_at: Date;
          shift_id: string;
          starts_at: Date;
        }>(
          `select attendance.id as attendance_record_id,
                  attendance.status as attendance_status,
                  attendance.check_in_outcome,
                  attendance.check_in_business_at,
                  attendance.check_out_business_at,
                  attendance.absence_business_at,
                  shift.id as shift_id, shift.starts_at, shift.ends_at,
                  employee.id as employee_id, employee.employee_code,
                  employee.display_name
             from attendance_records attendance
             join shifts shift on shift.id = attendance.shift_id
             join employees employee on employee.id = attendance.employee_id
            where attendance.sandbox_id = $1 and attendance.store_id = $2
            order by shift.starts_at desc, attendance.id`,
          [input.sandboxId, context.actorStoreId],
        );
        const correctionRows = await client.query<{
          attendance_record_id: string;
          business_occurred_at: Date;
          corrected_business_at: Date;
          corrected_by: string;
          correction_id: string;
          correction_kind: "absence" | "check-out" | "late";
          reason: string;
          recorded_at: Date;
        }>(
          `select correction.id as correction_id,
                  correction.attendance_record_id,
                  correction.correction_kind, correction.corrected_business_at,
                  correction.reason, correction.business_occurred_at,
                  correction.recorded_at,
                  actor.display_name as corrected_by
             from attendance_corrections correction
             join demo_personas actor
               on actor.id = correction.corrected_by_persona_id
            where correction.sandbox_id = $1 and correction.store_id = $2
            order by correction.business_occurred_at, correction.recorded_at,
                     correction.id`,
          [input.sandboxId, context.actorStoreId],
        );
        const correctionsByRecord = new Map<
          string,
          DatabaseManagerPeopleSchedule["attendance"][number]["corrections"]
        >();
        for (const correction of correctionRows.rows) {
          const current = correctionsByRecord.get(
            correction.attendance_record_id,
          );
          const item = {
            businessOccurredAt: correction.business_occurred_at,
            correctedBusinessAt: correction.corrected_business_at,
            correctedBy: correction.corrected_by,
            correctionId: correction.correction_id,
            correctionKind: correction.correction_kind,
            reason: correction.reason,
            recordedAt: correction.recorded_at,
          };
          correctionsByRecord.set(correction.attendance_record_id, [
            ...(current ?? []),
            item,
          ]);
        }
        const coverageStartsAt = new Date(
          Math.floor(currentTime.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS,
        );
        const coverageEndsAt = new Date(
          coverageStartsAt.getTime() + 48 * 60 * 60 * 1_000,
        );
        const coverageShifts = await client.query<{
          ends_at: Date;
          starts_at: Date;
        }>(
          `select shift.starts_at, shift.ends_at
             from shifts shift
             join employees employee on employee.id = shift.employee_id
            where shift.sandbox_id = $1 and shift.store_id = $2
              and shift.status = 'scheduled' and employee.active = true
              and employee.role = 'staff' and shift.starts_at < $3
              and shift.ends_at > $4
            order by shift.starts_at, shift.id`,
          [
            input.sandboxId,
            context.actorStoreId,
            coverageEndsAt,
            coverageStartsAt,
          ],
        );
        const result: DatabaseManagerPeopleSchedule = {
          attendance: attendance.rows.map((record) => ({
            attendanceRecordId: record.attendance_record_id,
            corrections:
              correctionsByRecord.get(record.attendance_record_id) ?? [],
            employee: {
              displayName: record.display_name,
              employeeCode: record.employee_code,
              employeeId: record.employee_id,
            },
            original: {
              absenceBusinessAt: record.absence_business_at,
              checkInBusinessAt: record.check_in_business_at,
              checkInOutcome: record.check_in_outcome,
              checkOutBusinessAt: record.check_out_business_at,
              status: record.attendance_status,
            },
            shiftId: record.shift_id,
            window: {
              endsAt: record.ends_at,
              startsAt: record.starts_at,
            },
          })),
          coverageWarnings: evaluateStaffCoverage({
            minimumStaff: 3,
            range: { endsAt: coverageEndsAt, startsAt: coverageStartsAt },
            shifts: coverageShifts.rows.map((shift) => ({
              endsAt: shift.ends_at,
              startsAt: shift.starts_at,
            })),
          }),
          currentTime,
          employees: employees.rows.map((employee) => ({
            active: employee.active,
            dependencies: {
              currentOrFutureShifts: employee.current_or_future_shifts,
              futureShifts: employee.future_shifts,
              openRepairAssignments: employee.open_repair_assignments,
            },
            displayName: employee.display_name,
            employeeCode: employee.employee_code,
            employeeId: employee.id,
            protected: employee.protected,
            role: employee.role,
            store: {
              code: storeRow.code,
              displayName: storeRow.display_name,
              fixed: true,
            },
            version: employee.config_version,
          })),
          shifts: shifts.rows.map((shift) => ({
            attendanceRecordId: shift.attendance_record_id,
            canManage:
              shift.status === "scheduled" &&
              shift.starts_at.getTime() > currentTime.getTime() &&
              shift.attendance_record_id === null,
            employee: {
              displayName: shift.display_name,
              employeeCode: shift.employee_code,
              employeeId: shift.employee_id,
              role: shift.role,
            },
            endsAt: shift.ends_at,
            shiftId: shift.shift_id,
            startsAt: shift.starts_at,
            status: shift.status,
          })),
          store: {
            code: storeRow.code,
            displayName: storeRow.display_name,
            fixed: true,
            storeId: storeRow.id,
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
    async previewManagerShiftCoverage(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        if (input.role !== "manager") throw new RoleContextStaleError();
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        try {
          if (input.storeId !== context.actorStoreId) {
            throw new ManagerPeopleConflictError("cross-store");
          }
          const preview = await managerShiftPreviewWithClient(client, input);
          await client.query("commit");
          return preview;
        } catch (error) {
          if (error instanceof ManagerPeopleConflictError) {
            await client.query(
              `insert into audit_events (
                 id, sandbox_id, store_id, persona_id, role, action,
                 object_type, object_id, result, reason, request_id,
                 before_data, after_data, business_occurred_at, recorded_at
               ) values ($1, $2, $3, $4, 'manager', 'manager.preview-shift',
                 $5, $6, 'denied', $7, $8, null, null, $9, $10)`,
              [
                randomUUID(),
                input.sandboxId,
                context.actorStoreId,
                input.personaId,
                input.shiftId ? "shift" : "employee",
                input.shiftId ?? input.employeeId,
                error.reason,
                input.requestId,
                currentTime,
                wallTime,
              ],
            );
            await client.query("commit");
          }
          throw error;
        }
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readHeadquartersPeopleSchedule(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertHeadquartersContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const stores = await client.query<{
          active_employee_count: number;
          attendance_anomaly_count: number;
          code: string;
          display_name: string;
          employee_count: number;
          future_shift_count: number;
          id: string;
          manager_count: number;
          staff_count: number;
        }>(
          `select store.id, store.code, store.display_name,
                  count(employee.id)::integer as employee_count,
                  (count(employee.id) filter (where employee.active))::integer
                    as active_employee_count,
                  (count(employee.id) filter (where employee.role = 'staff'))::integer
                    as staff_count,
                  (count(employee.id) filter (where employee.role = 'manager'))::integer
                    as manager_count,
                  (select count(*)::integer from attendance_records attendance
                    where attendance.sandbox_id = store.sandbox_id
                      and attendance.store_id = store.id
                      and (attendance.status = 'absent'
                        or attendance.check_in_outcome = 'late'))
                    as attendance_anomaly_count,
                  (select count(*)::integer from shifts shift
                    where shift.sandbox_id = store.sandbox_id
                      and shift.store_id = store.id and shift.status = 'scheduled'
                      and shift.starts_at > $2) as future_shift_count
             from stores store
             left join employees employee on employee.store_id = store.id
            where store.sandbox_id = $1
              and store.code = any($3::text[])
            group by store.id
            order by array_position($3::text[], store.code), store.code`,
          [input.sandboxId, currentTime, HEADQUARTERS_FIXED_STORE_CODES],
        );
        const startsAt = new Date(
          Math.floor(currentTime.getTime() / HALF_HOUR_MS) * HALF_HOUR_MS,
        );
        const endsAt = new Date(startsAt.getTime() + 48 * 60 * 60 * 1_000);
        const summaries: Array<
          DatabaseHeadquartersPeopleSchedule["stores"][number]
        > = [];
        for (const store of stores.rows) {
          const employees = await client.query<{
            active: boolean;
            display_name: string;
            employee_code: string;
            role: FrontlineRole;
          }>(
            `select employee_code, display_name, role, active
               from employees
              where sandbox_id = $1 and store_id = $2
              order by active desc, role, employee_code`,
            [input.sandboxId, store.id],
          );
          const futureShifts = await client.query<{
            display_name: string;
            employee_code: string;
            ends_at: Date;
            role: FrontlineRole;
            starts_at: Date;
          }>(
            `select shift.starts_at, shift.ends_at, employee.employee_code,
                    employee.display_name, employee.role
               from shifts shift
               join employees employee on employee.id = shift.employee_id
              where shift.sandbox_id = $1 and shift.store_id = $2
                and shift.status = 'scheduled' and shift.starts_at > $3
              order by shift.starts_at, employee.employee_code`,
            [input.sandboxId, store.id, currentTime],
          );
          const shifts = await client.query<{
            ends_at: Date;
            starts_at: Date;
          }>(
            `select shift.starts_at, shift.ends_at
               from shifts shift
               join employees employee on employee.id = shift.employee_id
              where shift.sandbox_id = $1 and shift.store_id = $2
                and shift.status = 'scheduled' and employee.active = true
                and employee.role = 'staff' and shift.starts_at < $3
                and shift.ends_at > $4`,
            [input.sandboxId, store.id, endsAt, startsAt],
          );
          const coverageWarnings = evaluateStaffCoverage({
            minimumStaff: 3,
            range: { endsAt, startsAt },
            shifts: shifts.rows.map((shift) => ({
              endsAt: shift.ends_at,
              startsAt: shift.starts_at,
            })),
          });
          summaries.push({
            activeEmployeeCount: store.active_employee_count,
            attendanceAnomalyCount: store.attendance_anomaly_count,
            coverage: { endsAt, startsAt, warnings: coverageWarnings },
            coverageWarnings: coverageWarnings.length,
            employees: employees.rows.map((employee) => ({
              active: employee.active,
              displayName: employee.display_name,
              employeeCode: employee.employee_code,
              role: employee.role,
            })),
            employeeCount: store.employee_count,
            futureShifts: futureShifts.rows.map((shift) => ({
              employee: {
                displayName: shift.display_name,
                employeeCode: shift.employee_code,
                role: shift.role,
              },
              endsAt: shift.ends_at,
              startsAt: shift.starts_at,
            })),
            futureShiftCount: store.future_shift_count,
            managerCount: store.manager_count,
            staffCount: store.staff_count,
            store: { code: store.code, displayName: store.display_name },
          });
        }
        await client.query("commit");
        return { currentTime, stores: summaries };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readHeadquartersCatalogs(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertHeadquartersContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const stores = await client.query<{
          code: string;
          display_name: string;
          id: string;
        }>(
          `select id, code, display_name from stores
            where sandbox_id = $1 and code = any($2::text[])
            order by array_position($2::text[], code), code`,
          [input.sandboxId, HEADQUARTERS_FIXED_STORE_CODES],
        );
        const products = await client.query<{
          archived: boolean;
          category: "drink" | "meal" | "snack" | "supply";
          code: string;
          config_version: number;
          description: string;
          id: string;
          name: string;
          store_configuration_count: number;
        }>(
          `select product.id, product.code, product.name, product.description,
                  product.category, product.archived, product.config_version,
                  (select count(*)::integer from store_products config
                    where config.sandbox_id = product.sandbox_id
                      and config.product_id = product.id)
                    as store_configuration_count
             from products product where product.sandbox_id = $1
            order by product.category, product.name, product.code`,
          [input.sandboxId],
        );
        const scopes = await client.query<{
          product_id: string;
          store_code: string;
          store_display_name: string;
          store_id: string;
        }>(
          `select scope.product_id, store.id as store_id,
                  store.code as store_code,
                  store.display_name as store_display_name
             from product_store_scopes scope
             join stores store on store.id = scope.store_id
            where scope.sandbox_id = $1
              and store.code = any($2::text[])
            order by store.display_name, store.code`,
          [input.sandboxId, HEADQUARTERS_FIXED_STORE_CODES],
        );
        const machineProfiles = await client.query<{
          archived: boolean;
          code: string;
          config_version: number;
          display_name: string;
          experience_description: string;
          historical_reference_count: number;
          id: string;
          seat_reference_count: number;
        }>(
          `select profile.id, profile.code, profile.display_name,
                  profile.experience_description, profile.archived,
                  profile.config_version,
                  (select count(*)::integer from seats seat
                    where seat.sandbox_id = profile.sandbox_id
                      and seat.machine_profile_id = profile.id)
                    as seat_reference_count,
                  ((select count(*) from reservations reservation
                      join seats seat on seat.id = reservation.seat_id
                     where reservation.sandbox_id = profile.sandbox_id
                       and seat.machine_profile_id = profile.id)
                    + (select count(*) from repairs repair
                        where repair.sandbox_id = profile.sandbox_id
                          and repair.machine_profile_id = profile.id))::integer
                    as historical_reference_count
             from machine_profiles profile where profile.sandbox_id = $1
            order by case profile.code
              when 'standard' then 1 when 'competitive' then 2
              when 'flagship' then 3 else 4 end,
              profile.display_name, profile.code`,
          [input.sandboxId],
        );
        await client.query("commit");
        return {
          currentTime,
          machineProfiles: machineProfiles.rows.map((profile) => ({
            archived: profile.archived,
            code: profile.code,
            displayName: profile.display_name,
            experienceDescription: profile.experience_description,
            historicalReferenceCount: profile.historical_reference_count,
            machineProfileId: profile.id,
            seatReferenceCount: profile.seat_reference_count,
            version: profile.config_version,
          })),
          products: products.rows.map((product) => ({
            archived: product.archived,
            availableStores: scopes.rows
              .filter((scope) => scope.product_id === product.id)
              .map((scope) => ({
                code: scope.store_code,
                displayName: scope.store_display_name,
                storeId: scope.store_id,
              })),
            category: product.category,
            code: product.code,
            description: product.description,
            displayName: product.name,
            productId: product.id,
            storeConfigurationCount: product.store_configuration_count,
            version: product.config_version,
          })),
          stores: stores.rows.map((store) => ({
            code: store.code,
            displayName: store.display_name,
            storeId: store.id,
          })),
        } satisfies DatabaseHeadquartersCatalogs;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async executeHeadquartersCatalogCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const sandbox = await assertHeadquartersContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const normalizedPayload = (() => {
          switch (input.action) {
            case "create-product":
              return {
                action: input.action,
                availableStoreIds: [...new Set(input.availableStoreIds)].sort(),
                category: input.category,
                code: input.code.trim(),
                description: input.description.trim(),
                displayName: input.displayName.trim(),
              };
            case "update-product":
              return {
                action: input.action,
                availableStoreIds: [...new Set(input.availableStoreIds)].sort(),
                category: input.category,
                description: input.description.trim(),
                displayName: input.displayName.trim(),
                expectedVersion: input.expectedVersion,
                productId: input.productId,
              };
            case "archive-product":
              return {
                action: input.action,
                expectedVersion: input.expectedVersion,
                productId: input.productId,
              };
            case "create-machine-profile":
              return {
                action: input.action,
                code: input.code.trim(),
                displayName: input.displayName.trim(),
                experienceDescription: input.experienceDescription.trim(),
              };
            case "update-machine-profile":
              return {
                action: input.action,
                displayName: input.displayName.trim(),
                expectedVersion: input.expectedVersion,
                experienceDescription: input.experienceDescription.trim(),
                machineProfileId: input.machineProfileId,
              };
            case "archive-machine-profile":
              return {
                action: input.action,
                expectedVersion: input.expectedVersion,
                machineProfileId: input.machineProfileId,
              };
          }
        })();
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(JSON.stringify(normalizedPayload));
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:hq-catalog:${idempotencyKeyHash}`,
          ],
        );
        const existing = await client.query<{
          payload_hash: string;
          result_data: DatabaseHeadquartersCatalogCommand;
        }>(
          `select payload_hash, result_data
             from headquarters_catalog_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const previous = existing.rows[0];
        if (previous) {
          if (previous.payload_hash !== payloadHash) {
            throw new HeadquartersCatalogConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return { ...previous.result_data, replayed: true };
        }

        const persist = async (
          result: Omit<DatabaseHeadquartersCatalogCommand, "replayed">,
          beforeData: unknown,
          afterData: unknown,
        ) => {
          const stored: DatabaseHeadquartersCatalogCommand = {
            ...result,
            replayed: false,
          };
          const objectType = result.action.includes("product")
            ? "product"
            : "machine_profile";
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, null, $3, 'hq', $4, $5, $6, 'allowed',
               null, $7, $8::jsonb, $9::jsonb, $10, $11)`,
            [
              randomUUID(),
              input.sandboxId,
              input.personaId,
              `headquarters-catalog.${result.action}`,
              objectType,
              result.objectId,
              input.requestId,
              beforeData === null ? null : JSON.stringify(beforeData),
              JSON.stringify(afterData),
              currentTime,
              wallTime,
            ],
          );
          await client.query(
            `insert into headquarters_catalog_command_requests (
               sandbox_id, actor_persona_id, command_type,
               idempotency_key_hash, payload_hash, result_data, created_at
             ) values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
            [
              input.sandboxId,
              input.personaId,
              input.action,
              idempotencyKeyHash,
              payloadHash,
              JSON.stringify(stored),
              wallTime,
            ],
          );
          await client.query("commit");
          return stored;
        };

        const productInputValid = (product: {
          availableStoreIds: ReadonlyArray<string>;
          category: string;
          description: string;
          displayName: string;
        }) =>
          product.displayName.trim().length >= 1 &&
          product.displayName.trim().length <= 60 &&
          product.description.trim().length >= 1 &&
          product.description.trim().length <= 240 &&
          ["drink", "meal", "snack", "supply"].includes(product.category) &&
          product.availableStoreIds.length >= 1 &&
          product.availableStoreIds.length <= 3 &&
          new Set(product.availableStoreIds).size ===
            product.availableStoreIds.length &&
          isSafeCatalogText(`${product.displayName}${product.description}`);
        const machineProfileInputValid = (profile: {
          displayName: string;
          experienceDescription: string;
        }) =>
          profile.displayName.trim().length >= 1 &&
          profile.displayName.trim().length <= 60 &&
          profile.experienceDescription.trim().length >= 1 &&
          profile.experienceDescription.trim().length <= 240 &&
          isSafeCatalogText(
            `${profile.displayName}${profile.experienceDescription}`,
          );
        const assertProductStores = async (storeIds: ReadonlyArray<string>) => {
          const stores = await client.query<{ id: string }>(
            `select id from stores
              where sandbox_id = $1 and id = any($2::uuid[])
                and code = any($3::text[])`,
            [input.sandboxId, storeIds, HEADQUARTERS_FIXED_STORE_CODES],
          );
          if (stores.rows.length !== storeIds.length) {
            throw new HeadquartersCatalogConflictError("product-store-scope");
          }
        };
        const createMissingStoreConfigurations = async (product: {
          code: string;
          displayName: string;
          productId: string;
          storeIds: ReadonlyArray<string>;
        }) => {
          const existingConfigurations = await client.query<{
            store_id: string;
          }>(
            `select store_id from store_products
              where sandbox_id = $1 and product_id = $2`,
            [input.sandboxId, product.productId],
          );
          const configured = new Set(
            existingConfigurations.rows.map(
              (configuration) => configuration.store_id,
            ),
          );
          for (const storeId of product.storeIds) {
            if (configured.has(storeId)) continue;
            const inventoryItemId = randomUUID();
            await client.query(
              `insert into inventory_items (
                 id, sandbox_id, store_id, product_id, kind, code, display_name,
                 on_hand_quantity, reserved_quantity, low_stock_threshold
               ) values ($1, $2, $3, $4, 'product', $5, $6, 0, 0, 0)`,
              [
                inventoryItemId,
                input.sandboxId,
                storeId,
                product.productId,
                product.code,
                product.displayName,
              ],
            );
            await client.query(
              `insert into store_products (
                 id, sandbox_id, store_id, product_id, inventory_item_id,
                 listed, unit_price_cents, archived, config_version
               ) values ($1, $2, $3, $4, $5, false, 0, false, 1)`,
              [
                randomUUID(),
                input.sandboxId,
                storeId,
                product.productId,
                inventoryItemId,
              ],
            );
          }
        };

        if (input.action === "create-product") {
          if (
            !productInputValid(input) ||
            !isValidCatalogCode(input.code.trim())
          ) {
            throw new HeadquartersCatalogConflictError("invalid-product");
          }
          await assertProductStores(input.availableStoreIds);
          const duplicate = await client.query<{ id: string }>(
            `select id from products where sandbox_id = $1 and code = $2`,
            [input.sandboxId, input.code.trim()],
          );
          if (duplicate.rows[0]) {
            throw new HeadquartersCatalogConflictError("code-conflict");
          }
          const productId = randomUUID();
          await client.query(
            `insert into products (
               id, sandbox_id, code, name, description, category,
               archived, config_version
             ) values ($1, $2, $3, $4, $5, $6, false, 1)`,
            [
              productId,
              input.sandboxId,
              input.code.trim(),
              input.displayName.trim(),
              input.description.trim(),
              input.category,
            ],
          );
          await client.query(
            `insert into product_store_scopes (sandbox_id, product_id, store_id)
             select $1, $2, unnest($3::uuid[])`,
            [input.sandboxId, productId, input.availableStoreIds],
          );
          await createMissingStoreConfigurations({
            code: input.code.trim(),
            displayName: input.displayName.trim(),
            productId,
            storeIds: input.availableStoreIds,
          });
          return await persist(
            { action: input.action, objectId: productId, version: 1 },
            null,
            normalizedPayload,
          );
        }

        if (input.action === "update-product") {
          if (!productInputValid(input)) {
            throw new HeadquartersCatalogConflictError("invalid-product");
          }
          await assertProductStores(input.availableStoreIds);
          const before = await client.query<{
            archived: boolean;
            category: string;
            code: string;
            config_version: number;
            description: string;
            name: string;
          }>(
            `select code, name, description, category, archived, config_version
               from products where sandbox_id = $1 and id = $2 for update`,
            [input.sandboxId, input.productId],
          );
          const beforeRow = before.rows[0];
          if (!beforeRow)
            throw new HeadquartersCatalogConflictError("not-found");
          if (beforeRow.archived)
            throw new HeadquartersCatalogConflictError("archived");
          if (beforeRow.config_version !== input.expectedVersion) {
            throw new HeadquartersCatalogConflictError("version-conflict");
          }
          const updated = await client.query<{ config_version: number }>(
            `update products set name = $3, description = $4, category = $5,
                    config_version = config_version + 1
              where sandbox_id = $1 and id = $2 returning config_version`,
            [
              input.sandboxId,
              input.productId,
              input.displayName.trim(),
              input.description.trim(),
              input.category,
            ],
          );
          await client.query(
            `update inventory_items set display_name = $3
              where sandbox_id = $1 and product_id = $2`,
            [input.sandboxId, input.productId, input.displayName.trim()],
          );
          await client.query(
            `delete from product_store_scopes
              where sandbox_id = $1 and product_id = $2`,
            [input.sandboxId, input.productId],
          );
          await client.query(
            `insert into product_store_scopes (sandbox_id, product_id, store_id)
             select $1, $2, unnest($3::uuid[])`,
            [input.sandboxId, input.productId, input.availableStoreIds],
          );
          await createMissingStoreConfigurations({
            code: beforeRow.code,
            displayName: input.displayName.trim(),
            productId: input.productId,
            storeIds: input.availableStoreIds,
          });
          return await persist(
            {
              action: input.action,
              objectId: input.productId,
              version: updated.rows[0]!.config_version,
            },
            beforeRow,
            normalizedPayload,
          );
        }

        if (input.action === "archive-product") {
          const before = await client.query<{
            archived: boolean;
            category: string;
            code: string;
            config_version: number;
            description: string;
            name: string;
          }>(
            `select code, name, description, category, archived, config_version
               from products where sandbox_id = $1 and id = $2 for update`,
            [input.sandboxId, input.productId],
          );
          const beforeRow = before.rows[0];
          if (!beforeRow)
            throw new HeadquartersCatalogConflictError("not-found");
          if (beforeRow.archived)
            throw new HeadquartersCatalogConflictError("archived");
          if (beforeRow.config_version !== input.expectedVersion) {
            throw new HeadquartersCatalogConflictError("version-conflict");
          }
          const archived = await client.query<{ config_version: number }>(
            `update products set archived = true,
                    config_version = config_version + 1
              where sandbox_id = $1 and id = $2 returning config_version`,
            [input.sandboxId, input.productId],
          );
          return await persist(
            {
              action: input.action,
              objectId: input.productId,
              version: archived.rows[0]!.config_version,
            },
            beforeRow,
            { archived: true },
          );
        }

        if (input.action === "create-machine-profile") {
          if (
            !machineProfileInputValid(input) ||
            !isValidCatalogCode(input.code.trim())
          ) {
            throw new HeadquartersCatalogConflictError(
              "invalid-machine-profile",
            );
          }
          const duplicate = await client.query<{ id: string }>(
            `select id from machine_profiles where sandbox_id = $1 and code = $2`,
            [input.sandboxId, input.code.trim()],
          );
          if (duplicate.rows[0]) {
            throw new HeadquartersCatalogConflictError("code-conflict");
          }
          const machineProfileId = randomUUID();
          await client.query(
            `insert into machine_profiles (
               id, sandbox_id, code, display_name, experience_description,
               archived, config_version
             ) values ($1, $2, $3, $4, $5, false, 1)`,
            [
              machineProfileId,
              input.sandboxId,
              input.code.trim(),
              input.displayName.trim(),
              input.experienceDescription.trim(),
            ],
          );
          return await persist(
            { action: input.action, objectId: machineProfileId, version: 1 },
            null,
            normalizedPayload,
          );
        }

        if (input.action === "update-machine-profile") {
          if (!machineProfileInputValid(input)) {
            throw new HeadquartersCatalogConflictError(
              "invalid-machine-profile",
            );
          }
          const before = await client.query<{
            archived: boolean;
            code: string;
            config_version: number;
            display_name: string;
            experience_description: string;
          }>(
            `select code, display_name, experience_description, archived,
                    config_version
               from machine_profiles
              where sandbox_id = $1 and id = $2 for update`,
            [input.sandboxId, input.machineProfileId],
          );
          const beforeRow = before.rows[0];
          if (!beforeRow) {
            throw new HeadquartersCatalogConflictError("not-found");
          }
          if (beforeRow.archived) {
            throw new HeadquartersCatalogConflictError("archived");
          }
          if (beforeRow.config_version !== input.expectedVersion) {
            throw new HeadquartersCatalogConflictError("version-conflict");
          }
          const updated = await client.query<{ config_version: number }>(
            `update machine_profiles
                set display_name = $3, experience_description = $4,
                    config_version = config_version + 1
              where sandbox_id = $1 and id = $2 returning config_version`,
            [
              input.sandboxId,
              input.machineProfileId,
              input.displayName.trim(),
              input.experienceDescription.trim(),
            ],
          );
          return await persist(
            {
              action: input.action,
              objectId: input.machineProfileId,
              version: updated.rows[0]!.config_version,
            },
            beforeRow,
            normalizedPayload,
          );
        }

        if (input.action === "archive-machine-profile") {
          const before = await client.query<{
            archived: boolean;
            code: string;
            config_version: number;
            display_name: string;
            experience_description: string;
          }>(
            `select code, display_name, experience_description, archived,
                    config_version
               from machine_profiles
              where sandbox_id = $1 and id = $2 for update`,
            [input.sandboxId, input.machineProfileId],
          );
          const beforeRow = before.rows[0];
          if (!beforeRow) {
            throw new HeadquartersCatalogConflictError("not-found");
          }
          if (beforeRow.archived) {
            throw new HeadquartersCatalogConflictError("archived");
          }
          if (beforeRow.config_version !== input.expectedVersion) {
            throw new HeadquartersCatalogConflictError("version-conflict");
          }
          const archived = await client.query<{ config_version: number }>(
            `update machine_profiles
                set archived = true, config_version = config_version + 1
              where sandbox_id = $1 and id = $2 returning config_version`,
            [input.sandboxId, input.machineProfileId],
          );
          return await persist(
            {
              action: input.action,
              objectId: input.machineProfileId,
              version: archived.rows[0]!.config_version,
            },
            beforeRow,
            { archived: true },
          );
        }

        throw new HeadquartersCatalogConflictError("invalid-machine-profile");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async executeManagerPeopleCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertFrontlineContext(client, input, wallTime);
        if (input.role !== "manager") throw new RoleContextStaleError();
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        const payload = (() => {
          switch (input.action) {
            case "create-employee":
              return {
                action: input.action,
                displayName: input.displayName,
                employeeCode: input.employeeCode,
                employeeRole: input.employeeRole,
                storeId: input.storeId,
              };
            case "update-employee":
              return {
                action: input.action,
                displayName: input.displayName,
                employeeCode: input.employeeCode,
                employeeId: input.employeeId,
                expectedVersion: input.expectedVersion,
                storeId: input.storeId,
              };
            case "deactivate-employee":
              return {
                action: input.action,
                employeeId: input.employeeId,
                expectedVersion: input.expectedVersion,
                storeId: input.storeId,
              };
            case "create-shift":
              return {
                action: input.action,
                employeeId: input.employeeId,
                endsAt: input.endsAt.toISOString(),
                startsAt: input.startsAt.toISOString(),
                storeId: input.storeId,
              };
            case "update-shift":
              return {
                action: input.action,
                endsAt: input.endsAt.toISOString(),
                shiftId: input.shiftId,
                startsAt: input.startsAt.toISOString(),
                storeId: input.storeId,
              };
            case "cancel-shift":
              return {
                action: input.action,
                shiftId: input.shiftId,
                storeId: input.storeId,
              };
            case "correct-attendance":
              return {
                action: input.action,
                attendanceRecordId: input.attendanceRecordId,
                correctedBusinessAt: input.correctedBusinessAt.toISOString(),
                correctionKind: input.correctionKind,
                reason: input.reason,
                storeId: input.storeId,
              };
          }
        })();
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const payloadHash = hash(JSON.stringify(payload));
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:manager-people:${input.action}:${idempotencyKeyHash}`,
          ],
        );
        const previous = await client.query<{
          payload_hash: string;
          result_data: StoredManagerPeopleCommand;
        }>(
          `select payload_hash, result_data
             from manager_people_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and command_type = $3 and idempotency_key_hash = $4`,
          [input.sandboxId, input.personaId, input.action, idempotencyKeyHash],
        );
        const previousRow = previous.rows[0];
        if (previousRow) {
          if (previousRow.payload_hash !== payloadHash) {
            throw new ManagerPeopleConflictError("idempotency-conflict");
          }
          await client.query("commit");
          return managerPeopleCommandFromStored(previousRow.result_data, true);
        }

        const recordAudit = async (inputAudit: {
          readonly after?: unknown;
          readonly before?: unknown;
          readonly objectId?: string;
          readonly objectType: "attendance" | "employee" | "shift";
          readonly reason?: ManagerPeopleConflictReason;
          readonly result: "allowed" | "denied";
        }) => {
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4, 'manager', $5, $6, $7, $8, $9,
               $10, $11::jsonb, $12::jsonb, $13, $14)`,
            [
              randomUUID(),
              input.sandboxId,
              context.actorStoreId,
              input.personaId,
              `manager.${input.action}`,
              inputAudit.objectType,
              inputAudit.objectId ?? null,
              inputAudit.result,
              inputAudit.reason ?? null,
              input.requestId,
              inputAudit.before === undefined
                ? null
                : JSON.stringify(inputAudit.before),
              inputAudit.after === undefined
                ? null
                : JSON.stringify(inputAudit.after),
              currentTime,
              wallTime,
            ],
          );
        };
        const deny = async (
          reason: ManagerPeopleConflictReason,
          objectType: "attendance" | "employee" | "shift",
          objectId?: string,
          before?: unknown,
        ): Promise<never> => {
          await recordAudit({
            before,
            objectType,
            reason,
            result: "denied",
            ...(objectId === undefined ? {} : { objectId }),
          });
          await client.query("commit");
          throw new ManagerPeopleConflictError(reason);
        };
        if (input.storeId !== context.actorStoreId) {
          await deny("cross-store", "employee", undefined, {
            targetStoreId: input.storeId,
          });
        }
        const complete = async (
          objectId: string,
          objectType: "attendance" | "employee" | "shift",
          coverageWarnings: ReadonlyArray<StaffCoverageWarning>,
          before: unknown,
          after: unknown,
        ) => {
          const stored: StoredManagerPeopleCommand = {
            action: input.action,
            coverageWarnings: coverageWarnings.map((warning) => ({
              actualStaff: warning.actualStaff,
              endsAt: warning.endsAt.toISOString(),
              minimumStaff: warning.minimumStaff,
              startsAt: warning.startsAt.toISOString(),
            })),
            objectId,
          };
          await recordAudit({
            after,
            before,
            objectId,
            objectType,
            result: "allowed",
          });
          await client.query(
            `insert into manager_people_command_requests (
               sandbox_id, actor_persona_id, command_type,
               idempotency_key_hash, payload_hash, result_data
             ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              input.sandboxId,
              input.personaId,
              input.action,
              idempotencyKeyHash,
              payloadHash,
              JSON.stringify(stored),
            ],
          );
          await client.query("commit");
          return managerPeopleCommandFromStored(stored, false);
        };

        if (input.action === "create-employee") {
          let fields: ReturnType<typeof normalizeEmployeeFields>;
          try {
            fields = normalizeEmployeeFields(input);
          } catch {
            return await deny("invalid-employee", "employee");
          }
          const duplicate = await client.query<{ id: string }>(
            `select id from employees
              where sandbox_id = $1 and store_id = $2 and employee_code = $3`,
            [input.sandboxId, context.actorStoreId, fields.employeeCode],
          );
          if (duplicate.rows[0]) {
            return await deny(
              "duplicate-employee-code",
              "employee",
              duplicate.rows[0].id,
            );
          }
          const personaId = randomUUID();
          const employeeId = randomUUID();
          await client.query(
            `insert into demo_personas (
               id, sandbox_id, store_id, role, display_name, scope, protected
             ) values ($1, $2, $3, $4, $5, '所属门店背景员工', false)`,
            [
              personaId,
              input.sandboxId,
              context.actorStoreId,
              input.employeeRole,
              fields.displayName,
            ],
          );
          await client.query(
            `insert into employees (
               id, sandbox_id, store_id, persona_id, employee_code,
               display_name, role, active, protected
             ) values ($1, $2, $3, $4, $5, $6, $7, true, false)`,
            [
              employeeId,
              input.sandboxId,
              context.actorStoreId,
              personaId,
              fields.employeeCode,
              fields.displayName,
              input.employeeRole,
            ],
          );
          return await complete(employeeId, "employee", [], null, {
            active: true,
            displayName: fields.displayName,
            employeeCode: fields.employeeCode,
            protected: false,
            role: input.employeeRole,
          });
        }

        if (
          input.action === "update-employee" ||
          input.action === "deactivate-employee"
        ) {
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`${input.sandboxId}:employee:${input.employeeId}`],
          );
          const employee = await client.query<{
            active: boolean;
            config_version: number;
            display_name: string;
            employee_code: string;
            id: string;
            persona_id: string | null;
            protected: boolean;
            role: FrontlineRole;
            store_id: string;
          }>(
            `select id, store_id, persona_id, employee_code, display_name,
                    role, active, protected, config_version
               from employees where sandbox_id = $1 and id = $2
               for update`,
            [input.sandboxId, input.employeeId],
          );
          const employeeRow = employee.rows[0];
          if (!employeeRow || employeeRow.store_id !== context.actorStoreId) {
            return await deny(
              "employee-not-found",
              "employee",
              input.employeeId,
            );
          }
          const before = {
            active: employeeRow.active,
            displayName: employeeRow.display_name,
            employeeCode: employeeRow.employee_code,
            protected: employeeRow.protected,
            role: employeeRow.role,
            version: employeeRow.config_version,
          };
          if (employeeRow.protected) {
            return await deny(
              "protected-employee",
              "employee",
              employeeRow.id,
              before,
            );
          }
          if (employeeRow.config_version !== input.expectedVersion) {
            return await deny(
              "version-conflict",
              "employee",
              employeeRow.id,
              before,
            );
          }
          if (input.action === "update-employee") {
            if (!employeeRow.active) {
              return await deny(
                "inactive-employee",
                "employee",
                employeeRow.id,
                before,
              );
            }
            let fields: ReturnType<typeof normalizeEmployeeFields>;
            try {
              fields = normalizeEmployeeFields(input);
            } catch {
              return await deny(
                "invalid-employee",
                "employee",
                employeeRow.id,
                before,
              );
            }
            const duplicate = await client.query<{ id: string }>(
              `select id from employees
                where sandbox_id = $1 and store_id = $2
                  and employee_code = $3 and id <> $4`,
              [
                input.sandboxId,
                context.actorStoreId,
                fields.employeeCode,
                employeeRow.id,
              ],
            );
            if (duplicate.rows[0]) {
              return await deny(
                "duplicate-employee-code",
                "employee",
                employeeRow.id,
                before,
              );
            }
            await client.query(
              `update employees
                  set employee_code = $3, display_name = $4,
                      config_version = config_version + 1
                where sandbox_id = $1 and id = $2`,
              [
                input.sandboxId,
                employeeRow.id,
                fields.employeeCode,
                fields.displayName,
              ],
            );
            if (employeeRow.persona_id) {
              await client.query(
                `update demo_personas set display_name = $3
                  where sandbox_id = $1 and id = $2 and protected = false`,
                [input.sandboxId, employeeRow.persona_id, fields.displayName],
              );
            }
            return await complete(employeeRow.id, "employee", [], before, {
              ...before,
              displayName: fields.displayName,
              employeeCode: fields.employeeCode,
              version: employeeRow.config_version + 1,
            });
          }
          const dependencies = await client.query<{
            current_or_future_shifts: number;
            open_repairs: number;
          }>(
            `select
               (select count(*)::integer from shifts shift
                 where shift.sandbox_id = $1 and shift.employee_id = $2
                   and shift.status = 'scheduled' and shift.ends_at > $3)
                 as current_or_future_shifts,
               (select count(*)::integer from repairs repair
                 where repair.sandbox_id = $1
                   and repair.assigned_to_persona_id = $4
                   and repair.status <> 'closed') as open_repairs`,
            [
              input.sandboxId,
              employeeRow.id,
              currentTime,
              employeeRow.persona_id,
            ],
          );
          const dependency = dependencies.rows[0]!;
          if (
            dependency.current_or_future_shifts > 0 ||
            dependency.open_repairs > 0
          ) {
            return await deny(
              "employee-dependencies",
              "employee",
              employeeRow.id,
              { ...before, dependencies: dependency },
            );
          }
          await client.query(
            `update employees set active = false,
                    config_version = config_version + 1
              where sandbox_id = $1 and id = $2`,
            [input.sandboxId, employeeRow.id],
          );
          return await complete(employeeRow.id, "employee", [], before, {
            ...before,
            active: false,
            version: employeeRow.config_version + 1,
          });
        }

        if (
          input.action === "create-shift" ||
          input.action === "update-shift" ||
          input.action === "cancel-shift"
        ) {
          let employeeId: string;
          let shiftBefore: {
            attendanceRecordId: string | null;
            employeeId: string;
            endsAt: Date;
            shiftId: string;
            startsAt: Date;
            status: "cancelled" | "scheduled";
          } | null = null;
          if (input.action === "create-shift") {
            employeeId = input.employeeId;
          } else {
            const shift = await client.query<{
              attendance_record_id: string | null;
              employee_id: string;
              ends_at: Date;
              shift_id: string;
              starts_at: Date;
              status: "cancelled" | "scheduled";
              store_id: string;
            }>(
              `select shift.id as shift_id, shift.store_id, shift.employee_id,
                      shift.starts_at, shift.ends_at, shift.status,
                      attendance.id as attendance_record_id
                 from shifts shift
                 left join attendance_records attendance
                   on attendance.sandbox_id = shift.sandbox_id
                  and attendance.shift_id = shift.id
                where shift.sandbox_id = $1 and shift.id = $2
                for update of shift`,
              [input.sandboxId, input.shiftId],
            );
            const shiftRow = shift.rows[0];
            if (!shiftRow || shiftRow.store_id !== context.actorStoreId) {
              return await deny("shift-not-found", "shift", input.shiftId);
            }
            employeeId = shiftRow.employee_id;
            shiftBefore = {
              attendanceRecordId: shiftRow.attendance_record_id,
              employeeId,
              endsAt: shiftRow.ends_at,
              shiftId: shiftRow.shift_id,
              startsAt: shiftRow.starts_at,
              status: shiftRow.status,
            };
            if (shiftRow.attendance_record_id) {
              return await deny(
                "shift-attended",
                "shift",
                shiftRow.shift_id,
                shiftBefore,
              );
            }
            if (
              shiftRow.status !== "scheduled" ||
              shiftRow.starts_at.getTime() <= currentTime.getTime()
            ) {
              return await deny(
                "shift-not-future",
                "shift",
                shiftRow.shift_id,
                shiftBefore,
              );
            }
          }
          await client.query(
            "select pg_advisory_xact_lock(hashtextextended($1, 0))",
            [`${input.sandboxId}:employee:${employeeId}`],
          );
          if (input.action === "cancel-shift") {
            await client.query(
              `update shifts set status = 'cancelled'
                where sandbox_id = $1 and id = $2 and status = 'scheduled'`,
              [input.sandboxId, input.shiftId],
            );
            return await complete(input.shiftId, "shift", [], shiftBefore, {
              ...shiftBefore,
              status: "cancelled",
            });
          }
          if (input.startsAt.getTime() <= currentTime.getTime()) {
            return await deny(
              "shift-not-future",
              "shift",
              input.action === "update-shift" ? input.shiftId : undefined,
              shiftBefore,
            );
          }
          const preview = await managerShiftPreviewWithClient(client, {
            ...input,
            employeeId,
            ...(input.action === "update-shift"
              ? { shiftId: input.shiftId }
              : {}),
          });
          if (preview.validation.status === "invalid") {
            return await deny(
              preview.validation.reason === "overlap"
                ? "shift-overlap"
                : "invalid-shift",
              "shift",
              input.action === "update-shift" ? input.shiftId : undefined,
              shiftBefore,
            );
          }
          if (input.action === "create-shift") {
            const shiftId = randomUUID();
            await client.query(
              `insert into shifts (
                 id, sandbox_id, store_id, employee_id, starts_at, ends_at
               ) values ($1, $2, $3, $4, $5, $6)`,
              [
                shiftId,
                input.sandboxId,
                context.actorStoreId,
                employeeId,
                input.startsAt,
                input.endsAt,
              ],
            );
            return await complete(shiftId, "shift", preview.warnings, null, {
              employeeId,
              endsAt: input.endsAt,
              startsAt: input.startsAt,
              status: "scheduled",
            });
          }
          await client.query(
            `update shifts set starts_at = $3, ends_at = $4
              where sandbox_id = $1 and id = $2 and status = 'scheduled'`,
            [input.sandboxId, input.shiftId, input.startsAt, input.endsAt],
          );
          return await complete(
            input.shiftId,
            "shift",
            preview.warnings,
            shiftBefore,
            {
              ...shiftBefore,
              endsAt: input.endsAt,
              startsAt: input.startsAt,
            },
          );
        }

        const reason = input.reason.trim();
        if (!isSafePlainTextReason(reason)) {
          return await deny(
            "invalid-attendance-correction",
            "attendance",
            input.attendanceRecordId,
          );
        }
        const attendance = await client.query<{
          attendance_record_id: string;
          check_in_business_at: Date | null;
          check_out_business_at: Date | null;
          employee_id: string;
          shift_id: string;
          status: AttendanceStatus;
          store_id: string;
        }>(
          `select attendance.id as attendance_record_id,
                  attendance.store_id, attendance.employee_id,
                  attendance.shift_id, attendance.status,
                  attendance.check_in_business_at,
                  attendance.check_out_business_at
             from attendance_records attendance
            where attendance.sandbox_id = $1 and attendance.id = $2
            for share`,
          [input.sandboxId, input.attendanceRecordId],
        );
        const attendanceRow = attendance.rows[0];
        if (!attendanceRow || attendanceRow.store_id !== context.actorStoreId) {
          return await deny(
            "invalid-attendance-correction",
            "attendance",
            input.attendanceRecordId,
          );
        }
        const correctionMatchesFact =
          (input.correctionKind === "late" &&
            attendanceRow.check_in_business_at !== null) ||
          (input.correctionKind === "absence" &&
            attendanceRow.status === "absent") ||
          (input.correctionKind === "check-out" &&
            attendanceRow.check_out_business_at !== null);
        if (!correctionMatchesFact) {
          return await deny(
            "invalid-attendance-correction",
            "attendance",
            input.attendanceRecordId,
            { status: attendanceRow.status },
          );
        }
        const correctionId = randomUUID();
        await client.query(
          `insert into attendance_corrections (
             id, sandbox_id, store_id, employee_id, shift_id,
             attendance_record_id, corrected_by_persona_id, correction_kind,
             corrected_business_at, reason, business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            correctionId,
            input.sandboxId,
            context.actorStoreId,
            attendanceRow.employee_id,
            attendanceRow.shift_id,
            attendanceRow.attendance_record_id,
            input.personaId,
            input.correctionKind,
            input.correctedBusinessAt,
            reason,
            currentTime,
            wallTime,
          ],
        );
        return await complete(
          correctionId,
          "attendance",
          [],
          { attendanceRecordId: attendanceRow.attendance_record_id },
          {
            correctedBusinessAt: input.correctedBusinessAt,
            correctionKind: input.correctionKind,
            reason,
          },
        );
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async readManagerStoreConfiguration(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      let denialCommitted = false;
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertStoreConfigurationContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        if (!context.actorStoreId) {
          if (input.role === "hq") {
            await client.query(
              `insert into audit_events (
                 id, sandbox_id, store_id, persona_id, role, action,
                 object_type, object_id, result, reason, request_id,
                 before_data, after_data, business_occurred_at, recorded_at
               ) values ($1, $2, null, $3, $4, 'store-configuration.read',
                 'store', $5, 'denied', 'cross-store', $6, null,
                 $7::jsonb, $8, $9)`,
              [
                randomUUID(),
                input.sandboxId,
                input.personaId,
                input.role,
                input.storeId ?? null,
                input.requestId ?? randomUUID(),
                JSON.stringify({ storeId: input.storeId ?? null }),
                currentTime,
                wallTime,
              ],
            );
            await client.query("commit");
            denialCommitted = true;
          }
          throw new ManagerStoreConfigurationConflictError("cross-store");
        }
        await processFrontlineReservationDeadlines(client, {
          currentTime,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
        });
        const store = await client.query<{
          closes_at: string;
          closes_next_day: boolean;
          code: string;
          config_version: number;
          display_name: string;
          fictitious_city: string;
          id: string;
          introduction: string;
          is_open_24_hours: boolean;
          opens_at: string;
          seat_count: number;
        }>(
          `select id, code, display_name, fictitious_city, introduction,
                  seat_count, opens_at, closes_at, closes_next_day,
                  is_open_24_hours, config_version
             from stores where sandbox_id = $1 and id = $2`,
          [input.sandboxId, context.actorStoreId],
        );
        const storeRow = store.rows[0];
        if (!storeRow) throw new RoleContextUnavailableError();
        const areas = await client.query<{
          business_referenced: boolean;
          code: string;
          config_version: number;
          display_name: string;
          id: string;
          lifecycle_status: "active" | "archived" | "draft";
          seat_count: number;
          sort_order: number;
        }>(
          `select area.id, area.code, area.display_name, area.sort_order,
                  area.lifecycle_status, area.config_version,
                  count(seat.id)::integer as seat_count,
                  exists(select 1 from price_plans plan where plan.area_id = area.id)
                    or exists(
                      select 1 from seats referenced_seat
                       join reservations reservation on reservation.seat_id = referenced_seat.id
                      where referenced_seat.area_id = area.id
                    )
                    or exists(
                      select 1 from seats referenced_seat
                       join repairs repair on repair.seat_id = referenced_seat.id
                      where referenced_seat.area_id = area.id
                    ) as business_referenced
             from store_areas area
             left join seats seat on seat.area_id = area.id
            where area.sandbox_id = $1 and area.store_id = $2
            group by area.id
            order by area.sort_order, area.code`,
          [input.sandboxId, context.actorStoreId],
        );
        const seats = await client.query<{
          active_reservations: number;
          area_display_name: string;
          area_id: string;
          business_referenced: boolean;
          code: string;
          config_version: number;
          id: string;
          lifecycle_status: "active" | "inactive" | "draft";
          machine_code: MachineProfileCode;
          machine_display_name: string;
          machine_profile_id: string;
          open_repairs: number;
          operational_status: "maintenance" | "normal";
          sort_order: number;
        }>(
          `select seat.id, seat.code, seat.sort_order, seat.operational_status,
                  seat.lifecycle_status, seat.config_version,
                  area.id as area_id, area.display_name as area_display_name,
                  profile.id as machine_profile_id, profile.code as machine_code,
                  profile.display_name as machine_display_name,
                  (select count(*)::integer from reservations reservation
                    where reservation.seat_id = seat.id
                      and reservation.status = any($3::text[])) as active_reservations,
                  (select count(*)::integer from repairs repair
                    where repair.seat_id = seat.id and repair.status <> 'closed') as open_repairs,
                  exists(select 1 from reservations reservation where reservation.seat_id = seat.id)
                    or exists(select 1 from repairs repair where repair.seat_id = seat.id)
                    as business_referenced
             from seats seat
             join store_areas area on area.id = seat.area_id
             join machine_profiles profile on profile.id = seat.machine_profile_id
            where seat.sandbox_id = $1 and seat.store_id = $2
            order by area.sort_order, seat.sort_order, seat.code`,
          [
            input.sandboxId,
            context.actorStoreId,
            ["pending-confirmation", "confirmed", "arrived", "in-use"],
          ],
        );
        const machineProfiles = await client.query<{
          archived: boolean;
          code: MachineProfileCode;
          display_name: string;
          experience_description: string;
          id: string;
        }>(
          `select id, code, display_name, experience_description, archived
             from machine_profiles where sandbox_id = $1
            order by case code when 'standard' then 1 when 'competitive' then 2 else 3 end`,
          [input.sandboxId],
        );
        const pricePlans = await client.query<{
          area_code: string;
          area_display_name: string;
          area_id: string;
          base_hourly_cents: number;
          config_version: number;
          effective_from: Date;
          effective_until: Date | null;
          ends_at: string;
          ends_next_day: boolean;
          id: string;
          machine_code: MachineProfileCode;
          machine_display_name: string;
          machine_profile_id: string;
          pricing_model: "explicit-half-hour" | "legacy";
          starts_at: string;
          status: "active" | "archived";
          version: number;
          weekday_half_hour_cents: number;
          weekend_half_hour_cents: number;
        }>(
          `select plan.id, plan.version, plan.config_version,
                  plan.base_hourly_cents, plan.pricing_model,
                  plan.starts_at, plan.ends_at,
                  plan.ends_next_day, plan.weekday_half_hour_cents,
                  plan.weekend_half_hour_cents, plan.effective_from,
                  plan.effective_until, plan.status,
                  area.id as area_id, area.code as area_code,
                  area.display_name as area_display_name,
                  profile.id as machine_profile_id,
                  profile.code as machine_code,
                  profile.display_name as machine_display_name
             from price_plans plan
             join store_areas area on area.id = plan.area_id
             join machine_profiles profile on profile.id = plan.machine_profile_id
            where plan.sandbox_id = $1 and plan.store_id = $2
            order by area.sort_order, profile.code, plan.effective_from desc,
                     plan.version desc`,
          [input.sandboxId, context.actorStoreId],
        );
        const products = await client.query<{
          archived: boolean;
          available_quantity: number;
          business_referenced: boolean;
          config_version: number;
          inventory_item_id: string;
          listed: boolean;
          low_stock_threshold: number;
          on_hand_quantity: number;
          product_archived: boolean;
          product_category: "drink" | "meal" | "snack" | "supply";
          product_code: string;
          product_description: string;
          product_id: string;
          product_name: string;
          reserved_quantity: number;
          store_product_id: string;
          unit_price_cents: number;
        }>(
          `select config.id as store_product_id, config.listed,
                  config.unit_price_cents, config.archived,
                  config.config_version, product.id as product_id,
                  product.code as product_code, product.name as product_name,
                  product.description as product_description,
                  product.category as product_category,
                  product.archived as product_archived,
                  item.id as inventory_item_id, item.on_hand_quantity,
                  item.reserved_quantity, item.low_stock_threshold,
                  item.on_hand_quantity - item.reserved_quantity as available_quantity,
                  exists(select 1 from order_inventory_reservations reservation
                    where reservation.inventory_item_id = item.id) as business_referenced
             from store_products config
             join products product on product.id = config.product_id
             join product_store_scopes scope
               on scope.sandbox_id = config.sandbox_id
              and scope.product_id = config.product_id
              and scope.store_id = config.store_id
             join inventory_items item on item.id = config.inventory_item_id
            where config.sandbox_id = $1 and config.store_id = $2
            order by product.category, product.name, product.code`,
          [input.sandboxId, context.actorStoreId],
        );
        const scheduled = await client.query<{
          closes_at: string;
          closes_next_day: boolean;
          day_set: "all" | "weekdays" | "weekends";
          effective_from: Date;
          id: string;
          is_open_24_hours: boolean;
          opens_at: string;
        }>(
          `select id, day_set, opens_at, closes_at, closes_next_day,
                  is_open_24_hours, effective_from
             from store_business_hours_versions
            where sandbox_id = $1 and store_id = $2 and effective_from > $3
            order by effective_from, day_set`,
          [input.sandboxId, context.actorStoreId, currentTime],
        );
        const effective = await client.query<{
          closes_at: string;
          closes_next_day: boolean;
          day_set: "all" | "weekdays" | "weekends";
          effective_from: Date;
          id: string;
          is_open_24_hours: boolean;
          opens_at: string;
        }>(
          `select distinct on (day_set) id, day_set, opens_at, closes_at,
                  closes_next_day, is_open_24_hours, effective_from
             from store_business_hours_versions
            where sandbox_id = $1 and store_id = $2 and effective_from <= $3
            order by day_set, effective_from desc`,
          [input.sandboxId, context.actorStoreId, currentTime],
        );
        const currentHours = await businessHoursFor(client, {
          at: currentTime,
          baseline: storeRow,
          sandboxId: input.sandboxId,
          storeId: context.actorStoreId,
        });
        await client.query("commit");
        return {
          areas: areas.rows.map((area) => ({
            areaId: area.id,
            businessReferenced: area.business_referenced,
            code: area.code,
            displayName: area.display_name,
            lifecycleStatus: area.lifecycle_status,
            seatCount: area.seat_count,
            sortOrder: area.sort_order,
            version: area.config_version,
          })),
          businessHours: {
            baseline: {
              closesAt: storeRow.closes_at.slice(0, 5),
              closesNextDay: storeRow.closes_next_day,
              display: formatBusinessHours(storeRow),
              isOpen24Hours: storeRow.is_open_24_hours,
              opensAt: storeRow.opens_at.slice(0, 5),
            },
            current: {
              closesAt: currentHours.closes_at.slice(0, 5),
              closesNextDay: currentHours.closes_next_day,
              display: formatBusinessHours(currentHours),
              isOpen24Hours: currentHours.is_open_24_hours,
              opensAt: currentHours.opens_at.slice(0, 5),
            },
            effective: effective.rows.map((hours) => ({
              businessHoursId: hours.id,
              closesAt: hours.closes_at.slice(0, 5),
              closesNextDay: hours.closes_next_day,
              daySet: hours.day_set,
              effectiveFrom: hours.effective_from,
              isOpen24Hours: hours.is_open_24_hours,
              opensAt: hours.opens_at.slice(0, 5),
            })),
            scheduled: scheduled.rows.map((hours) => ({
              businessHoursId: hours.id,
              closesAt: hours.closes_at.slice(0, 5),
              closesNextDay: hours.closes_next_day,
              daySet: hours.day_set,
              effectiveFrom: hours.effective_from,
              isOpen24Hours: hours.is_open_24_hours,
              opensAt: hours.opens_at.slice(0, 5),
            })),
          },
          currentTime,
          machineProfiles: machineProfiles.rows.map((profile) => ({
            archived: profile.archived,
            code: profile.code,
            displayName: profile.display_name,
            experienceDescription: profile.experience_description,
            machineProfileId: profile.id,
          })),
          pricePlans: pricePlans.rows.map((plan) => ({
            area: {
              areaId: plan.area_id,
              code: plan.area_code,
              displayName: plan.area_display_name,
            },
            effectiveFrom: plan.effective_from,
            effectiveUntil: plan.effective_until,
            endsAt: plan.ends_at.slice(0, 5),
            endsNextDay: plan.ends_next_day,
            machineProfile: {
              code: plan.machine_code,
              displayName: plan.machine_display_name,
              machineProfileId: plan.machine_profile_id,
            },
            legacyWeekdayBreakdown:
              plan.pricing_model === "legacy"
                ? {
                    baseHalfHourCents: legacyHalfHourCents(
                      plan.base_hourly_cents,
                      10_000,
                    ),
                    eveningHalfHourCents: legacyHalfHourCents(
                      plan.base_hourly_cents,
                      12_000,
                    ),
                    overnightHalfHourCents: legacyHalfHourCents(
                      plan.base_hourly_cents,
                      9_000,
                    ),
                  }
                : null,
            pricePlanId: plan.id,
            pricingModel: plan.pricing_model,
            configVersion: plan.config_version,
            startsAt: plan.starts_at.slice(0, 5),
            status:
              plan.status === "archived"
                ? "archived"
                : plan.effective_from.getTime() > currentTime.getTime()
                  ? "scheduled"
                  : plan.effective_until &&
                      plan.effective_until.getTime() <= currentTime.getTime()
                    ? "historical"
                    : "current",
            store: {
              code: storeRow.code,
              displayName: storeRow.display_name,
            },
            version: plan.version,
            weekdayHalfHourCents: plan.weekday_half_hour_cents,
            weekendHalfHourCents: plan.weekend_half_hour_cents,
          })),
          products: products.rows.map((product) => ({
            alerting: product.available_quantity <= product.low_stock_threshold,
            archived: product.archived,
            availableQuantity: product.available_quantity,
            businessReferenced: product.business_referenced,
            headquartersProduct: {
              archived: product.product_archived,
              category: product.product_category,
              code: product.product_code,
              description: product.product_description,
              displayName: product.product_name,
              productId: product.product_id,
            },
            inventoryItemId: product.inventory_item_id,
            listed: product.listed,
            lowStockThreshold: product.low_stock_threshold,
            onHandQuantity: product.on_hand_quantity,
            reservedQuantity: product.reserved_quantity,
            storeProductId: product.store_product_id,
            unitPriceCents: product.unit_price_cents,
            version: product.config_version,
          })),
          seats: seats.rows.map((seat) => ({
            area: {
              areaId: seat.area_id,
              displayName: seat.area_display_name,
            },
            businessReferenced: seat.business_referenced,
            code: seat.code,
            dependencies: {
              activeReservations: seat.active_reservations,
              openRepairs: seat.open_repairs,
            },
            lifecycleStatus: seat.lifecycle_status,
            machineProfile: {
              code: seat.machine_code,
              displayName: seat.machine_display_name,
              machineProfileId: seat.machine_profile_id,
            },
            operationalStatus: seat.operational_status,
            seatId: seat.id,
            sortOrder: seat.sort_order,
            version: seat.config_version,
          })),
          store: {
            code: storeRow.code,
            displayName: storeRow.display_name,
            fictitiousCity: storeRow.fictitious_city,
            fixed: true,
            introduction: storeRow.introduction,
            seatCount: storeRow.seat_count,
            storeId: storeRow.id,
            version: storeRow.config_version,
          },
        } satisfies DatabaseManagerStoreConfiguration;
      } catch (error) {
        if (!denialCommitted) {
          await client.query("rollback").catch(() => undefined);
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async executeManagerStoreConfigurationCommand(input) {
      const client = await pool.connect();
      const wallTime = wallClock.now();
      let denialAudit: {
        readonly actorStoreId: string | null;
        readonly businessTime: Date;
        readonly commandPayload: unknown;
      } | null = null;
      let commandFingerprint: {
        readonly idempotencyKeyHash: string;
        readonly payloadHash: string;
      } | null = null;
      let idempotencySlotAvailable = false;
      let replayedDenial = false;
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const context = await assertStoreConfigurationContext(
          client,
          input,
          wallTime,
        );
        const currentTime = businessTimeForSandbox(context.sandbox, wallTime);
        await client.query("select set_config('app.actor_role', $1, true)", [
          input.role,
        ]);
        const idempotencyKeyHash = hash(input.idempotencyKey);
        const commandPayload = (() => {
          switch (input.action) {
            case "update-store-profile":
              return {
                action: input.action,
                displayName: input.displayName,
                expectedVersion: input.expectedVersion,
                fictitiousCity: input.fictitiousCity,
                introduction: input.introduction,
                storeId: input.storeId,
              };
            case "schedule-business-hours":
              return {
                action: input.action,
                closesAt: input.closesAt,
                closesNextDay: input.closesNextDay,
                daySet: input.daySet,
                effectiveFrom: input.effectiveFrom.toISOString(),
                expectedVersion: input.expectedVersion,
                isOpen24Hours: input.isOpen24Hours,
                opensAt: input.opensAt,
                storeId: input.storeId,
              };
            case "create-area":
              return {
                action: input.action,
                code: input.code,
                displayName: input.displayName,
                expectedVersion: input.expectedVersion,
                lifecycleStatus: input.lifecycleStatus,
                sortOrder: input.sortOrder,
                storeId: input.storeId,
              };
            case "create-seat":
              return {
                action: input.action,
                areaId: input.areaId,
                code: input.code,
                expectedVersion: input.expectedVersion,
                lifecycleStatus: input.lifecycleStatus,
                machineProfileId: input.machineProfileId,
                sortOrder: input.sortOrder,
                storeId: input.storeId,
              };
            case "create-price-plan":
              return {
                action: input.action,
                areaId: input.areaId,
                effectiveFrom: input.effectiveFrom.toISOString(),
                endsAt: input.endsAt,
                endsNextDay: input.endsNextDay,
                expectedVersion: input.expectedVersion,
                machineProfileId: input.machineProfileId,
                startsAt: input.startsAt,
                storeId: input.storeId,
                weekdayHalfHourCents: input.weekdayHalfHourCents,
                weekendHalfHourCents: input.weekendHalfHourCents,
              };
            case "archive-price-plan":
              return {
                action: input.action,
                expectedVersion: input.expectedVersion,
                pricePlanId: input.pricePlanId,
                storeId: input.storeId,
              };
            case "update-store-product":
              return {
                action: input.action,
                expectedVersion: input.expectedVersion,
                listed: input.listed,
                lowStockThreshold: input.lowStockThreshold,
                storeId: input.storeId,
                storeProductId: input.storeProductId,
                unitPriceCents: input.unitPriceCents,
              };
            case "archive-store-product":
              return {
                action: input.action,
                expectedVersion: input.expectedVersion,
                storeId: input.storeId,
                storeProductId: input.storeProductId,
              };
            case "update-seat":
              return {
                action: input.action,
                areaId: input.areaId,
                code: input.code,
                expectedVersion: input.expectedVersion,
                lifecycleStatus: input.lifecycleStatus,
                machineProfileId: input.machineProfileId,
                seatId: input.seatId,
                sortOrder: input.sortOrder,
                storeId: input.storeId,
              };
            case "update-area":
              return {
                action: input.action,
                areaId: input.areaId,
                displayName: input.displayName,
                expectedVersion: input.expectedVersion,
                lifecycleStatus: input.lifecycleStatus,
                sortOrder: input.sortOrder,
                storeId: input.storeId,
              };
            case "delete-area":
              return {
                action: input.action,
                areaId: input.areaId,
                expectedVersion: input.expectedVersion,
                storeId: input.storeId,
              };
            case "delete-seat":
              return {
                action: input.action,
                expectedVersion: input.expectedVersion,
                seatId: input.seatId,
                storeId: input.storeId,
              };
          }
        })();
        denialAudit = {
          actorStoreId: context.actorStoreId,
          businessTime: currentTime,
          commandPayload,
        };
        const payloadHash = hash(JSON.stringify(commandPayload));
        commandFingerprint = { idempotencyKeyHash, payloadHash };
        await client.query(
          "select pg_advisory_xact_lock(hashtextextended($1, 0))",
          [
            `${input.sandboxId}:${input.personaId}:store-config:${idempotencyKeyHash}`,
          ],
        );
        const existing = await client.query<{
          payload_hash: string;
          result_data: StoredManagerStoreConfigurationResult;
        }>(
          `select payload_hash, result_data
             from store_config_command_requests
            where sandbox_id = $1 and actor_persona_id = $2
              and idempotency_key_hash = $3`,
          [input.sandboxId, input.personaId, idempotencyKeyHash],
        );
        const existingRow = existing.rows[0];
        if (existingRow) {
          if (existingRow.payload_hash !== payloadHash) {
            throw new ManagerStoreConfigurationConflictError(
              "idempotency-conflict",
            );
          }
          if (
            isStoredManagerStoreConfigurationDenial(existingRow.result_data)
          ) {
            await client.query("commit");
            replayedDenial = true;
            throw new ManagerStoreConfigurationConflictError(
              existingRow.result_data.reason,
            );
          }
          await client.query("commit");
          return { ...existingRow.result_data, replayed: true };
        }
        idempotencySlotAvailable = true;
        if (!context.actorStoreId || context.actorStoreId !== input.storeId) {
          throw new ManagerStoreConfigurationConflictError("cross-store");
        }
        if (
          input.role === "hq" &&
          (input.action === "update-store-product" ||
            input.action === "archive-store-product")
        ) {
          throw new ManagerStoreConfigurationConflictError("capability-denied");
        }
        await processFrontlineReservationDeadlines(client, {
          currentTime,
          recordedAt: wallTime,
          sandboxId: input.sandboxId,
        });
        const commandStore = await client.query<{ config_version: number }>(
          `select config_version from stores
            where sandbox_id = $1 and id = $2 for update`,
          [input.sandboxId, input.storeId],
        );
        if (!commandStore.rows[0]) {
          throw new ManagerStoreConfigurationConflictError("cross-store");
        }
        const persistCommand = async (
          stored: DatabaseManagerStoreConfigurationCommand,
        ) => {
          await client.query(
            `insert into store_config_command_requests (
               sandbox_id, actor_persona_id, store_id, command_type,
               idempotency_key_hash, payload_hash, result_data, created_at
             ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
            [
              input.sandboxId,
              input.personaId,
              input.storeId,
              input.action,
              idempotencyKeyHash,
              payloadHash,
              JSON.stringify(stored),
              wallTime,
            ],
          );
          await client.query("commit");
          return stored;
        };
        if (input.action === "create-area") {
          const areaValid =
            /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.code) &&
            input.code.length <= 40 &&
            input.displayName.trim().length >= 1 &&
            input.displayName.trim().length <= 60 &&
            isSafeManagerConfigurationText(input.displayName) &&
            Number.isInteger(input.sortOrder) &&
            input.sortOrder >= 0;
          if (!areaValid) {
            throw new ManagerStoreConfigurationConflictError("invalid-area");
          }
          const lockedStore = await client.query<{ config_version: number }>(
            `select config_version from stores
              where sandbox_id = $1 and id = $2 for update`,
            [input.sandboxId, input.storeId],
          );
          if (!lockedStore.rows[0]) {
            throw new ManagerStoreConfigurationConflictError("cross-store");
          }
          if (lockedStore.rows[0].config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          const duplicate = await client.query<{ exists: boolean }>(
            `select exists(select 1 from store_areas
              where sandbox_id = $1 and store_id = $2 and code = $3) as exists`,
            [input.sandboxId, input.storeId, input.code],
          );
          if (duplicate.rows[0]?.exists) {
            throw new ManagerStoreConfigurationConflictError(
              "duplicate-area-code",
            );
          }
          const areaId = randomUUID();
          await client.query(
            `insert into store_areas (
               id, sandbox_id, store_id, code, display_name, sort_order,
               lifecycle_status
             ) values ($1, $2, $3, $4, $5, $6, $7)`,
            [
              areaId,
              input.sandboxId,
              input.storeId,
              input.code,
              input.displayName.trim(),
              input.sortOrder,
              input.lifecycleStatus,
            ],
          );
          const updated = await client.query<{ config_version: number }>(
            `update stores set config_version = config_version + 1
              where sandbox_id = $1 and id = $2 returning config_version`,
            [input.sandboxId, input.storeId],
          );
          const storeVersion = updated.rows[0]!.config_version;
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               'store-area.create',
               'store_area', $5, 'allowed', null, $6, null, $7::jsonb, $8, $9)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              areaId,
              input.requestId,
              JSON.stringify(commandPayload),
              currentTime,
              wallTime,
            ],
          );
          return persistCommand({
            action: input.action,
            objectId: areaId,
            replayed: false,
            version: storeVersion,
          });
        }
        if (input.action === "update-area") {
          const areaValid =
            input.displayName.trim().length >= 1 &&
            input.displayName.trim().length <= 60 &&
            isSafeManagerConfigurationText(input.displayName) &&
            Number.isInteger(input.sortOrder) &&
            input.sortOrder >= 0;
          if (!areaValid) {
            throw new ManagerStoreConfigurationConflictError("invalid-area");
          }
          const area = await client.query<{
            business_referenced: boolean;
            code: string;
            config_version: number;
            display_name: string;
            lifecycle_status: "active" | "archived" | "draft";
            active_seats: number;
            sort_order: number;
          }>(
            `select area.code, area.display_name, area.sort_order,
                    area.lifecycle_status, area.config_version,
                    (select count(*)::integer from seats seat
                      where seat.area_id = area.id
                        and seat.lifecycle_status = 'active') as active_seats,
                    exists(select 1 from price_plans plan where plan.area_id = area.id)
                      or exists(
                        select 1 from seats referenced_seat
                         join reservations reservation on reservation.seat_id = referenced_seat.id
                        where referenced_seat.area_id = area.id
                      )
                      or exists(
                        select 1 from seats referenced_seat
                         join repairs repair on repair.seat_id = referenced_seat.id
                        where referenced_seat.area_id = area.id
                      ) as business_referenced
               from store_areas area
              where area.sandbox_id = $1 and area.store_id = $2
                and area.id = $3 for update`,
            [input.sandboxId, input.storeId, input.areaId],
          );
          const areaRow = area.rows[0];
          if (!areaRow) {
            throw new ManagerStoreConfigurationConflictError("area-not-found");
          }
          if (areaRow.config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          if (
            input.lifecycleStatus === "archived" &&
            areaRow.active_seats > 0
          ) {
            throw new ManagerStoreConfigurationConflictError(
              "area-has-active-seats",
            );
          }
          const changesReferencedFields =
            areaRow.display_name !== input.displayName.trim() ||
            areaRow.sort_order !== input.sortOrder;
          const validAreaTransition =
            areaRow.lifecycle_status === input.lifecycleStatus ||
            (areaRow.lifecycle_status === "draft" &&
              input.lifecycleStatus === "active") ||
            (areaRow.lifecycle_status === "active" &&
              input.lifecycleStatus === "archived");
          if (!validAreaTransition) {
            throw new ManagerStoreConfigurationConflictError(
              "area-lifecycle-transition",
            );
          }
          const invalidReferencedAreaTransition = !(
            areaRow.lifecycle_status === input.lifecycleStatus ||
            (areaRow.lifecycle_status === "active" &&
              input.lifecycleStatus === "archived")
          );
          if (
            areaRow.business_referenced &&
            (changesReferencedFields || invalidReferencedAreaTransition)
          ) {
            throw new ManagerStoreConfigurationConflictError(
              "referenced-area-immutable",
            );
          }
          const updated = await client.query<{ config_version: number }>(
            `update store_areas set display_name = $4, sort_order = $5,
                lifecycle_status = $6, config_version = config_version + 1
              where sandbox_id = $1 and store_id = $2 and id = $3
            returning config_version`,
            [
              input.sandboxId,
              input.storeId,
              input.areaId,
              input.displayName.trim(),
              input.sortOrder,
              input.lifecycleStatus,
            ],
          );
          const version = updated.rows[0]!.config_version;
          await client.query(
            `update stores set config_version = config_version + 1
              where sandbox_id = $1 and id = $2`,
            [input.sandboxId, input.storeId],
          );
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               'store-area.update',
               'store_area', $5, 'allowed', null, $6, $7::jsonb, $8::jsonb,
               $9, $10)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              input.areaId,
              input.requestId,
              JSON.stringify(areaRow),
              JSON.stringify(commandPayload),
              currentTime,
              wallTime,
            ],
          );
          return persistCommand({
            action: input.action,
            objectId: input.areaId,
            replayed: false,
            version,
          });
        }
        if (input.action === "delete-area") {
          const area = await client.query<{
            code: string;
            config_version: number;
            display_name: string;
            lifecycle_status: "active" | "archived" | "draft";
            sort_order: number;
          }>(
            `select code, display_name, sort_order, lifecycle_status,
                    config_version
               from store_areas
              where sandbox_id = $1 and store_id = $2 and id = $3
              for update`,
            [input.sandboxId, input.storeId, input.areaId],
          );
          const areaRow = area.rows[0];
          if (!areaRow) {
            throw new ManagerStoreConfigurationConflictError("area-not-found");
          }
          if (areaRow.config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          const references = await client.query<{ referenced: boolean }>(
            `select exists(select 1 from seats where area_id = $1)
                or exists(select 1 from price_plans where area_id = $1)
                as referenced`,
            [input.areaId],
          );
          if (
            areaRow.lifecycle_status !== "draft" ||
            references.rows[0]?.referenced
          ) {
            throw new ManagerStoreConfigurationConflictError(
              "area-not-deletable",
            );
          }
          await client.query(
            `delete from store_areas
              where sandbox_id = $1 and store_id = $2 and id = $3`,
            [input.sandboxId, input.storeId, input.areaId],
          );
          const updated = await client.query<{ config_version: number }>(
            `update stores set config_version = config_version + 1
              where sandbox_id = $1 and id = $2 returning config_version`,
            [input.sandboxId, input.storeId],
          );
          const storeVersion = updated.rows[0]!.config_version;
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               'store-area.delete-draft',
               'store_area', $5, 'allowed', null, $6, $7::jsonb, null, $8, $9)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              input.areaId,
              input.requestId,
              JSON.stringify(areaRow),
              currentTime,
              wallTime,
            ],
          );
          return persistCommand({
            action: input.action,
            objectId: input.areaId,
            replayed: false,
            version: storeVersion,
          });
        }
        if (input.action === "create-seat") {
          const seatValid =
            /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(input.code) &&
            input.code.length <= 20 &&
            Number.isInteger(input.sortOrder) &&
            input.sortOrder >= 0;
          if (!seatValid) {
            throw new ManagerStoreConfigurationConflictError("invalid-seat");
          }
          const lockedStore = await client.query<{ config_version: number }>(
            `select config_version from stores
              where sandbox_id = $1 and id = $2 for update`,
            [input.sandboxId, input.storeId],
          );
          if (!lockedStore.rows[0]) {
            throw new ManagerStoreConfigurationConflictError("cross-store");
          }
          if (lockedStore.rows[0].config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          const area = await client.query<{
            lifecycle_status: "active" | "archived" | "draft";
          }>(
            `select lifecycle_status from store_areas
              where sandbox_id = $1 and store_id = $2 and id = $3`,
            [input.sandboxId, input.storeId, input.areaId],
          );
          if (
            !area.rows[0] ||
            area.rows[0].lifecycle_status === "archived" ||
            (input.lifecycleStatus === "active" &&
              area.rows[0].lifecycle_status !== "active")
          ) {
            throw new ManagerStoreConfigurationConflictError("area-not-found");
          }
          const profile = await client.query<{ exists: boolean }>(
            `select exists(select 1 from machine_profiles
              where sandbox_id = $1 and id = $2 and archived = false) as exists`,
            [input.sandboxId, input.machineProfileId],
          );
          if (!profile.rows[0]?.exists) {
            throw new ManagerStoreConfigurationConflictError(
              "machine-profile-not-found",
            );
          }
          const duplicate = await client.query<{ exists: boolean }>(
            `select exists(select 1 from seats
              where sandbox_id = $1 and store_id = $2 and code = $3) as exists`,
            [input.sandboxId, input.storeId, input.code],
          );
          if (duplicate.rows[0]?.exists) {
            throw new ManagerStoreConfigurationConflictError(
              "duplicate-seat-code",
            );
          }
          const seatId = randomUUID();
          await client.query(
            `insert into seats (
               id, sandbox_id, store_id, area_id, machine_profile_id, code,
               sort_order, operational_status, lifecycle_status
             ) values ($1, $2, $3, $4, $5, $6, $7, 'normal', $8)`,
            [
              seatId,
              input.sandboxId,
              input.storeId,
              input.areaId,
              input.machineProfileId,
              input.code,
              input.sortOrder,
              input.lifecycleStatus,
            ],
          );
          const updated = await client.query<{ config_version: number }>(
            `update stores set config_version = config_version + 1,
                seat_count = (select count(*)::integer from seats
                  where sandbox_id = $1 and store_id = $2
                    and lifecycle_status = 'active')
              where sandbox_id = $1 and id = $2 returning config_version`,
            [input.sandboxId, input.storeId],
          );
          const storeVersion = updated.rows[0]!.config_version;
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               'seat.create', 'seat', $5,
               'allowed', null, $6, null, $7::jsonb, $8, $9)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              seatId,
              input.requestId,
              JSON.stringify(commandPayload),
              currentTime,
              wallTime,
            ],
          );
          return persistCommand({
            action: input.action,
            objectId: seatId,
            replayed: false,
            version: storeVersion,
          });
        }
        if (input.action === "update-seat") {
          const seatValid =
            /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(input.code) &&
            input.code.length <= 20 &&
            Number.isInteger(input.sortOrder) &&
            input.sortOrder >= 0;
          if (!seatValid) {
            throw new ManagerStoreConfigurationConflictError("invalid-seat");
          }
          const seat = await client.query<{
            area_id: string;
            business_referenced: boolean;
            code: string;
            config_version: number;
            lifecycle_status: "active" | "inactive" | "draft";
            machine_profile_id: string;
            operational_status: "maintenance" | "normal";
            sort_order: number;
          }>(
            `select seat.area_id, seat.machine_profile_id, seat.code,
                    seat.sort_order, seat.operational_status,
                    seat.lifecycle_status, seat.config_version,
                    exists(select 1 from reservations reservation
                      where reservation.seat_id = seat.id)
                      or exists(select 1 from repairs repair
                        where repair.seat_id = seat.id) as business_referenced
               from seats seat
              where seat.sandbox_id = $1 and seat.store_id = $2
                and seat.id = $3 for update`,
            [input.sandboxId, input.storeId, input.seatId],
          );
          const seatRow = seat.rows[0];
          if (!seatRow) {
            throw new ManagerStoreConfigurationConflictError("seat-not-found");
          }
          if (seatRow.config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          const dependencies = await client.query<{
            active_reservations: number;
            open_repairs: number;
          }>(
            `select
               (select count(*)::integer from reservations
                 where sandbox_id = $1 and seat_id = $2
                   and status = any($3::text[])) as active_reservations,
               (select count(*)::integer from repairs
                 where sandbox_id = $1 and seat_id = $2
                   and status <> 'closed') as open_repairs`,
            [
              input.sandboxId,
              input.seatId,
              ["pending-confirmation", "confirmed", "arrived", "in-use"],
            ],
          );
          const dependency = dependencies.rows[0]!;
          if (
            input.lifecycleStatus === "inactive" &&
            seatRow.lifecycle_status !== "inactive" &&
            (dependency.active_reservations > 0 || dependency.open_repairs > 0)
          ) {
            throw new ManagerStoreConfigurationConflictError(
              "seat-dependencies",
            );
          }
          const changesReferencedFields =
            seatRow.area_id !== input.areaId ||
            seatRow.machine_profile_id !== input.machineProfileId ||
            seatRow.code !== input.code ||
            seatRow.sort_order !== input.sortOrder;
          if (seatRow.business_referenced && changesReferencedFields) {
            throw new ManagerStoreConfigurationConflictError(
              "referenced-seat-immutable",
            );
          }
          const invalidReferencedSeatTransition = !(
            seatRow.lifecycle_status === input.lifecycleStatus ||
            (seatRow.lifecycle_status === "draft" &&
              input.lifecycleStatus === "active") ||
            (seatRow.lifecycle_status === "active" &&
              input.lifecycleStatus === "inactive")
          );
          if (invalidReferencedSeatTransition) {
            throw new ManagerStoreConfigurationConflictError(
              "seat-lifecycle-transition",
            );
          }
          const invalidReferencedSeatLifecycle = !(
            seatRow.lifecycle_status === input.lifecycleStatus ||
            (seatRow.lifecycle_status === "active" &&
              input.lifecycleStatus === "inactive")
          );
          if (seatRow.business_referenced && invalidReferencedSeatLifecycle) {
            throw new ManagerStoreConfigurationConflictError(
              "referenced-seat-immutable",
            );
          }
          const area = await client.query<{
            lifecycle_status: "active" | "archived" | "draft";
          }>(
            `select lifecycle_status from store_areas
              where sandbox_id = $1 and store_id = $2 and id = $3
              for update`,
            [input.sandboxId, input.storeId, input.areaId],
          );
          const targetArea = area.rows[0];
          if (
            !targetArea ||
            (input.areaId !== seatRow.area_id &&
              targetArea.lifecycle_status === "archived") ||
            (input.lifecycleStatus === "active" &&
              targetArea.lifecycle_status !== "active")
          ) {
            throw new ManagerStoreConfigurationConflictError("area-not-found");
          }
          const profile = await client.query<{ archived: boolean }>(
            `select archived from machine_profiles
              where sandbox_id = $1 and id = $2`,
            [input.sandboxId, input.machineProfileId],
          );
          const targetProfile = profile.rows[0];
          const activatesWithChangedProfile =
            input.lifecycleStatus === "active" &&
            seatRow.lifecycle_status !== "active";
          if (
            !targetProfile ||
            (targetProfile.archived &&
              (input.machineProfileId !== seatRow.machine_profile_id ||
                activatesWithChangedProfile))
          ) {
            throw new ManagerStoreConfigurationConflictError(
              "machine-profile-not-found",
            );
          }
          const duplicate = await client.query<{ exists: boolean }>(
            `select exists(select 1 from seats
              where sandbox_id = $1 and store_id = $2 and code = $3
                and id <> $4) as exists`,
            [input.sandboxId, input.storeId, input.code, input.seatId],
          );
          if (duplicate.rows[0]?.exists) {
            throw new ManagerStoreConfigurationConflictError(
              "duplicate-seat-code",
            );
          }
          const updated = await client.query<{ config_version: number }>(
            `update seats set area_id = $4, machine_profile_id = $5,
                code = $6, sort_order = $7,
                lifecycle_status = $8, config_version = config_version + 1
              where sandbox_id = $1 and store_id = $2 and id = $3
            returning config_version`,
            [
              input.sandboxId,
              input.storeId,
              input.seatId,
              input.areaId,
              input.machineProfileId,
              input.code,
              input.sortOrder,
              input.lifecycleStatus,
            ],
          );
          const version = updated.rows[0]!.config_version;
          await client.query(
            `update stores set config_version = config_version + 1,
                seat_count = (select count(*)::integer from seats
                  where sandbox_id = $1 and store_id = $2
                    and lifecycle_status = 'active')
              where sandbox_id = $1 and id = $2`,
            [input.sandboxId, input.storeId],
          );
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               'seat.update', 'seat', $5,
               'allowed', null, $6, $7::jsonb, $8::jsonb, $9, $10)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              input.seatId,
              input.requestId,
              JSON.stringify(seatRow),
              JSON.stringify(commandPayload),
              currentTime,
              wallTime,
            ],
          );
          return persistCommand({
            action: input.action,
            objectId: input.seatId,
            replayed: false,
            version,
          });
        }
        if (input.action === "delete-seat") {
          const seat = await client.query<{
            area_id: string;
            code: string;
            config_version: number;
            lifecycle_status: "active" | "inactive" | "draft";
            machine_profile_id: string;
            operational_status: "maintenance" | "normal";
            sort_order: number;
          }>(
            `select area_id, machine_profile_id, code, sort_order,
                    operational_status, lifecycle_status, config_version
               from seats
              where sandbox_id = $1 and store_id = $2 and id = $3
              for update`,
            [input.sandboxId, input.storeId, input.seatId],
          );
          const seatRow = seat.rows[0];
          if (!seatRow) {
            throw new ManagerStoreConfigurationConflictError("seat-not-found");
          }
          if (seatRow.config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          const references = await client.query<{ referenced: boolean }>(
            `select exists(select 1 from reservations where seat_id = $1)
                or exists(select 1 from repairs where seat_id = $1)
                as referenced`,
            [input.seatId],
          );
          if (
            seatRow.lifecycle_status !== "draft" ||
            references.rows[0]?.referenced
          ) {
            throw new ManagerStoreConfigurationConflictError(
              "seat-not-deletable",
            );
          }
          await client.query(
            `delete from seats
              where sandbox_id = $1 and store_id = $2 and id = $3`,
            [input.sandboxId, input.storeId, input.seatId],
          );
          const updated = await client.query<{ config_version: number }>(
            `update stores set config_version = config_version + 1,
                seat_count = (select count(*)::integer from seats
                  where sandbox_id = $1 and store_id = $2
                    and lifecycle_status = 'active')
              where sandbox_id = $1 and id = $2 returning config_version`,
            [input.sandboxId, input.storeId],
          );
          const storeVersion = updated.rows[0]!.config_version;
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               'seat.delete-draft', 'seat',
               $5, 'allowed', null, $6, $7::jsonb, null, $8, $9)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              input.seatId,
              input.requestId,
              JSON.stringify(seatRow),
              currentTime,
              wallTime,
            ],
          );
          return persistCommand({
            action: input.action,
            objectId: input.seatId,
            replayed: false,
            version: storeVersion,
          });
        }
        if (input.action === "create-price-plan") {
          const timePattern = /^(?:[01]\d|2[0-3]):(?:00|30)$/u;
          const startsMinutes = clockMinutes(input.startsAt);
          const endsMinutes = clockMinutes(input.endsAt);
          const timeRangeValid = input.endsNextDay
            ? endsMinutes <= startsMinutes
            : endsMinutes > startsMinutes;
          const pricePlanValid =
            timePattern.test(input.startsAt) &&
            timePattern.test(input.endsAt) &&
            timeRangeValid &&
            Number.isInteger(input.weekdayHalfHourCents) &&
            input.weekdayHalfHourCents >= 0 &&
            Number.isInteger(input.weekendHalfHourCents) &&
            input.weekendHalfHourCents >= 0 &&
            input.effectiveFrom.getTime() > currentTime.getTime() &&
            input.effectiveFrom.getTime() % HALF_HOUR_MS === 0;
          if (!pricePlanValid) {
            throw new ManagerStoreConfigurationConflictError(
              "invalid-price-plan",
            );
          }
          if (commandStore.rows[0].config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          const scope = await client.query<{
            area_exists: boolean;
            profile_exists: boolean;
          }>(
            `select
               exists(select 1 from store_areas
                 where sandbox_id = $1 and store_id = $2 and id = $3
                   and lifecycle_status = 'active') as area_exists,
               exists(select 1 from machine_profiles
                 where sandbox_id = $1 and id = $4 and archived = false)
                 as profile_exists`,
            [
              input.sandboxId,
              input.storeId,
              input.areaId,
              input.machineProfileId,
            ],
          );
          if (!scope.rows[0]?.area_exists) {
            throw new ManagerStoreConfigurationConflictError("area-not-found");
          }
          if (!scope.rows[0]?.profile_exists) {
            throw new ManagerStoreConfigurationConflictError(
              "machine-profile-not-found",
            );
          }
          const plans = await client.query<{
            effective_from: Date;
            effective_until: Date | null;
            ends_at: string;
            ends_next_day: boolean;
            id: string;
            starts_at: string;
            version: number;
          }>(
            `select id, version, starts_at, ends_at, ends_next_day,
                    effective_from, effective_until
               from price_plans
              where sandbox_id = $1 and store_id = $2 and area_id = $3
                and machine_profile_id = $4 and status = 'active'
              order by effective_from for update`,
            [
              input.sandboxId,
              input.storeId,
              input.areaId,
              input.machineProfileId,
            ],
          );
          const candidateClockRange = {
            endsAt: input.endsAt,
            endsNextDay: input.endsNextDay,
            startsAt: input.startsAt,
          };
          const clockOverlappingPlans = plans.rows.filter((plan) =>
            pricePlanClockRangesOverlap(candidateClockRange, {
              endsAt: plan.ends_at.slice(0, 5),
              endsNextDay: plan.ends_next_day,
              startsAt: plan.starts_at.slice(0, 5),
            }),
          );
          const exactScopePlans = clockOverlappingPlans.filter(
            (plan) =>
              plan.starts_at.slice(0, 5) === input.startsAt &&
              plan.ends_at.slice(0, 5) === input.endsAt &&
              plan.ends_next_day === input.endsNextDay,
          );
          if (
            exactScopePlans.some(
              (plan) =>
                plan.effective_from.getTime() >= input.effectiveFrom.getTime(),
            ) ||
            clockOverlappingPlans
              .filter((plan) => !exactScopePlans.includes(plan))
              .some((plan) =>
                pricePlanEffectiveRangesOverlap(
                  {
                    effectiveFrom: plan.effective_from,
                    effectiveUntil: plan.effective_until,
                  },
                  {
                    effectiveFrom: input.effectiveFrom,
                    effectiveUntil: null,
                  },
                ),
              )
          ) {
            throw new ManagerStoreConfigurationConflictError(
              "price-plan-overlap",
            );
          }
          const predecessor = exactScopePlans.at(-1) ?? null;
          if (
            predecessor &&
            (predecessor.effective_until === null ||
              predecessor.effective_until.getTime() >
                input.effectiveFrom.getTime())
          ) {
            await client.query(
              `update price_plans set effective_until = $3
                where sandbox_id = $1 and id = $2`,
              [input.sandboxId, predecessor.id, input.effectiveFrom],
            );
          }
          const versionResult = await client.query<{ version: number }>(
            `select coalesce(max(version), 0)::integer + 1 as version
               from price_plans
              where sandbox_id = $1 and store_id = $2 and area_id = $3
                and machine_profile_id = $4`,
            [
              input.sandboxId,
              input.storeId,
              input.areaId,
              input.machineProfileId,
            ],
          );
          const pricePlanId = randomUUID();
          const version = versionResult.rows[0]!.version;
          await client.query(
            `insert into price_plans (
               id, sandbox_id, store_id, area_id, machine_profile_id,
               version, base_hourly_cents, starts_at, ends_at,
               ends_next_day, weekday_half_hour_cents,
               weekend_half_hour_cents, pricing_model, effective_from, status
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, 'explicit-half-hour', $13, 'active')`,
            [
              pricePlanId,
              input.sandboxId,
              input.storeId,
              input.areaId,
              input.machineProfileId,
              version,
              input.weekdayHalfHourCents * 2,
              input.startsAt,
              input.endsAt,
              input.endsNextDay,
              input.weekdayHalfHourCents,
              input.weekendHalfHourCents,
              input.effectiveFrom,
            ],
          );
          const updatedStore = await client.query<{ config_version: number }>(
            `update stores set config_version = config_version + 1
              where sandbox_id = $1 and id = $2 returning config_version`,
            [input.sandboxId, input.storeId],
          );
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               'price-plan.create-version',
               'price_plan', $5, 'allowed', null, $6, $7::jsonb, $8::jsonb,
               $9, $10)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              pricePlanId,
              input.requestId,
              JSON.stringify(
                predecessor
                  ? {
                      predecessorEffectiveUntil: predecessor.effective_until,
                      predecessorId: predecessor.id,
                    }
                  : null,
              ),
              JSON.stringify(commandPayload),
              currentTime,
              wallTime,
            ],
          );
          return persistCommand({
            action: input.action,
            objectId: pricePlanId,
            replayed: false,
            version: updatedStore.rows[0]!.config_version,
          });
        }
        if (input.action === "archive-price-plan") {
          const plan = await client.query<{
            area_id: string;
            config_version: number;
            effective_from: Date;
            effective_until: Date | null;
            ends_at: string;
            ends_next_day: boolean;
            machine_profile_id: string;
            starts_at: string;
            status: "active" | "archived";
          }>(
            `select area_id, machine_profile_id, starts_at, ends_at,
                    ends_next_day, effective_from, effective_until, status,
                    config_version
               from price_plans
              where sandbox_id = $1 and store_id = $2 and id = $3
              for update`,
            [input.sandboxId, input.storeId, input.pricePlanId],
          );
          const planRow = plan.rows[0];
          if (!planRow) {
            throw new ManagerStoreConfigurationConflictError(
              "price-plan-not-found",
            );
          }
          if (planRow.config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          const activeNow =
            planRow.status === "active" &&
            planRow.effective_from.getTime() <= currentTime.getTime() &&
            (planRow.effective_until === null ||
              planRow.effective_until.getTime() > currentTime.getTime());
          if (activeNow) {
            throw new ManagerStoreConfigurationConflictError(
              "price-plan-not-archivable",
            );
          }
          if (planRow.status === "archived") {
            throw new ManagerStoreConfigurationConflictError(
              "price-plan-not-archivable",
            );
          }
          if (planRow.effective_from.getTime() > currentTime.getTime()) {
            await client.query(
              `update price_plans set effective_until = $9
                where sandbox_id = $1 and store_id = $2 and area_id = $3
                  and machine_profile_id = $4 and starts_at = $5
                  and ends_at = $6 and ends_next_day = $7
                  and effective_until = $8 and status = 'active'`,
              [
                input.sandboxId,
                input.storeId,
                planRow.area_id,
                planRow.machine_profile_id,
                planRow.starts_at,
                planRow.ends_at,
                planRow.ends_next_day,
                planRow.effective_from,
                planRow.effective_until,
              ],
            );
          }
          const archived = await client.query<{ config_version: number }>(
            `update price_plans set status = 'archived',
                config_version = config_version + 1
              where sandbox_id = $1 and id = $2 returning config_version`,
            [input.sandboxId, input.pricePlanId],
          );
          await client.query(
            `update stores set config_version = config_version + 1
              where sandbox_id = $1 and id = $2`,
            [input.sandboxId, input.storeId],
          );
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               'price-plan.archive',
               'price_plan', $5, 'allowed', null, $6, $7::jsonb, $8::jsonb,
               $9, $10)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              input.pricePlanId,
              input.requestId,
              JSON.stringify(planRow),
              JSON.stringify({ status: "archived" }),
              currentTime,
              wallTime,
            ],
          );
          return persistCommand({
            action: input.action,
            objectId: input.pricePlanId,
            replayed: false,
            version: archived.rows[0]!.config_version,
          });
        }
        if (
          input.action === "update-store-product" ||
          input.action === "archive-store-product"
        ) {
          const product = await client.query<{
            archived: boolean;
            config_version: number;
            inventory_item_id: string;
            listed: boolean;
            low_stock_threshold: number;
            unit_price_cents: number;
          }>(
            `select config.archived, config.config_version,
                    config.inventory_item_id, config.listed,
                    config.unit_price_cents, item.low_stock_threshold
               from store_products config
               join product_store_scopes scope
                 on scope.sandbox_id = config.sandbox_id
                and scope.product_id = config.product_id
                and scope.store_id = config.store_id
               join inventory_items item on item.id = config.inventory_item_id
              where config.sandbox_id = $1 and config.store_id = $2
                and config.id = $3
              for update of config, item`,
            [input.sandboxId, input.storeId, input.storeProductId],
          );
          const productRow = product.rows[0];
          if (!productRow) {
            throw new ManagerStoreConfigurationConflictError(
              "store-product-not-found",
            );
          }
          if (productRow.config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          if (productRow.archived) {
            throw new ManagerStoreConfigurationConflictError(
              "store-product-archived",
            );
          }
          if (input.action === "update-store-product") {
            if (
              !Number.isInteger(input.unitPriceCents) ||
              input.unitPriceCents < 0 ||
              !Number.isInteger(input.lowStockThreshold) ||
              input.lowStockThreshold < 0
            ) {
              throw new ManagerStoreConfigurationConflictError(
                "invalid-store-product",
              );
            }
            await client.query(
              `update inventory_items set low_stock_threshold = $3
                where sandbox_id = $1 and id = $2`,
              [
                input.sandboxId,
                productRow.inventory_item_id,
                input.lowStockThreshold,
              ],
            );
            await client.query(
              `update store_products set listed = $3, unit_price_cents = $4,
                  config_version = config_version + 1
                where sandbox_id = $1 and id = $2`,
              [
                input.sandboxId,
                input.storeProductId,
                input.listed,
                input.unitPriceCents,
              ],
            );
          } else {
            await client.query(
              `update store_products set listed = false, archived = true,
                  config_version = config_version + 1
                where sandbox_id = $1 and id = $2`,
              [input.sandboxId, input.storeProductId],
            );
          }
          const confirmedProduct = await client.query<{
            archived: boolean;
            config_version: number;
            listed: boolean;
            unit_price_cents: number;
          }>(
            `select archived, config_version, listed, unit_price_cents
               from store_products where sandbox_id = $1 and id = $2`,
            [input.sandboxId, input.storeProductId],
          );
          await client.query(
            `update stores set config_version = config_version + 1
              where sandbox_id = $1 and id = $2`,
            [input.sandboxId, input.storeId],
          );
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               $5, 'store_product', $6,
               'allowed', null, $7, $8::jsonb, $9::jsonb, $10, $11)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              input.action === "update-store-product"
                ? "store-product.update"
                : "store-product.archive",
              input.storeProductId,
              input.requestId,
              JSON.stringify(productRow),
              JSON.stringify(commandPayload),
              currentTime,
              wallTime,
            ],
          );
          return persistCommand({
            action: input.action,
            objectId: input.storeProductId,
            replayed: false,
            version: confirmedProduct.rows[0]!.config_version,
          });
        }
        if (input.action === "schedule-business-hours") {
          const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
          const minuteOfDay = (value: string) =>
            Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
          const opensMinute = minuteOfDay(input.opensAt);
          const closesMinute = minuteOfDay(input.closesAt);
          const intervalValid = input.isOpen24Hours
            ? true
            : input.closesNextDay
              ? closesMinute < opensMinute
              : closesMinute > opensMinute;
          const hoursValid =
            timePattern.test(input.opensAt) &&
            timePattern.test(input.closesAt) &&
            input.effectiveFrom.getTime() > currentTime.getTime() &&
            intervalValid;
          if (!hoursValid) {
            throw new ManagerStoreConfigurationConflictError(
              "invalid-business-hours",
            );
          }
          const lockedStore = await client.query<{ config_version: number }>(
            `select config_version from stores
              where sandbox_id = $1 and id = $2 for update`,
            [input.sandboxId, input.storeId],
          );
          if (!lockedStore.rows[0]) {
            throw new ManagerStoreConfigurationConflictError("cross-store");
          }
          if (lockedStore.rows[0].config_version !== input.expectedVersion) {
            throw new ManagerStoreConfigurationConflictError(
              "version-conflict",
            );
          }
          const businessHoursId = randomUUID();
          await client.query(
            `insert into store_business_hours_versions (
               id, sandbox_id, store_id, day_set, opens_at, closes_at,
               closes_next_day, is_open_24_hours, effective_from,
               created_by_persona_id, created_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              businessHoursId,
              input.sandboxId,
              input.storeId,
              input.daySet,
              input.isOpen24Hours ? "00:00" : input.opensAt,
              input.isOpen24Hours ? "00:00" : input.closesAt,
              input.isOpen24Hours ? false : input.closesNextDay,
              input.isOpen24Hours,
              input.effectiveFrom,
              input.personaId,
              wallTime,
            ],
          );
          const updated = await client.query<{ config_version: number }>(
            `update stores set config_version = config_version + 1
              where sandbox_id = $1 and id = $2 returning config_version`,
            [input.sandboxId, input.storeId],
          );
          const version = updated.rows[0]!.config_version;
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action,
               object_type, object_id, result, reason, request_id,
               before_data, after_data, business_occurred_at, recorded_at
             ) values ($1, $2, $3, $4,
               current_setting('app.actor_role'),
               'store.business-hours.schedule', 'store_business_hours', $5,
               'allowed', null, $6, null, $7::jsonb, $8, $9)`,
            [
              randomUUID(),
              input.sandboxId,
              input.storeId,
              input.personaId,
              businessHoursId,
              input.requestId,
              JSON.stringify({
                closesAt: input.isOpen24Hours ? "00:00" : input.closesAt,
                closesNextDay: input.isOpen24Hours
                  ? false
                  : input.closesNextDay,
                daySet: input.daySet,
                effectiveFrom: input.effectiveFrom.toISOString(),
                isOpen24Hours: input.isOpen24Hours,
                opensAt: input.isOpen24Hours ? "00:00" : input.opensAt,
                version,
              }),
              currentTime,
              wallTime,
            ],
          );
          const stored: DatabaseManagerStoreConfigurationCommand = {
            action: input.action,
            objectId: businessHoursId,
            replayed: false,
            version,
          };
          await client.query(
            `insert into store_config_command_requests (
               sandbox_id, actor_persona_id, store_id, command_type,
               idempotency_key_hash, payload_hash, result_data, created_at
             ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
            [
              input.sandboxId,
              input.personaId,
              input.storeId,
              input.action,
              idempotencyKeyHash,
              payloadHash,
              JSON.stringify(stored),
              wallTime,
            ],
          );
          await client.query("commit");
          return stored;
        }
        const profileValid =
          input.displayName.trim().length >= 1 &&
          input.displayName.trim().length <= 60 &&
          input.fictitiousCity.trim().length >= 1 &&
          input.fictitiousCity.trim().length <= 40 &&
          input.fictitiousCity.includes("虚构") &&
          input.introduction.trim().length >= 1 &&
          input.introduction.trim().length <= 500 &&
          isSafeManagerConfigurationText(
            `${input.displayName}${input.fictitiousCity}${input.introduction}`,
          );
        if (!profileValid) {
          throw new ManagerStoreConfigurationConflictError("invalid-profile");
        }
        const before = await client.query<{
          config_version: number;
          display_name: string;
          fictitious_city: string;
          introduction: string;
        }>(
          `select display_name, fictitious_city, introduction, config_version
             from stores where sandbox_id = $1 and id = $2 for update`,
          [input.sandboxId, input.storeId],
        );
        const beforeRow = before.rows[0];
        if (!beforeRow) {
          throw new ManagerStoreConfigurationConflictError("cross-store");
        }
        if (beforeRow.config_version !== input.expectedVersion) {
          throw new ManagerStoreConfigurationConflictError("version-conflict");
        }
        const updated = await client.query<{ config_version: number }>(
          `update stores
              set display_name = $3, fictitious_city = $4,
                  introduction = $5, config_version = config_version + 1
            where sandbox_id = $1 and id = $2
          returning config_version`,
          [
            input.sandboxId,
            input.storeId,
            input.displayName.trim(),
            input.fictitiousCity.trim(),
            input.introduction.trim(),
          ],
        );
        const version = updated.rows[0]!.config_version;
        await client.query(
          `update demo_personas set scope = $3
            where sandbox_id = $1 and store_id = $2
              and role = any($4::text[])`,
          [
            input.sandboxId,
            input.storeId,
            input.displayName.trim(),
            ["staff", "manager"],
          ],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4,
             current_setting('app.actor_role'),
             'store.profile.update',
             'store', $3, 'allowed', null, $5, $6::jsonb, $7::jsonb, $8, $9)`,
          [
            randomUUID(),
            input.sandboxId,
            input.storeId,
            input.personaId,
            input.requestId,
            JSON.stringify(beforeRow),
            JSON.stringify({
              displayName: input.displayName.trim(),
              fictitiousCity: input.fictitiousCity.trim(),
              introduction: input.introduction.trim(),
              version,
            }),
            currentTime,
            wallTime,
          ],
        );
        const stored: DatabaseManagerStoreConfigurationCommand = {
          action: input.action,
          objectId: input.storeId,
          replayed: false,
          version,
        };
        await client.query(
          `insert into store_config_command_requests (
             sandbox_id, actor_persona_id, store_id, command_type,
             idempotency_key_hash, payload_hash, result_data, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
          [
            input.sandboxId,
            input.personaId,
            input.storeId,
            input.action,
            idempotencyKeyHash,
            payloadHash,
            JSON.stringify(stored),
            wallTime,
          ],
        );
        await client.query("commit");
        return stored;
      } catch (error) {
        if (replayedDenial) throw error;
        if (
          error instanceof ManagerStoreConfigurationConflictError &&
          denialAudit
        ) {
          const object = (() => {
            switch (input.action) {
              case "update-store-profile":
              case "schedule-business-hours":
                return { objectId: input.storeId, objectType: "store" };
              case "create-area":
                return { objectId: null, objectType: "store_area" };
              case "update-area":
              case "delete-area":
                return { objectId: input.areaId, objectType: "store_area" };
              case "create-seat":
                return { objectId: null, objectType: "seat" };
              case "update-seat":
              case "delete-seat":
                return { objectId: input.seatId, objectType: "seat" };
              case "create-price-plan":
                return { objectId: null, objectType: "price_plan" };
              case "archive-price-plan":
                return {
                  objectId: input.pricePlanId,
                  objectType: "price_plan",
                };
              case "update-store-product":
              case "archive-store-product":
                return {
                  objectId: input.storeProductId,
                  objectType: "store_product",
                };
            }
          })();
          const serializedDeniedPayload = JSON.stringify(
            denialAudit.commandPayload,
          );
          const deniedPayload = managerStoreConfigurationDenialSummary(
            input,
            hash(serializedDeniedPayload),
          );
          try {
            await client.query(
              `insert into audit_events (
                 id, sandbox_id, store_id, persona_id, role, action,
                 object_type, object_id, result, reason, request_id,
                 before_data, after_data, business_occurred_at, recorded_at
               ) values ($1, $2, $3, $4,
                 current_setting('app.actor_role'),
                 $5, $6, $7, 'denied',
                 $8, $9, null, $10::jsonb, $11, $12)`,
              [
                randomUUID(),
                input.sandboxId,
                denialAudit.actorStoreId,
                input.personaId,
                `store-configuration.${input.action}`,
                object.objectType,
                object.objectId,
                error.reason,
                input.requestId,
                JSON.stringify(deniedPayload),
                denialAudit.businessTime,
                wallTime,
              ],
            );
            if (
              idempotencySlotAvailable &&
              commandFingerprint &&
              denialAudit.actorStoreId
            ) {
              await client.query(
                `insert into store_config_command_requests (
                   sandbox_id, actor_persona_id, store_id, command_type,
                   idempotency_key_hash, payload_hash, result_data, created_at
                 ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
                [
                  input.sandboxId,
                  input.personaId,
                  denialAudit.actorStoreId,
                  input.action,
                  commandFingerprint.idempotencyKeyHash,
                  commandFingerprint.payloadHash,
                  JSON.stringify({ denied: true, reason: error.reason }),
                  wallTime,
                ],
              );
            }
            await client.query("commit");
          } catch {
            await client.query("rollback").catch(() => undefined);
          }
        } else {
          await client.query("rollback").catch(() => undefined);
        }
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
          couponRestored = await restoreOrderCoupon(client, {
            orderId: row.id,
            sandboxId: input.sandboxId,
          });
          if (!couponRestored) {
            throw new Error("The order coupon could not be restored.");
          }
        }
        if (decision.inventoryEffect === "release") {
          await releaseActiveOrderInventory(client, {
            businessTime: currentTime,
            orderId: row.id,
            sandboxId: input.sandboxId,
          });
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
                 movement_kind, reason, on_hand_delta, on_hand_after,
                 business_occurred_at, recorded_at
               ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [
                randomUUID(),
                input.sandboxId,
                row.store_id,
                hold.inventory_item_id,
                row.id,
                decision.inventoryEffect === "sale" ? "sale" : "waste",
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
          await recordOrderSimulatedRefund(client, {
            amountCents: decision.simulatedRefundCents,
            businessTime: currentTime,
            orderId: row.id,
            reason: input.reason,
            recordedAt: wallTime,
            sandboxId: input.sandboxId,
          });
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

        await consumeSandboxAdmission(client, {
          clientIp: input.clientIp,
          operation: "create",
          visitorKey: input.visitorKey,
          wallTime,
        });
        await holdSandboxAdmissionLock(client);
        await assertSandboxCapacity(client, wallTime);

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
        const hoursAt =
          input.mode === "future" && input.requestedStartsAt
            ? input.requestedStartsAt
            : now;
        const selectedHours = await businessHoursFor(client, {
          at: hoursAt,
          baseline: store,
          sandboxId: input.sandboxId,
          storeId: store.id,
        });
        const window = resolveCustomerReservationWindow({
          businessHours: {
            closesAt: selectedHours.closes_at.slice(0, 5),
            closesNextDay: selectedHours.closes_next_day,
            isOpen24Hours: selectedHours.is_open_24_hours,
            opensAt: selectedHours.opens_at.slice(0, 5),
          },
          durationHours: input.durationHours,
          immediateReservationWindowStrategy:
            customerImmediateReservationWindowStrategyForSeedVersion(
              sandbox.seed_version,
            ),
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
            where sandbox_id = $1 and store_id = $2 and code = $3
              and lifecycle_status = 'active'`,
          [input.sandboxId, store.id, input.areaCode],
        );
        const area = areaResult.rows[0];
        if (!area) {
          throw new CustomerSeatBrowseValidationError("area-not-found");
        }
        const machinePricing = await loadMachinePricingSelection(client, {
          areaId: area.id,
          effectiveAt: window.startsAt,
          machineProfileCode: input.machineProfileCode,
          sandboxId: input.sandboxId,
          storeId: store.id,
        });
        if (!machinePricing) {
          throw new CustomerSeatBrowseValidationError("price-plan-not-found");
        }
        const { machine } = machinePricing;
        const seatResult = await client.query<SeatBrowseRow>(
          `select id, code, operational_status
             from seats
            where sandbox_id = $1 and store_id = $2 and area_id = $3
              and machine_profile_id = $4 and code = $5
              and lifecycle_status = 'active'
            for update`,
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

        const price = priceMachineReservationWindow(
          machinePricing.plans,
          window,
        );
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
            JSON.stringify({
              holdExpiresAt: holdExpiresAt.toISOString(),
              mode: input.mode,
            }),
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
             join product_store_scopes scope
               on scope.sandbox_id = config.sandbox_id
              and scope.product_id = config.product_id
              and scope.store_id = config.store_id
             join inventory_items item on item.id = config.inventory_item_id
            where config.sandbox_id = $1 and config.store_id = $2
              and config.listed = true and config.archived = false
              and product.archived = false
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
             join product_store_scopes scope
               on scope.sandbox_id = config.sandbox_id
              and scope.product_id = config.product_id
              and scope.store_id = config.store_id
             join inventory_items item on item.id = config.inventory_item_id
            where config.sandbox_id = $1 and config.store_id = $2
              and config.listed = true and config.archived = false
              and product.archived = false
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
          await recordOrderSimulatedRefund(client, {
            amountCents: refund.amountCents,
            businessTime: currentTime,
            orderId: input.orderId,
            reason: refund.reason,
            recordedAt: wallTime,
            sandboxId: input.sandboxId,
          });
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
          const relatedRepairs = await readRelatedRepairs(
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
            related: { orders: relatedOrders, repairs: relatedRepairs },
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
        const currentTime = businessTimeForSandbox(sandbox, wallTime);
        const operator = await client.query<{ city: string }>(
          "select city from operators where sandbox_id = $1",
          [input.sandboxId],
        );
        const stores = await client.query<StoreRow>(
          `select id, code, display_name, fictitious_city, introduction,
                  seat_count, opens_at, closes_at,
                  closes_next_day, is_open_24_hours
             from stores where sandbox_id = $1`,
          [input.sandboxId],
        );
        const areas = await client.query<AreaCatalogRow>(
          `select area.store_id, area.code, area.display_name,
                  count(seat.id)::integer as seat_count
             from store_areas area
             left join seats seat on seat.area_id = area.id
              and seat.lifecycle_status = 'active'
            where area.sandbox_id = $1 and area.lifecycle_status = 'active'
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
              and plan.effective_from <= $2
              and (plan.effective_until is null or plan.effective_until > $2)
            where seat.sandbox_id = $1 and profile.archived = false
              and seat.lifecycle_status = 'active'
            group by seat.store_id, profile.code, profile.display_name,
                     profile.experience_description`,
          [input.sandboxId, currentTime],
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
        const catalogStores: Array<
          DatabaseCustomerStoreCatalog["stores"][number]
        > = [];
        for (const store of orderedStores) {
          const selectedHours = await businessHoursFor(client, {
            at: currentTime,
            baseline: store,
            sandboxId: input.sandboxId,
            storeId: store.id,
          });
          catalogStores.push({
            areas: areas.rows
              .filter((area) => area.store_id === store.id)
              .map((area) => ({
                code: area.code,
                displayName: area.display_name,
                seatCount: area.seat_count,
              })),
            businessHours: formatBusinessHours(selectedHours),
            closesAt: selectedHours.closes_at.slice(0, 5),
            closesNextDay: selectedHours.closes_next_day,
            code: store.code,
            displayName: store.display_name,
            fictitiousCity: store.fictitious_city,
            introduction: store.introduction,
            isOpen24Hours: selectedHours.is_open_24_hours,
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
            opensAt: selectedHours.opens_at.slice(0, 5),
            seatCount: store.seat_count,
          });
        }
        const result: DatabaseCustomerStoreCatalog = {
          city,
          currentTime,
          immediateReservationWindowStrategy:
            customerImmediateReservationWindowStrategyForSeedVersion(
              sandbox.seed_version,
            ),
          stores: catalogStores,
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
        const hoursAt =
          input.mode === "future" && input.requestedStartsAt
            ? input.requestedStartsAt
            : now;
        const selectedHours = await businessHoursFor(client, {
          at: hoursAt,
          baseline: store,
          sandboxId: input.sandboxId,
          storeId: store.id,
        });
        const window = resolveCustomerReservationWindow({
          businessHours: {
            closesAt: selectedHours.closes_at.slice(0, 5),
            closesNextDay: selectedHours.closes_next_day,
            isOpen24Hours: selectedHours.is_open_24_hours,
            opensAt: selectedHours.opens_at.slice(0, 5),
          },
          durationHours: input.durationHours,
          immediateReservationWindowStrategy:
            customerImmediateReservationWindowStrategyForSeedVersion(
              sandbox.seed_version,
            ),
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
            where sandbox_id = $1 and store_id = $2 and code = $3
              and lifecycle_status = 'active'`,
          [input.sandboxId, store.id, input.areaCode],
        );
        const area = areaResult.rows[0];
        if (!area) {
          throw new CustomerSeatBrowseValidationError("area-not-found");
        }
        const machinePricing = await loadMachinePricingSelection(client, {
          areaId: area.id,
          effectiveAt: window.startsAt,
          machineProfileCode: input.machineProfileCode,
          sandboxId: input.sandboxId,
          storeId: store.id,
        });
        if (!machinePricing) {
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
        const { machine } = machinePricing;
        const seatResult = await client.query<SeatBrowseRow>(
          `select id, code, operational_status
             from seats
            where sandbox_id = $1 and store_id = $2 and area_id = $3
              and machine_profile_id = $4 and lifecycle_status = 'active'
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
        const price = priceMachineReservationWindow(
          machinePricing.plans,
          window,
        );
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
        assertSandboxAvailable(sandboxRow, wallTime);
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
        assertSandboxAvailable(sandboxRow, wallTime);
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
        assertSandboxAvailable(sandboxRow, wallTime);
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
