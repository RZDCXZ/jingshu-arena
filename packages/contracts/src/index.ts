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

export interface PricePlanClockRange {
  readonly endsAt: string;
  readonly endsNextDay: boolean;
  readonly startsAt: string;
}

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
    readonly fictitiousCity: string;
    readonly introduction: string;
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
    readonly orders: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly status: CustomerOrderStatus;
    }>;
    readonly repairs: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly status: RepairStatus;
    }>;
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

export const REPAIR_STATUSES = [
  "new",
  "assigned",
  "processing",
  "verification",
  "closed",
] as const;

export type RepairStatus = (typeof REPAIR_STATUSES)[number];

export const REPAIR_PRIORITIES = ["normal", "high", "urgent"] as const;

export type RepairPriority = (typeof REPAIR_PRIORITIES)[number];

export interface CreateCustomerRepairRequest {
  readonly description: string;
  readonly reservationId: string;
}

export interface CreateStaffRepairRequest {
  readonly description: string;
  readonly seatId: string;
}

export interface StaffRepairIntakeResponse {
  readonly handlers: ReadonlyArray<{
    readonly displayName: string;
    readonly personaId: string;
    readonly role: "manager" | "staff";
  }>;
  readonly seats: ReadonlyArray<{
    readonly area: { readonly code: string; readonly displayName: string };
    readonly code: string;
    readonly existingRepair: {
      readonly repairId: string;
      readonly status: RepairStatus;
    } | null;
    readonly id: string;
    readonly machineProfile: {
      readonly code: CustomerMachineProfileCode;
      readonly displayName: string;
    };
    readonly operationalStatus: "maintenance" | "normal";
    readonly store: { readonly code: string; readonly displayName: string };
  }>;
  readonly status: "ready";
  readonly store: { readonly code: string; readonly displayName: string };
}

export const REPAIR_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type RepairImageContentType =
  (typeof REPAIR_IMAGE_CONTENT_TYPES)[number];

export interface CreateRepairImageIntentRequest {
  readonly declaredContentType: RepairImageContentType;
  readonly filename: string;
  readonly size: number;
}

export interface RepairImageIntentResponse {
  readonly completeUrl: string;
  readonly expiresAt: string;
  readonly intentId: string;
  readonly uploadMethod: "PUT";
  readonly uploadUrl: string;
}

export interface RepairUploadedImageSaved {
  readonly byteSize: number;
  readonly contentType: RepairImageContentType;
  readonly createdAt: string;
  readonly height: number;
  readonly imageId: string;
  readonly readUrl: string;
  readonly source: "uploaded";
  readonly status: "saved";
  readonly width: number;
}

export interface RepairSampleImageSaved {
  readonly byteSize: number;
  readonly contentType: "image/png";
  readonly createdAt: string;
  readonly height: 720;
  readonly imageId: string;
  readonly sampleAssetId: "repair-headset-v1";
  readonly source: "sample";
  readonly status: "saved";
  readonly width: 960;
}

export type RepairImageSaved =
  RepairSampleImageSaved | RepairUploadedImageSaved;

export interface RepairImageCompletionResponse {
  readonly image: RepairUploadedImageSaved;
  readonly intentStatus: "consumed";
}

export interface RepairSampleImageResponse {
  readonly image: RepairSampleImageSaved;
}

export interface RepairImageListResponse {
  readonly images: ReadonlyArray<RepairImageSaved>;
  readonly status: "ready";
}

