import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export * from "./schema.js";
export {
  CustomerSeatBrowseValidationError,
  type CustomerSeatBrowseValidationReason,
  CustomerReservationCreateConflictError,
  type CustomerReservationCreateConflictReason,
  CustomerReservationIdempotencyConflictError,
  CustomerReservationLifecycleConflictError,
  type CustomerReservationLifecycleConflictReason,
  DemoTimeAdvanceLimitReachedError,
  DemoTimeNoNextEventError,
  PublicSandboxIdempotencyConflictError,
  PublicSandboxOwnershipConflictError,
  RoleContextStaleError,
  RoleContextUnavailableError,
  SandboxCommandIdempotencyConflictError,
} from "./errors.js";
export {
  createPublicSandboxDatabase,
  type CancelCustomerReservationInput,
  type CreatePublicSandboxInput,
  type CreateCustomerPendingReservationInput,
  type CustomerBrowseContextInput,
  type DatabaseCustomerSeatAvailability,
  type DatabaseCustomerPendingReservation,
  type DatabaseCustomerReservationCancellation,
  type DatabaseCustomerReservationDetail,
  type DatabaseCustomerReservationPayment,
  type DatabaseCustomerStoreCatalog,
  type DatabaseRoleContext,
  type PublicSandboxDatabase,
  type PublicSandboxDatabaseOptions,
  type PublicSandboxResult,
  type ReadCustomerSeatAvailabilityInput,
  type ReadCustomerReservationDetailInput,
  type SimulateCustomerReservationPaymentInput,
  type RecordRoleContextDenialInput,
  type ReadCurrentRoleContextInput,
  type ReadRoleContextInput,
  type SwitchRoleContextInput,
} from "./public-sandbox.js";
export {
  DEMO_TIME_DUE_HANDLER_ORDER,
  type AdvanceDemoTimeInput,
  type AdvanceDemoTimeResult,
  type DatabaseBusinessClock,
  type DatabaseDemoTimePreview,
  type DemoTimeDueHandler,
  type DemoTimeDueHandlerKind,
  type DemoTimeDueHandlerRegistry,
  type DemoTimeImpact,
  type DemoToolRoleContextInput,
  type ResetSandboxInput,
  type ResetSandboxOutcome,
  type ResetSandboxResult,
  type WallClock,
} from "./sandbox-demo-tools.js";

const { Pool } = pg;
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function migrateEmptyDatabase(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });

  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
