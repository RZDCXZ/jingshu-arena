export class RoleContextStaleError extends Error {
  readonly code = "ROLE_CONTEXT_STALE";

  constructor() {
    super("The role context version is no longer current.");
    this.name = "RoleContextStaleError";
  }
}

export class RoleContextUnavailableError extends Error {
  readonly code = "ROLE_CONTEXT_UNAVAILABLE";

  constructor() {
    super("The role context is missing, invalid, expired, or replaced.");
    this.name = "RoleContextUnavailableError";
  }
}

export class PublicSandboxIdempotencyConflictError extends Error {
  readonly code = "PUBLIC_SANDBOX_IDEMPOTENCY_CONFLICT";

  constructor() {
    super("The creation key was already used with another payload.");
    this.name = "PublicSandboxIdempotencyConflictError";
  }
}

export class PublicSandboxOwnershipConflictError extends Error {
  readonly code = "PUBLIC_SANDBOX_OWNERSHIP_CONFLICT";

  constructor() {
    super("The creation key belongs to another visitor.");
    this.name = "PublicSandboxOwnershipConflictError";
  }
}

export class SandboxCommandIdempotencyConflictError extends Error {
  readonly code = "SANDBOX_COMMAND_IDEMPOTENCY_CONFLICT";

  constructor() {
    super("The command key was already used with another payload.");
    this.name = "SandboxCommandIdempotencyConflictError";
  }
}

export class DemoTimeAdvanceLimitReachedError extends Error {
  readonly code = "DEMO_TIME_ADVANCE_LIMIT_REACHED";

  constructor() {
    super("The sandbox business-time advance limit has been reached.");
    this.name = "DemoTimeAdvanceLimitReachedError";
  }
}

export class DemoTimeNoNextEventError extends Error {
  readonly code = "DEMO_TIME_NO_NEXT_EVENT";

  constructor() {
    super("No registered due handler has a future event.");
    this.name = "DemoTimeNoNextEventError";
  }
}

export type CustomerSeatBrowseValidationReason =
  | "area-not-found"
  | "duration"
  | "future-start"
  | "half-hour-alignment"
  | "machine-profile-not-found"
  | "outside-business-hours"
  | "price-plan-not-found"
  | "seven-day-window"
  | "store-not-found";

export class CustomerSeatBrowseValidationError extends Error {
  readonly code = "CUSTOMER_SEAT_BROWSE_INVALID";
  readonly reason: CustomerSeatBrowseValidationReason;

  constructor(reason: CustomerSeatBrowseValidationReason) {
    super(`Customer seat browse query is invalid: ${reason}.`);
    this.name = "CustomerSeatBrowseValidationError";
    this.reason = reason;
  }
}

export type CustomerReservationCreateConflictReason =
  | "coupon-ineligible"
  | "coupon-not-found"
  | "coupon-unavailable"
  | "customer-conflict"
  | "seat-conflict"
  | "seat-maintenance"
  | "seat-not-found";

export class CustomerReservationCreateConflictError extends Error {
  readonly code = "CUSTOMER_RESERVATION_CREATE_CONFLICT";
  readonly reason: CustomerReservationCreateConflictReason;

  constructor(reason: CustomerReservationCreateConflictReason) {
    super(`Customer pending reservation cannot be created: ${reason}.`);
    this.name = "CustomerReservationCreateConflictError";
    this.reason = reason;
  }
}

export class CustomerReservationIdempotencyConflictError extends Error {
  readonly code = "CUSTOMER_RESERVATION_IDEMPOTENCY_CONFLICT";

  constructor() {
    super("The reservation command key was already used for another payload.");
    this.name = "CustomerReservationIdempotencyConflictError";
  }
}

export type CustomerOrderConflictReason =
  | "coupon-ineligible"
  | "coupon-not-found"
  | "coupon-unavailable"
  | "empty-cart"
  | "hold-expired"
  | "idempotency-conflict"
  | "illegal-transition"
  | "insufficient-inventory"
  | "invalid-quantity"
  | "not-found"
  | "product-not-listed"
  | "reservation-ineligible";

export class CustomerOrderConflictError extends Error {
  readonly code = "CUSTOMER_ORDER_CONFLICT";
  readonly currentStatus: string | null;
  readonly reason: CustomerOrderConflictReason;

  constructor(
    reason: CustomerOrderConflictReason,
    currentStatus: string | null = null,
  ) {
    super(`Customer order command was rejected: ${reason}.`);
    this.name = "CustomerOrderConflictError";
    this.currentStatus = currentStatus;
    this.reason = reason;
  }
}

export type CustomerReservationLifecycleConflictReason =
  "hold-expired" | "illegal-transition" | "not-found" | "reservation-started";

export class CustomerReservationLifecycleConflictError extends Error {
  readonly code = "CUSTOMER_RESERVATION_LIFECYCLE_CONFLICT";
  readonly currentStatus: ReservationStatus | null;
  readonly reason: CustomerReservationLifecycleConflictReason;

  constructor(
    reason: CustomerReservationLifecycleConflictReason,
    currentStatus: ReservationStatus | null = null,
  ) {
    super(`Customer reservation lifecycle command was rejected: ${reason}.`);
    this.name = "CustomerReservationLifecycleConflictError";
    this.currentStatus = currentStatus;
    this.reason = reason;
  }
}

export type FrontlineReservationConflictReason =
  | "arrival-window-closed"
  | "arrival-window-not-open"
  | "cross-store"
  | "hold-expired"
  | "idempotency-conflict"
  | "illegal-transition"
  | "not-found"
  | "reservation-ended"
  | "reservation-not-started";

export class FrontlineReservationConflictError extends Error {
  readonly code = "FRONTLINE_RESERVATION_CONFLICT";
  readonly currentStatus: ReservationStatus | null;
  readonly reason: FrontlineReservationConflictReason;

  constructor(
    reason: FrontlineReservationConflictReason,
    currentStatus: ReservationStatus | null = null,
  ) {
    super(`Frontline reservation command was rejected: ${reason}.`);
    this.name = "FrontlineReservationConflictError";
    this.reason = reason;
    this.currentStatus = currentStatus;
  }
}

export type StaffOrderConflictReason =
  "cross-store" | "idempotency-conflict" | "illegal-transition" | "not-found";

export class StaffOrderConflictError extends Error {
  readonly code = "STAFF_ORDER_CONFLICT";
  readonly currentStatus: string | null;
  readonly reason: StaffOrderConflictReason;

  constructor(
    reason: StaffOrderConflictReason,
    currentStatus: string | null = null,
  ) {
    super(`Staff order command was rejected: ${reason}.`);
    this.name = "StaffOrderConflictError";
    this.reason = reason;
    this.currentStatus = currentStatus;
  }
}
import type { ReservationStatus } from "@jingshu/domain";