export interface RepairCreatedResponse {
  readonly createdAt: string;
  readonly description: string;
  readonly duplicate: boolean;
  readonly machineProfile: {
    readonly code: CustomerMachineProfileCode;
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
  readonly status: RepairStatus;
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface StaffRepairQueueResponse {
  readonly currentTime: string;
  readonly rows: ReadonlyArray<{
    readonly createdAt: string;
    readonly description: string;
    readonly machineProfile: {
      readonly code: CustomerMachineProfileCode;
      readonly displayName: string;
    };
    readonly priority: "normal" | "high" | "urgent";
    readonly repairId: string;
    readonly seat: { readonly code: string };
    readonly source: "customer" | "staff";
    readonly status: RepairStatus;
    readonly waitingMinutes: number;
  }>;
  readonly status: "ready";
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface AssignRepairRequest {
  readonly assigneePersonaId: string;
  readonly internalNote: string;
  readonly priority: RepairPriority;
  readonly publicNote: string;
}

export interface StartRepairRequest {
  readonly internalNote: string;
  readonly publicNote: string;
}

export interface ClaimRepairSpareRequest {
  readonly inventoryItemId: string;
  readonly quantity: number;
}

export interface ReturnRepairSpareRequest {
  readonly quantity: number;
  readonly usageId: string;
}

export interface SubmitRepairResolutionRequest {
  readonly resolutionNote: string;
}

export interface VerifyRepairRequest {
  readonly outcome: "failure" | "success";
  readonly reason?: string;
}

export interface RepairCommandResponse {
  readonly action: "assign" | "start";
  readonly affectedReservations: ReadonlyArray<{
    readonly couponRestored: boolean;
    readonly outcome: "cancelled" | "completed";
    readonly reservationId: string;
    readonly simulatedRefundCents: number;
  }>;
  readonly occurredAt: string;
  readonly repairId: string;
  readonly replayed: boolean;
  readonly seatOperationalStatus: "maintenance" | "normal";
  readonly status: RepairStatus;
}

export interface RepairSpareCommandResponse {
  readonly action: "claim" | "return";
  readonly businessOccurredAt: string;
  readonly inventoryItem: {
    readonly displayName: string;
    readonly inventoryItemId: string;
  };
  readonly movementId: string;
  readonly onHandAfter: number;
  readonly quantity: number;
  readonly recordedAt: string;
  readonly repairId: string;
  readonly replayed: boolean;
  readonly returnedQuantity: number;
  readonly usageId: string;
}

export interface RepairResolutionCommandResponse {
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly repairId: string;
  readonly replayed: boolean;
  readonly seatOperationalStatus: "maintenance" | "normal";
  readonly status: RepairStatus;
}

export interface RepairVerificationCommandResponse {
  readonly occurredAt: string;
  readonly outcome: "failure" | "success";
  readonly recordedAt: string;
  readonly repairId: string;
  readonly replayed: boolean;
  readonly seatOperationalStatus: "maintenance" | "normal";
  readonly status: RepairStatus;
}

export interface RepairDetailResponse {
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
    readonly role: "manager" | "staff";
  } | null;
  readonly currentTime: string;
  readonly description: string;
  readonly impacts: ReadonlyArray<{
    readonly beforeStatus: CustomerReservationStatus;
    readonly couponRestored: boolean;
    readonly customerDisplayName: string | null;
    readonly outcome: "cancelled" | "completed";
    readonly reservationId: string;
    readonly simulatedRefundCents: number;
    readonly window: { readonly endsAt: string; readonly startsAt: string };
  }>;
  readonly internal: {
    readonly audits: ReadonlyArray<{
      readonly action: string;
      readonly actor: {
        readonly displayName: string;
        readonly personaId: string;
      } | null;
      readonly occurredAt: string;
      readonly recordedAt: string;
      readonly result: "allowed" | "denied";
    }>;
    readonly events: ReadonlyArray<{
      readonly actor: {
        readonly displayName: string;
        readonly personaId: string;
      } | null;
      readonly occurredAt: string;
      readonly recordedAt: string;
      readonly type: string;
    }>;
    readonly notes: ReadonlyArray<string>;
  } | null;
  readonly machineProfile: {
    readonly code: CustomerMachineProfileCode;
    readonly displayName: string;
  };
  readonly priority: RepairPriority;
  readonly publicUpdates: ReadonlyArray<{
    readonly note: string;
    readonly occurredAt: string;
    readonly type: string;
  }>;
  readonly repairId: string;
  readonly resolution: {
    readonly note: string;
    readonly submittedAt: string;
    readonly submittedBy: {
      readonly displayName: string;
      readonly personaId: string;
    } | null;
  } | null;
  readonly reservationId: string | null;
  readonly seat: {
    readonly code: string;
    readonly operationalStatus: "maintenance" | "normal";
  };
  readonly source: "customer" | "staff";
  readonly spares: {
    readonly available: ReadonlyArray<{
      readonly availableQuantity: number;
      readonly displayName: string;
      readonly inventoryItemId: string;
      readonly onHandQuantity: number;
    }>;
    readonly usages: ReadonlyArray<{
      readonly claimedAt: string;
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
      readonly recordedAt: string;
      readonly returnedQuantity: number;
      readonly returns: ReadonlyArray<{
        readonly movementId: string;
        readonly quantity: number;
        readonly recordedAt: string;
        readonly returnedAt: string;
        readonly returnedBy: {
          readonly displayName: string;
          readonly personaId: string;
        };
        readonly returnId: string;
      }>;
      readonly usageId: string;
    }>;
  } | null;
  readonly status: RepairStatus;
  readonly latestVerification: {
    readonly outcome: "failure" | "success";
    readonly reason: string;
    readonly verifiedAt: string;
    readonly verifiedBy: {
      readonly displayName: string;
      readonly personaId: string;
    } | null;
  } | null;
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface CustomerOrderCatalogResponse {
  readonly status: "ready";
  readonly currentTime: string;
  readonly reservation: {
    readonly reservationId: string;
    readonly seat: { readonly code: string };
    readonly status: "arrived" | "in-use";
    readonly store: { readonly code: string; readonly displayName: string };
  };
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
    readonly validUntil: string;
  }>;
}

export interface CreateCustomerPendingOrderRequest {
  readonly couponId: string | null;
  readonly lines: ReadonlyArray<{
    readonly productId: string;
    readonly quantity: number;
  }>;
  readonly reservationId: string;
}

export interface CustomerOrderSnapshotResponse {
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

export interface CustomerPendingOrderResponse {
  readonly holdExpiresAt: string;
  readonly orderId: string;
  readonly replayed: boolean;
  readonly snapshot: CustomerOrderSnapshotResponse;
  readonly status: "pending-simulated-payment";
}

export const CUSTOMER_ORDER_STATUSES = [
  "pending-simulated-payment",
  "simulated-paid",
  "preparing",
  "ready-for-pickup",
  "completed",
  "cancelled",
  "expired",
] as const;
export type CustomerOrderStatus = (typeof CUSTOMER_ORDER_STATUSES)[number];

export interface CustomerOrderDetailResponse {
  readonly actions: {
    readonly canCancel: boolean;
    readonly canSimulatePayment: boolean;
  };
  readonly cancelledAt: string | null;
  readonly coupon:
    | (NonNullable<CustomerOrderSnapshotResponse["coupon"]> & {
        readonly status: CustomerExperienceCouponStatus;
      })
    | null;
  readonly currentTime: string;
  readonly expiredAt: string | null;
  readonly holdExpiresAt: string;
  readonly inventory: ReadonlyArray<{
    readonly availableQuantity: number;
    readonly onHandQuantity: number;
    readonly productId: string;
    readonly reservedForOrderQuantity: number;
    readonly reservedQuantity: number;
  }>;
  readonly orderId: string;
  readonly payment: {
    readonly amountCents: number;
    readonly doesNotCharge: true;
    readonly occurredAt: string;
    readonly simulated: true;
  } | null;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: string;
    readonly reason: string;
    readonly simulated: true;
  } | null;
  readonly snapshot: CustomerOrderSnapshotResponse;
  readonly status: CustomerOrderStatus;
  readonly terminalReason: string | null;
  readonly timeline: ReadonlyArray<{
    readonly data: unknown;
    readonly occurredAt: string;
    readonly type: string;
  }>;
}

export interface CustomerOrderPaymentResponse {
  readonly notice: "模拟支付，不会扣款，也不需要真实支付凭证。";
  readonly orderId: string;
  readonly payment: {
    readonly amountCents: number;
    readonly doesNotCharge: true;
    readonly occurredAt: string;
    readonly simulated: true;
  };
  readonly replayed: boolean;
  readonly status: "simulated-paid";
}

export interface CancelCustomerOrderRequest {
  readonly reason: string;
}

export interface CustomerOrderCancellationResponse {
  readonly cancelledAt: string;
  readonly couponRestored: boolean;
  readonly orderId: string;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: string;
    readonly reason: string;
    readonly simulated: true;
  } | null;
  readonly replayed: boolean;
  readonly status: "cancelled";
}

export const STAFF_ORDER_STAGE_FILTERS = [
  "all",
  "simulated-paid",
  "preparing",
  "ready-for-pickup",
  "exception",
] as const;
export type StaffOrderStageFilter = (typeof STAFF_ORDER_STAGE_FILTERS)[number];

export const STAFF_ORDER_ACTIONS = [
  "start-preparing",
  "mark-ready",
  "complete",
  "cancel",
] as const;
export type StaffOrderAction = (typeof STAFF_ORDER_ACTIONS)[number];

export interface StaffOrderSummaryResponse {
  readonly amountCents: number;
  readonly couponLabel: string | null;
  readonly customerDisplayName: string;
  readonly itemSummary: string;
  readonly orderId: string;
  readonly reservation: {
    readonly reservationId: string;
    readonly seatCode: string;
    readonly status: CustomerReservationStatus;
  };
  readonly stageEnteredAt: string;
  readonly status: CustomerOrderStatus;
  readonly waitingMinutes: number;
}

export interface StaffOrderQueueResponse {
  readonly counts: Record<
    "exception" | "preparing" | "ready-for-pickup" | "simulated-paid",
    number
  >;
  readonly currentTime: string;
  readonly rows: ReadonlyArray<StaffOrderSummaryResponse>;
  readonly stage: StaffOrderStageFilter;
  readonly status: "ready";
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface StaffOrderDetailResponse {
  readonly actions: {
    readonly canCancel: boolean;
    readonly primary: {
      readonly kind: Exclude<StaffOrderAction, "cancel">;
      readonly label: "开始制作" | "标记待取" | "完成订单";
    } | null;
  };
  readonly coupon:
    | (NonNullable<CustomerOrderSnapshotResponse["coupon"]> & {
        readonly status: CustomerExperienceCouponStatus;
      })
    | null;
  readonly currentTime: string;
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
  readonly order: StaffOrderSummaryResponse;
  readonly refund: {
    readonly amountCents: number;
    readonly occurredAt: string;
    readonly reason: string;
    readonly simulated: true;
  } | null;
  readonly snapshot: CustomerOrderSnapshotResponse;
  readonly timeline: CustomerOrderDetailResponse["timeline"];
}

export interface StaffOrderCommandRequest {
  readonly action: StaffOrderAction;
  readonly reason?: string;
}

export interface StaffOrderCommandResponse {
  readonly action: StaffOrderAction;
  readonly couponRestored: boolean;
  readonly growthPoints: number;
  readonly inventoryEffect: "release" | "retain" | "sale" | "waste";
  readonly occurredAt: string;
  readonly orderId: string;
  readonly replayed: boolean;
  readonly simulatedRefundCents: number;
  readonly status: CustomerOrderStatus;
}

export const INVENTORY_KINDS = ["product", "spare"] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];
export const INVENTORY_MOVEMENT_KINDS = [
  "receipt",
  "stocktake",
  "compensation",
  "sale",
  "waste",
  "spare-usage",
  "spare-return",
] as const;
export type InventoryMovementKind = (typeof INVENTORY_MOVEMENT_KINDS)[number];
export const MANAGER_INVENTORY_ACTIONS = [
  "receipt",
  "stocktake",
  "compensation",
] as const;
export type ManagerInventoryAction = (typeof MANAGER_INVENTORY_ACTIONS)[number];

export interface InventoryMovementResponse {
  readonly businessOccurredAt: string;
  readonly inventoryItemId: string;
  readonly inventoryItemName: string;
  readonly kind: InventoryMovementKind;
  readonly movementId: string;
  readonly onHandAfter: number;
  readonly onHandDelta: number;
  readonly orderId: string | null;
  readonly originalMovementId: string | null;
  readonly reason: string;
}

export interface StoreInventoryResponse {
  readonly currentTime: string;
  readonly items: ReadonlyArray<{
    readonly alerting: boolean;
    readonly availableQuantity: number;
    readonly code: string;
    readonly displayName: string;
    readonly inventoryItemId: string;
    readonly kind: InventoryKind;
    readonly lowStockThreshold: number;
    readonly onHandQuantity: number;
    readonly recentMovement: InventoryMovementResponse | null;
    readonly reservedQuantity: number;
  }>;
  readonly movements: ReadonlyArray<InventoryMovementResponse>;
  readonly status: "ready";
  readonly store: { readonly code: string; readonly displayName: string };
  readonly summary: {
    readonly alertCount: number;
    readonly itemCount: number;
    readonly productCount: number;
    readonly spareCount: number;
  };
}

export type ManagerInventoryCommandRequest =
  | {
      readonly action: "receipt";
      readonly inventoryItemId: string;
      readonly quantity: number;
      readonly reason: string;
    }
  | {
      readonly action: "stocktake";
      readonly actualQuantity: number;
      readonly inventoryItemId: string;
      readonly reason: string;
    }
  | {
      readonly action: "compensation";
      readonly inventoryItemId: string;
      readonly onHandDelta: number;
      readonly originalMovementId: string | null;
      readonly reason: string;
    };

export interface ManagerInventoryCommandResponse {
  readonly action: ManagerInventoryAction;
  readonly alerting: boolean;
  readonly alertTransition: "activated" | "resolved" | "unchanged";
  readonly businessOccurredAt: string;
  readonly inventoryItemId: string;
  readonly movementId: string;
  readonly onHandAfter: number;
  readonly onHandDelta: number;
  readonly originalMovementId: string | null;
  readonly reason: string;
  readonly replayed: boolean;
}

export type StoreAreaLifecycleStatus = "active" | "archived" | "draft";
export type SeatLifecycleStatus = "active" | "draft" | "inactive";
export type StoreBusinessHoursDaySet = "all" | "weekdays" | "weekends";

export interface ManagerStoreConfigurationResponse {
  readonly status: "ready";
  readonly currentTime: string;
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
      readonly daySet: StoreBusinessHoursDaySet;
      readonly effectiveFrom: string;
      readonly isOpen24Hours: boolean;
      readonly opensAt: string;
    }>;
    readonly scheduled: ReadonlyArray<{
      readonly businessHoursId: string;
      readonly closesAt: string;
      readonly closesNextDay: boolean;
      readonly daySet: StoreBusinessHoursDaySet;
      readonly effectiveFrom: string;
      readonly isOpen24Hours: boolean;
      readonly opensAt: string;
    }>;
  };
  readonly areas: ReadonlyArray<{
    readonly areaId: string;
    readonly businessReferenced: boolean;
    readonly code: string;
    readonly displayName: string;
    readonly lifecycleStatus: StoreAreaLifecycleStatus;
    readonly seatCount: number;
    readonly sortOrder: number;
    readonly version: number;
  }>;
  readonly machineProfiles: ReadonlyArray<{
    readonly archived: boolean;
    readonly code: CustomerMachineProfileCode;
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
    readonly effectiveFrom: string;
    readonly effectiveUntil: string | null;
    readonly endsAt: string;
    readonly endsNextDay: boolean;
    readonly machineProfile: {
      readonly code: CustomerMachineProfileCode;
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
    readonly lifecycleStatus: SeatLifecycleStatus;
    readonly machineProfile: {
      readonly code: CustomerMachineProfileCode;
      readonly displayName: string;
      readonly machineProfileId: string;
    };
    readonly operationalStatus: "maintenance" | "normal";
    readonly seatId: string;
    readonly sortOrder: number;
    readonly version: number;
  }>;
}

