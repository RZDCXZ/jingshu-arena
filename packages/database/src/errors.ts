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
