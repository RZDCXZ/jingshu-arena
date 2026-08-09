import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

export * from "./schema.js";
export {
  createPublicSandboxDatabase,
  PublicSandboxIdempotencyConflictError,
  type CreatePublicSandboxInput,
  type PublicSandboxDatabase,
  type PublicSandboxResult,
} from "./public-sandbox.js";

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