export interface ManagerPricePlanOverlapPreviewRequest extends PricePlanClockRange {
  readonly areaId: string;
  readonly effectiveFrom: string;
  readonly machineProfileId: string;
}

export interface ManagerPricePlanOverlapPreviewResponse {
  readonly overlap: {
    readonly pricePlanId: string;
    readonly status: "current" | "scheduled";
    readonly version: number;
  } | null;
  readonly status: "ready";
}

interface ManagerStoreConfigurationCommandBase {
  readonly expectedVersion: number;
  readonly storeId: string;
}

export type ManagerStoreConfigurationCommandRequest =
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
          readonly daySet: StoreBusinessHoursDaySet;
          readonly effectiveFrom: string;
          readonly isOpen24Hours: boolean;
          readonly opensAt: string;
        }
      | {
          readonly action: "create-area";
          readonly code: string;
          readonly displayName: string;
          readonly lifecycleStatus: Exclude<
            StoreAreaLifecycleStatus,
            "archived"
          >;
          readonly sortOrder: number;
        }
      | {
          readonly action: "update-area";
          readonly areaId: string;
          readonly displayName: string;
          readonly lifecycleStatus: StoreAreaLifecycleStatus;
          readonly sortOrder: number;
        }
      | { readonly action: "delete-area"; readonly areaId: string }
      | { readonly action: "delete-seat"; readonly seatId: string }
      | {
          readonly action: "create-seat";
          readonly areaId: string;
          readonly code: string;
          readonly lifecycleStatus: Exclude<SeatLifecycleStatus, "inactive">;
          readonly machineProfileId: string;
          readonly sortOrder: number;
        }
      | {
          readonly action: "create-price-plan";
          readonly areaId: string;
          readonly effectiveFrom: string;
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
          readonly lifecycleStatus: SeatLifecycleStatus;
          readonly machineProfileId: string;
          readonly seatId: string;
          readonly sortOrder: number;
        }
    );

