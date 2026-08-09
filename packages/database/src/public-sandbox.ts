import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import type { PoolClient } from "pg";
import type { PublicRole } from "@jingshu/contracts";

const { Pool } = pg;

const SCHEMA_VERSION = "2";
const SEED_VERSION = "2026-08-09.1";
const SANDBOX_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface CreatePublicSandboxInput {
  creationKey: string;
  selectedRole: PublicRole;
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
}

export interface PublicSandboxDatabase {
  create(input: CreatePublicSandboxInput): Promise<PublicSandboxResult>;
  close(): Promise<void>;
}

export class PublicSandboxIdempotencyConflictError extends Error {
  readonly code = "PUBLIC_SANDBOX_IDEMPOTENCY_CONFLICT";

  constructor() {
    super("The creation key was already used with another payload.");
    this.name = "PublicSandboxIdempotencyConflictError";
  }
}

const storeSeeds = [
  {
    code: "prism-flagship",
    displayName: "棱镜旗舰店",
    seatCount: 96,
    opensAt: "00:00",
    closesAt: "00:00",
    closesNextDay: false,
    isOpen24Hours: true,
  },
  {
    code: "starbridge-standard",
    displayName: "星桥标准店",
    seatCount: 64,
    opensAt: "10:00",
    closesAt: "02:00",
    closesNextDay: true,
    isOpen24Hours: false,
  },
  {
    code: "apex-new",
    displayName: "极点新店",
    seatCount: 40,
    opensAt: "12:00",
    closesAt: "00:00",
    closesNextDay: false,
    isOpen24Hours: false,
  },
] as const;

const personaSeeds: ReadonlyArray<{
  role: PublicRole;
  displayName: string;
  scope: string;
  storeCode?: (typeof storeSeeds)[number]["code"];
}> = [
  {
    role: "customer",
    displayName: "林澈",
    scope: "浏览三店 · 只管理自己的记录",
  },
  {
    role: "staff",
    displayName: "周宁",
    scope: "棱镜旗舰店",
    storeCode: "prism-flagship",
  },
  {
    role: "manager",
    displayName: "许知远",
    scope: "棱镜旗舰店",
    storeCode: "prism-flagship",
  },
  {
    role: "hq",
    displayName: "沈微",
    scope: "固定三店",
  },
];

interface SandboxRow {
  id: string;
  schema_version: string;
  seed_version: string;
  expires_at: Date;
}

interface PersonaRow {
  display_name: string;
  protected: boolean;
  scope: string;
}

interface OperatorRow {
  display_name: string;
  city: string;
}

interface StoreRow {
  code: string;
  display_name: string;
  seat_count: number;
  opens_at: string;
  closes_at: string;
  closes_next_day: boolean;
  is_open_24_hours: boolean;
}

interface CreationRequestRow {
  payload_hash: string;
  sandbox_id: string;
  selected_role: PublicRole;
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

async function readSandboxResult(
  client: PoolClient,
  sandboxId: string,
  selectedRole: PublicRole,
  replayed: boolean,
): Promise<PublicSandboxResult> {
  const sandbox = await client.query<SandboxRow>(
    `select id, schema_version, seed_version, expires_at
       from sandboxes where id = $1`,
    [sandboxId],
  );
  const operator = await client.query<OperatorRow>(
    `select display_name, city from operators where sandbox_id = $1`,
    [sandboxId],
  );
  const stores = await client.query<StoreRow>(
    `select code, display_name, seat_count, opens_at, closes_at,
            closes_next_day, is_open_24_hours
       from stores where sandbox_id = $1 order by code`,
    [sandboxId],
  );
  const persona = await client.query<PersonaRow>(
    `select display_name, protected, scope
       from demo_personas where sandbox_id = $1 and role = $2`,
    [sandboxId, selectedRole],
  );

  const sandboxRow = sandbox.rows[0];
  const operatorRow = operator.rows[0];
  const personaRow = persona.rows[0];
  if (!sandboxRow || !operatorRow || !personaRow) {
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

  return {
    replayed,
    sandboxId: sandboxRow.id,
    schemaVersion: sandboxRow.schema_version,
    seedVersion: sandboxRow.seed_version,
    expiresAt: sandboxRow.expires_at,
    selectedRole,
    persona: {
      displayName: personaRow.display_name,
      protected: personaRow.protected,
      scope: personaRow.scope,
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
  };
}

export function createPublicSandboxDatabase(
  databaseUrl: string,
): PublicSandboxDatabase {
  const pool = new Pool({ connectionString: databaseUrl });

  return {
    async create(input) {
      const client = await pool.connect();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");

        const sandboxId = randomUUID();
        const operatorId = randomUUID();
        const expiresAt = new Date(Date.now() + SANDBOX_LIFETIME_MS);
        const creationKeyHash = hash(input.creationKey);
        const payloadHash = hash(
          JSON.stringify({ selectedRole: input.selectedRole }),
        );

        await client.query(
          "select set_config('app.creation_key_hash', $1, true)",
          [creationKeyHash],
        );

        const insertedRequest = await client.query<CreationRequestRow>(
          `insert into sandbox_creation_requests (
             creation_key_hash, payload_hash, sandbox_id, selected_role
           ) values ($1, $2, $3, $4)
           on conflict (creation_key_hash) do nothing
           returning payload_hash, sandbox_id, selected_role`,
          [creationKeyHash, payloadHash, sandboxId, input.selectedRole],
        );

        if (insertedRequest.rowCount === 0) {
          const existingRequest = await client.query<CreationRequestRow>(
            `select payload_hash, sandbox_id, selected_role
               from sandbox_creation_requests where creation_key_hash = $1`,
            [creationKeyHash],
          );
          const existing = existingRequest.rows[0];
          if (!existing || existing.payload_hash !== payloadHash) {
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
          );
          await client.query("commit");
          return replayed;
        }

        await client.query("select set_config('app.sandbox_id', $1, true)", [
          sandboxId,
        ]);
        await client.query(
          `insert into sandboxes (id, schema_version, seed_version, expires_at)
           values ($1, $2, $3, $4)`,
          [sandboxId, SCHEMA_VERSION, SEED_VERSION, expiresAt],
        );
        await client.query(
          `insert into operators (id, sandbox_id, display_name, city)
           values ($1, $2, $3, $4)`,
          [operatorId, sandboxId, "竞枢演示经营方", "栖光市"],
        );

        const storeIds = new Map<string, string>();
        for (const store of storeSeeds) {
          const storeId = randomUUID();
          storeIds.set(store.code, storeId);
          await client.query(
            `insert into stores (
               id, sandbox_id, operator_id, code, display_name, seat_count,
               opens_at, closes_at, closes_next_day, is_open_24_hours
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              storeId,
              sandboxId,
              operatorId,
              store.code,
              store.displayName,
              store.seatCount,
              store.opensAt,
              store.closesAt,
              store.closesNextDay,
              store.isOpen24Hours,
            ],
          );
        }

        for (const persona of personaSeeds) {
          await client.query(
            `insert into demo_personas (
               id, sandbox_id, store_id, role, display_name, scope, protected
             ) values ($1, $2, $3, $4, $5, $6, true)`,
            [
              randomUUID(),
              sandboxId,
              persona.storeCode ? storeIds.get(persona.storeCode) : null,
              persona.role,
              persona.displayName,
              persona.scope,
            ],
          );
        }

        const created = await readSandboxResult(
          client,
          sandboxId,
          input.selectedRole,
          false,
        );
        await client.query("commit");
        return created;
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
