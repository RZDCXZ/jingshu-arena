import { createHash, randomUUID } from "node:crypto";

import pg from "pg";
import type { PoolClient } from "pg";
import type { PublicRole } from "@jingshu/contracts";
import { buildPublicSandboxSeed } from "@jingshu/domain";

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

export interface PublicSandboxDatabase {
  create(input: CreatePublicSandboxInput): Promise<PublicSandboxResult>;
  readCurrentRoleContext(
    input: ReadCurrentRoleContextInput,
  ): Promise<DatabaseRoleContext>;
  readRoleContext(input: ReadRoleContextInput): Promise<DatabaseRoleContext>;
  switchRoleContext(
    input: SwitchRoleContextInput,
  ): Promise<DatabaseRoleContext>;
  recordRoleContextDenial(input: RecordRoleContextDenialInput): Promise<void>;
  close(): Promise<void>;
}

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
    super("The role context is missing, invalid, or expired.");
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

const storeSeeds = publicSandboxSeed.stores;
const personaSeeds = publicSandboxSeed.personas;

interface SandboxRow {
  id: string;
  schema_version: string;
  seed_version: string;
  expires_at: Date;
  role_context_role: PublicRole | null;
  role_context_version: number;
}

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

interface CreationRequestRow {
  payload_hash: string;
  sandbox_id: string;
  selected_role: PublicRole;
  visitor_key_hash: string | null;
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

function buildRoleContext(
  sandbox: SandboxRow,
  persona: PersonaRow,
  stores: ReadonlyArray<StoreRow>,
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
): Promise<PublicSandboxResult> {
  const sandbox = await client.query<SandboxRow>(
    `select id, schema_version, seed_version, expires_at,
            role_context_role, role_context_version
       from sandboxes where id = $1 for update`,
    [sandboxId],
  );
  let sandboxRow = sandbox.rows[0];
  if (!sandboxRow) {
    throw new Error("The public sandbox transaction returned incomplete data.");
  }
  if (sandboxRow.role_context_role === null) {
    const claimed = await client.query<SandboxRow>(
      `update sandboxes
          set role_context_role = $2
        where id = $1 and role_context_role is null
      returning id, schema_version, seed_version, expires_at,
                role_context_role, role_context_version`,
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
          );
          await client.query("commit");
          return replayed;
        }

        await client.query("select set_config('app.sandbox_id', $1, true)", [
          sandboxId,
        ]);
        await client.query(
          `insert into sandboxes (
             id, schema_version, seed_version, expires_at, role_context_role
           ) values ($1, $2, $3, $4, $5)`,
          [
            sandboxId,
            publicSandboxSeed.schemaVersion,
            publicSandboxSeed.seedVersion,
            expiresAt,
            input.selectedRole,
          ],
        );
        await client.query(
          `insert into operators (id, sandbox_id, display_name, city)
           values ($1, $2, $3, $4)`,
          [
            operatorId,
            sandboxId,
            publicSandboxSeed.operator.displayName,
            publicSandboxSeed.operator.city,
          ],
        );

        const seededStores = storeSeeds.map((store) => ({
          ...store,
          id: randomUUID(),
        }));
        const storeIds = new Map(
          seededStores.map((store) => [store.code, store.id]),
        );
        await client.query(
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
            seededStores.map(() => sandboxId),
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
        await client.query(
          `insert into demo_personas (
             id, sandbox_id, store_id, role, display_name, scope, protected
           )
           select * from unnest(
             $1::uuid[], $2::uuid[], $3::uuid[], $4::text[],
             $5::text[], $6::text[], $7::boolean[]
           )`,
          [
            seededPersonas.map((persona) => persona.id),
            seededPersonas.map(() => sandboxId),
            seededPersonas.map((persona) => persona.storeId),
            seededPersonas.map((persona) => persona.role),
            seededPersonas.map((persona) => persona.displayName),
            seededPersonas.map((persona) => persona.scope),
            seededPersonas.map((persona) => persona.protected),
          ],
        );

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
    async readCurrentRoleContext(input) {
      const client = await pool.connect();

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);

        const sandbox = await client.query<SandboxRow>(
          `select id, schema_version, seed_version, expires_at,
                  role_context_role, role_context_version
             from sandboxes where id = $1 for update`,
          [input.sandboxId],
        );
        let sandboxRow = sandbox.rows[0];
        if (!sandboxRow || sandboxRow.expires_at.getTime() <= Date.now()) {
          throw new RoleContextUnavailableError();
        }
        if (!sandboxRow.role_context_role && input.claimRole) {
          const claimed = await client.query<SandboxRow>(
            `update sandboxes
                set role_context_role = $2
              where id = $1 and role_context_role is null
            returning id, schema_version, seed_version, expires_at,
                      role_context_role, role_context_version`,
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
            returning id, schema_version, seed_version, expires_at,
                      role_context_role, role_context_version`,
            [input.sandboxId, input.fence.contextVersion, input.fence.role],
          );
          const fencedRow = fenced.rows[0];
          if (!fencedRow) throw new RoleContextStaleError();
          sandboxRow = fencedRow;
          await client.query(
            `insert into audit_events (
               id, sandbox_id, store_id, persona_id, role, action, object_type,
               object_id, result, reason, request_id, before_data, after_data
             ) values ($1, $2, $3, $4, $5, 'role_context.recover',
               'role_context', null, 'allowed', null, $6, $7::jsonb, $8::jsonb)`,
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

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);

        const sandbox = await client.query<SandboxRow>(
          `select id, schema_version, seed_version, expires_at,
                  role_context_role, role_context_version
             from sandboxes where id = $1`,
          [input.sandboxId],
        );
        const sandboxRow = sandbox.rows[0];
        if (!sandboxRow || sandboxRow.expires_at.getTime() <= Date.now()) {
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

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);

        const sandbox = await client.query<SandboxRow>(
          `select id, schema_version, seed_version, expires_at,
                  role_context_role, role_context_version
             from sandboxes where id = $1 for update`,
          [input.sandboxId],
        );
        const sandboxRow = sandbox.rows[0];
        if (!sandboxRow || sandboxRow.expires_at.getTime() <= Date.now()) {
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
          returning id, schema_version, seed_version, expires_at,
                    role_context_role, role_context_version`,
          [input.sandboxId, input.contextVersion, input.targetRole, input.role],
        );
        const updatedSandboxRow = updatedSandbox.rows[0];
        if (!updatedSandboxRow) throw new RoleContextStaleError();

        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'allowed', null, $9, $10::jsonb, $11::jsonb)`,
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

      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id
           ) values ($1, $2, $3, $4, $5, $6, $7,
                     $8, 'denied', $9, $10)`,
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