export interface ManagerStoreConfigurationCommandResponse {
  readonly action: ManagerStoreConfigurationCommandRequest["action"];
  readonly objectId: string;
  readonly replayed: boolean;
  readonly version: number;
}

export type CustomerMemberTier = "bronze" | "gold" | "silver";
export type CustomerExperienceCouponStatus =
  "available" | "expired" | "redeemed" | "reserved";

export interface CustomerMembershipResponse {
  readonly status: "ready";
  readonly currentTime: string;
  readonly profile: {
    readonly customerDisplayName: string;
    readonly growthPoints: number;
    readonly lifetimeNondecreasing: true;
    readonly nextTier: {
      readonly remainingGrowthPoints: number;
      readonly threshold: 500 | 1_500;
    } | null;
    readonly operatorScope: "三店共享";
    readonly tier: {
      readonly code: CustomerMemberTier;
      readonly label: "青铜" | "白银" | "黄金";
    };
  };
  readonly coupons: ReadonlyArray<{
    readonly businessKind: "order" | "reservation";
    readonly code: string;
    readonly discountCents: number;
    readonly displayName: string;
    readonly id: string;
    readonly minimumSpendCents: number;
    readonly releaseCondition: string;
    readonly status: CustomerExperienceCouponStatus;
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
    readonly validFrom: string;
    readonly validUntil: string;
  }>;
  readonly growthEvents: ReadonlyArray<{
    readonly businessOccurredAt: string;
    readonly finalSimulatedAmountCents: number;
    readonly growthPoints: number;
    readonly id: string;
    readonly label: string;
    readonly source: {
      readonly id: string | null;
      readonly kind: "order" | "reservation" | "seed-baseline";
    };
  }>;
}

export interface CustomerJourneyReservation {
  readonly area: { readonly code: string; readonly displayName: string };
  readonly coupon: {
    readonly displayName: string;
    readonly discountCents: number;
  } | null;
  readonly growthAward: {
    readonly growthPoints: number;
  } | null;
  readonly machineProfile: {
    readonly code: CustomerMachineProfileCode;
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
  readonly status: CustomerReservationStatus;
  readonly store: { readonly code: string; readonly displayName: string };
  readonly terminalReason: string | null;
  readonly window: { readonly endsAt: string; readonly startsAt: string };
}

export interface CustomerJourneyResponse {
  readonly status: "ready";
  readonly currentTime: string;
  readonly groups: {
    readonly current: ReadonlyArray<CustomerJourneyReservation>;
    readonly future: ReadonlyArray<CustomerJourneyReservation>;
    readonly history: ReadonlyArray<CustomerJourneyReservation>;
  };
}

export const FRONTLINE_RESERVATION_ACTIONS = [
  "arrive",
  "start-use",
  "complete-early",
  "cancel",
] as const;

export type FrontlineReservationAction =
  (typeof FRONTLINE_RESERVATION_ACTIONS)[number];

export const STAFF_RESERVATION_TIME_FILTERS = [
  "all",
  "arrival-window",
  "upcoming",
  "in-progress",
] as const;

export type StaffReservationTimeFilter =
  (typeof STAFF_RESERVATION_TIME_FILTERS)[number];

export const STAFF_RESERVATION_ANOMALY_FILTERS = [
  "all",
  "only",
  "none",
] as const;

export type StaffReservationAnomalyFilter =
  (typeof STAFF_RESERVATION_ANOMALY_FILTERS)[number];

export interface StaffReservationSummary {
  readonly anomaly: {
    readonly code: "seat-maintenance";
    readonly label: string;
  } | null;
  readonly area: { readonly code: string; readonly displayName: string };
  readonly arrivalWindow: {
    readonly closesAt: string;
    readonly opensAt: string;
  };
  readonly customer: { readonly displayName: string };
  readonly machineProfile: {
    readonly code: CustomerMachineProfileCode;
    readonly displayName: string;
  };
  readonly payableCents: number;
  readonly reservationId: string;
  readonly seat: { readonly code: string };
  readonly status: CustomerReservationStatus;
  readonly window: { readonly endsAt: string; readonly startsAt: string };
}

export interface StaffReservationWorkbenchResponse {
  readonly businessDay: {
    readonly endsAt: string;
    readonly key: string;
    readonly startsAt: string;
  };
  readonly currentTime: string;
  readonly queues: {
    readonly anomalies: ReadonlyArray<StaffReservationSummary>;
    readonly arrivalWindow: ReadonlyArray<StaffReservationSummary>;
    readonly arrived: ReadonlyArray<StaffReservationSummary>;
    readonly inUse: ReadonlyArray<StaffReservationSummary>;
  };
  readonly status: "ready";
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface StaffReservationListResponse {
  readonly businessDay: StaffReservationWorkbenchResponse["businessDay"];
  readonly currentTime: string;
  readonly filterOptions: {
    readonly areas: ReadonlyArray<{
      readonly code: string;
      readonly displayName: string;
    }>;
    readonly machineProfiles: ReadonlyArray<{
      readonly code: CustomerMachineProfileCode;
      readonly displayName: string;
    }>;
  };
  readonly rows: ReadonlyArray<StaffReservationSummary>;
  readonly status: "ready";
  readonly store: StaffReservationWorkbenchResponse["store"];
}

export interface StaffReservationDetailResponse {
  readonly actions: {
    readonly canCancel: boolean;
    readonly primary: {
      readonly kind: Exclude<FrontlineReservationAction, "cancel">;
      readonly label: "办理到店" | "开始使用" | "提前结束";
      readonly requiresReason: boolean;
    } | null;
  };
  readonly auditAvailable: boolean;
  readonly cancelledAt: string | null;
  readonly completedAt: string | null;
  readonly currentTime: string;
  readonly arrivedAt: string | null;
  readonly refund: CustomerReservationDetailResponse["refund"];
  readonly related: {
    readonly orders: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly status: CustomerOrderStatus;
    }>;
    readonly repairs: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly status: RepairStatus;
    }>;
  };
  readonly reservation: StaffReservationSummary;
  readonly snapshot: CustomerPendingReservationResponse["snapshot"];
  readonly startedAt: string | null;
  readonly terminalReason: string | null;
  readonly timeline: CustomerReservationDetailResponse["timeline"];
}

export interface StaffReservationCommandRequest {
  readonly action: FrontlineReservationAction;
  readonly reason?: string;
}

export interface StaffReservationCommandResponse {
  readonly action: FrontlineReservationAction;
  readonly occurredAt: string;
  readonly replayed: boolean;
  readonly reservationId: string;
  readonly status: CustomerReservationStatus;
}

export const STAFF_ATTENDANCE_ACTIONS = [
  "simulated-check-in",
  "manual-check-out",
] as const;

export type StaffAttendanceAction = (typeof STAFF_ATTENDANCE_ACTIONS)[number];
export type StaffAttendanceStatus = "absent" | "checked-in" | "checked-out";

export interface StaffShiftAttendanceSummary {
  readonly attendance: {
    readonly absence: {
      readonly businessOccurredAt: string;
      readonly recordedAt: string;
    } | null;
    readonly checkIn: {
      readonly businessOccurredAt: string;
      readonly outcome: "late" | "on-time";
      readonly recordedAt: string;
      readonly source: "simulated";
    } | null;
    readonly checkOut: {
      readonly businessOccurredAt: string;
      readonly recordedAt: string;
      readonly source: "manual";
    } | null;
    readonly status: StaffAttendanceStatus;
  } | null;
  readonly canManageSchedule: boolean;
  readonly facts: ReadonlyArray<{
    readonly businessOccurredAt: string;
    readonly data: unknown;
    readonly recordedAt: string;
    readonly type:
      | "attendance.absence-recorded"
      | "attendance.manual-check-out"
      | "attendance.simulated-check-in";
  }>;
  readonly nextAction: {
    readonly kind: StaffAttendanceAction;
    readonly label: "手动签退" | "模拟签到";
  } | null;
  readonly shiftId: string;
  readonly signInWindow: {
    readonly closesAt: string;
    readonly opensAt: string;
  };
  readonly window: { readonly endsAt: string; readonly startsAt: string };
}

export interface StaffShiftAttendanceResponse {
  readonly currentTime: string;
  readonly employee: {
    readonly displayName: string;
    readonly employeeCode: string;
    readonly role: "manager" | "staff";
  };
  readonly shifts: {
    readonly current: StaffShiftAttendanceSummary | null;
    readonly future: ReadonlyArray<StaffShiftAttendanceSummary>;
    readonly recent: ReadonlyArray<StaffShiftAttendanceSummary>;
  };
  readonly status: "ready";
  readonly store: { readonly code: string; readonly displayName: string };
}

export interface StaffAttendanceCommandRequest {
  readonly action: StaffAttendanceAction;
}

export interface StaffAttendanceCommandResponse {
  readonly action: StaffAttendanceAction;
  readonly occurredAt: string;
  readonly outcome: "late" | "on-time" | null;
  readonly replayed: boolean;
  readonly shiftId: string;
  readonly status: StaffAttendanceStatus;
}

export type HandoverExceptionKind =
  "confirmation-overdue" | "late-submission" | "submission-overdue";

export interface StaffHandoverSnapshot {
  readonly capturedAt: string;
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
    readonly priority: "high" | "normal" | "urgent";
    readonly repairId: string;
    readonly seatCode: string;
    readonly status: "assigned" | "new" | "processing" | "verification";
  }>;
  readonly reservations: ReadonlyArray<{
    readonly customerDisplayName: string;
    readonly endsAt: string;
    readonly reservationId: string;
    readonly seatCode: string;
    readonly startsAt: string;
    readonly status:
      "arrived" | "confirmed" | "in-use" | "pending-confirmation";
  }>;
}

export interface StaffHandover {
  readonly confirmed: {
    readonly businessOccurredAt: string;
    readonly by: {
      readonly displayName: string;
      readonly employeeCode: string;
    };
    readonly recordedAt: string;
  } | null;
  readonly handoverId: string;
  readonly note: string;
  readonly shiftId: string;
  readonly snapshot: StaffHandoverSnapshot;
  readonly submittedAt: {
    readonly businessOccurredAt: string;
    readonly recordedAt: string;
  };
  readonly submittedBy: {
    readonly displayName: string;
    readonly employeeCode: string;
  };
}

export interface StaffHandoversResponse {
  readonly currentTime: string;
  readonly employee: StaffShiftAttendanceResponse["employee"];
  readonly incoming: ReadonlyArray<{
    readonly canConfirm: boolean;
    readonly handover: StaffHandover;
  }>;
  readonly outgoing: {
    readonly canSubmit: boolean;
    readonly handover: StaffHandover | null;
    readonly shiftId: string;
    readonly snapshotPreview: StaffHandoverSnapshot;
    readonly window: { readonly endsAt: string; readonly startsAt: string };
  } | null;
  readonly status: "ready";
  readonly store: StaffShiftAttendanceResponse["store"];
}

export interface SubmitHandoverRequest {
  readonly note: string;
  readonly shiftId: string;
}

export interface HandoverCommandResponse extends StaffHandover {
  readonly replayed: boolean;
}

export interface ManagerHandoverExceptionsResponse {
  readonly currentTime: string;
  readonly exceptions: ReadonlyArray<{
    readonly businessOccurredAt: string;
    readonly employee: {
      readonly displayName: string;
      readonly employeeCode: string;
    };
    readonly handover: StaffHandover | null;
    readonly kind: HandoverExceptionKind;
    readonly recordedAt: string;
    readonly shiftId: string;
    readonly window: { readonly endsAt: string; readonly startsAt: string };
  }>;
  readonly status: "ready";
  readonly store: StaffShiftAttendanceResponse["store"];
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

export type ManagerDashboardDrilldownKind =
  | "attendance"
  | "evidence"
  | "handover"
  | "inventory"
  | "orders"
  | "repairs"
  | "revenue"
  | "seats";

export interface ManagerDashboardRevenueResponse {
  readonly orderCents: number;
  readonly reservationCents: number;
  readonly totalCents: number;
}

export interface ManagerDashboardSeatResponse {
  readonly businessSeatMinutes: number;
  readonly maintenanceMinutes: number;
  readonly maintenanceRateBasisPoints: number;
  readonly normalSeatMinutes: number;
  readonly operationalUtilizationBasisPoints: number;
  readonly usedMinutes: number;
}

export interface ManagerDashboardDayResponse {
  readonly key: string;
  readonly revenue: ManagerDashboardRevenueResponse;
  readonly seats: ManagerDashboardSeatResponse;
}

export interface ManagerDashboardResponse {
  readonly status: "ready";
  readonly availableBusinessDays: ReadonlyArray<{
    readonly endsAt: string;
    readonly key: string;
    readonly startsAt: string;
  }>;
  readonly currentTime: string;
  readonly days: ReadonlyArray<ManagerDashboardDayResponse>;
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
      readonly occurredAt: string;
      readonly status: string;
      readonly title: string;
    }>;
    readonly storeCode: string;
    readonly toBusinessDay: string;
  } | null;
  readonly range: {
    readonly endsAt: string;
    readonly fromBusinessDay: string;
    readonly preset: "current" | "custom";
    readonly startsAt: string;
    readonly toBusinessDay: string;
  };
  readonly recentEvidence: ReadonlyArray<{
    readonly action: string;
    readonly businessDayKey: string;
    readonly detail: string;
    readonly objectId: string;
    readonly objectType:
      "attendance" | "handover" | "order" | "repair" | "reservation";
    readonly occurredAt: string;
    readonly title: string;
  }>;
  readonly store: { readonly code: string; readonly displayName: string };
  readonly summary: {
    readonly attendance: {
      readonly absent: number;
      readonly late: number;
      readonly onTime: number;
    };
    readonly handoverExceptionCount: number;
    readonly inventory: { readonly lowStockCount: number };
    readonly orders: {
      readonly backlogCount: number;
      readonly completedCount: number;
      readonly completionRateBasisPoints: number;
      readonly eligibleTerminalCount: number;
      readonly wasteCents: number;
      readonly wasteQuantity: number;
    };
    readonly repairs: {
      readonly maintenanceMinutes: number;
      readonly medianResolutionMinutes: number | null;
      readonly openByPriority: {
        readonly high: number;
        readonly normal: number;
        readonly urgent: number;
      };
      readonly openCount: number;
    };
    readonly revenue: ManagerDashboardRevenueResponse;
    readonly seats: ManagerDashboardSeatResponse;
  };
  readonly trend: ReadonlyArray<ManagerDashboardDayResponse>;
}

export type ManagerPeopleFrontlineRole = "manager" | "staff";

export interface ManagerCoverageWarningResponse {
  readonly actualStaff: number;
  readonly endsAt: string;
  readonly minimumStaff: number;
  readonly startsAt: string;
}

export interface ManagerPeopleScheduleResponse {
  readonly status: "ready";
  readonly currentTime: string;
  readonly store: {
    readonly code: string;
    readonly displayName: string;
    readonly fixed: true;
    readonly storeId: string;
  };
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
    readonly role: ManagerPeopleFrontlineRole;
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
      readonly role: ManagerPeopleFrontlineRole;
    };
    readonly endsAt: string;
    readonly shiftId: string;
    readonly startsAt: string;
    readonly status: "cancelled" | "scheduled";
  }>;
  readonly attendance: ReadonlyArray<{
    readonly attendanceRecordId: string;
    readonly corrections: ReadonlyArray<{
      readonly businessOccurredAt: string;
      readonly correctedBusinessAt: string;
      readonly correctedBy: string;
      readonly correctionId: string;
      readonly correctionKind: "absence" | "check-out" | "late";
      readonly reason: string;
      readonly recordedAt: string;
    }>;
    readonly employee: {
      readonly displayName: string;
      readonly employeeCode: string;
      readonly employeeId: string;
    };
    readonly original: {
      readonly absenceBusinessAt: string | null;
      readonly checkInBusinessAt: string | null;
      readonly checkInOutcome: "late" | "on-time" | null;
      readonly checkOutBusinessAt: string | null;
      readonly status: "absent" | "checked-in" | "checked-out";
    };
    readonly shiftId: string;
    readonly window: { readonly endsAt: string; readonly startsAt: string };
  }>;
  readonly coverageWarnings: ReadonlyArray<ManagerCoverageWarningResponse>;
}

export interface ManagerShiftCoveragePreviewRequest {
  readonly employeeId: string;
  readonly endsAt: string;
  readonly startsAt: string;
  readonly storeId: string;
  readonly shiftId?: string;
}

export interface ManagerShiftCoveragePreviewResponse {
  readonly status: "ready";
  readonly validation:
    | { readonly status: "valid" }
    | {
        readonly reason: "duration" | "half-hour-alignment" | "overlap";
        readonly status: "invalid";
      };
  readonly warnings: ReadonlyArray<ManagerCoverageWarningResponse>;
}

interface ManagerPeopleCommandBase {
  readonly storeId: string;
}

export type ManagerPeopleCommandRequest = ManagerPeopleCommandBase &
  (
    | {
        readonly action: "create-employee";
        readonly displayName: string;
        readonly employeeCode: string;
        readonly employeeRole: ManagerPeopleFrontlineRole;
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
        readonly endsAt: string;
        readonly startsAt: string;
      }
    | {
        readonly action: "update-shift";
        readonly endsAt: string;
        readonly shiftId: string;
        readonly startsAt: string;
      }
    | { readonly action: "cancel-shift"; readonly shiftId: string }
    | {
        readonly action: "correct-attendance";
        readonly attendanceRecordId: string;
        readonly correctedBusinessAt: string;
        readonly correctionKind: "absence" | "check-out" | "late";
        readonly reason: string;
      }
  );

export interface ManagerPeopleCommandResponse {
  readonly action: ManagerPeopleCommandRequest["action"];
  readonly coverageWarnings: ReadonlyArray<ManagerCoverageWarningResponse>;
  readonly objectId: string;
  readonly replayed: boolean;
  readonly status: "ready";
}

export interface HeadquartersPeopleScheduleResponse {
  readonly status: "ready";
  readonly currentTime: string;
  readonly stores: ReadonlyArray<{
    readonly activeEmployeeCount: number;
    readonly attendanceAnomalyCount: number;
    readonly coverageWarnings: number;
    readonly employeeCount: number;
    readonly futureShiftCount: number;
    readonly managerCount: number;
    readonly staffCount: number;
    readonly store: { readonly code: string; readonly displayName: string };
  }>;
}
