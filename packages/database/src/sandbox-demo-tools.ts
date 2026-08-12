import { createHash, randomUUID } from "node:crypto";

import type { Pool, PoolClient } from "pg";
import {
  DEMO_TIME_DUE_HANDLER_KINDS,
  type DemoTimeDueHandlerKind as ContractDemoTimeDueHandlerKind,
  type PublicRole,
} from "@jingshu/contracts";
import {
  SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
  SANDBOX_BUSINESS_TIME_ZONE,
  planSandboxBusinessTimeAdvance,
  sandboxBusinessTimeAt,
  type SandboxBusinessTimeAdvanceMode,
} from "@jingshu/domain";

import {
  DemoTimeAdvanceLimitReachedError,
  DemoTimeNoNextEventError,
  RoleContextStaleError,
  RoleContextUnavailableError,
  SandboxCommandIdempotencyConflictError,
} from "./errors.js";
import type {
  DatabaseRoleContext,
  PublicSandboxResult,
} from "./public-sandbox.js";

export const DEMO_TIME_DUE_HANDLER_ORDER = DEMO_TIME_DUE_HANDLER_KINDS;

export type DemoTimeDueHandlerKind = ContractDemoTimeDueHandlerKind;

export interface WallClock {
  now(): Date;
}

interface DueHandlerReadContext {
  readonly client: PoolClient;
  readonly currentBusinessTime: Date;
  readonly sandboxId: string;
}

interface DueHandlerRangeContext extends DueHandlerReadContext {
  readonly recordedAt: Date;
  readonly targetBusinessTime: Date;
}

export interface DemoTimeDueHandler {
  nextDueAt(context: DueHandlerReadContext): Promise<Date | null>;
  previewDue(context: DueHandlerRangeContext): Promise<number>;
  processDue(context: DueHandlerRangeContext): Promise<number>;
}

export type DemoTimeDueHandlerRegistry = Partial<
  Record<DemoTimeDueHandlerKind, DemoTimeDueHandler>
>;

export interface DemoToolRoleContextInput {
  readonly contextVersion: number;
  readonly personaId: string;
  readonly role: PublicRole;
  readonly sandboxId: string;
}

export interface DemoTimeImpact {
  readonly count: number;
  readonly kind: DemoTimeDueHandlerKind;
}

export interface DatabaseBusinessClock {
  readonly advanceLimitMilliseconds: number;
  readonly advancedMilliseconds: number;
  readonly currentTime: Date;
  readonly remainingAdvanceMilliseconds: number;
  readonly timeZone: typeof SANDBOX_BUSINESS_TIME_ZONE;
}

export interface DatabaseDemoTimePreview {
  readonly clock: DatabaseBusinessClock;
  readonly halfHour: {
    readonly afterTime: Date | null;
    readonly impacts: ReadonlyArray<DemoTimeImpact>;
  };
  readonly nextEvent: {
    readonly afterTime: Date;
    readonly impacts: ReadonlyArray<DemoTimeImpact>;
  } | null;
}

export interface AdvanceDemoTimeInput extends DemoToolRoleContextInput {
  readonly idempotencyKey: string;
  readonly mode: SandboxBusinessTimeAdvanceMode;
  readonly requestId: string;
}

export interface AdvanceDemoTimeResult {
  readonly afterTime: Date;
  readonly beforeTime: Date;
  readonly clock: Omit<DatabaseBusinessClock, "currentTime">;
  readonly impacts: ReadonlyArray<DemoTimeImpact>;
  readonly mode: SandboxBusinessTimeAdvanceMode;
  readonly replayed: boolean;
}

export interface ResetSandboxInput extends DemoToolRoleContextInput {
  readonly clientIp?: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly visitorKey?: string;
}

export interface ResetSandboxOutcome {
  readonly businessClock: DatabaseBusinessClock;
  readonly expiresAt: Date;
  readonly personaDisplayName: string;
  readonly schemaVersion: string;
  readonly seedVersion: string;
  readonly targetRole: "customer";
}

export interface ResetSandboxResult {
  readonly outcome: ResetSandboxOutcome;
  readonly replayed: boolean;
  readonly roleContext: DatabaseRoleContext;
}

export interface SandboxDemoToolMethods {
  advanceDemoTime(input: AdvanceDemoTimeInput): Promise<AdvanceDemoTimeResult>;
  readDemoTime(
    input: DemoToolRoleContextInput,
  ): Promise<DatabaseDemoTimePreview>;
  resetSandbox(input: ResetSandboxInput): Promise<ResetSandboxResult>;
}

interface DemoSandboxRow {
  business_time_advance_ms: number;
  business_time_anchor_at: Date;
  business_time_anchor_wall_at: Date;
  expires_at: Date;
  id: string;
  invalidated_at: Date | null;
  role_context_role: PublicRole | null;
  role_context_version: number;
  seed_version: string;
}

interface PersonaRow {
  id: string;
  store_id: string | null;
}

interface CommandRow {
  payload_hash: string;
  result_data: unknown | null;
}

interface StoredAdvanceResult {
  afterTime: string;
  beforeTime: string;
  clock: Omit<DatabaseBusinessClock, "currentTime">;
  impacts: ReadonlyArray<DemoTimeImpact>;
  mode: SandboxBusinessTimeAdvanceMode;
}

interface StoredResetResult {
  readonly newSandboxId: string;
  readonly outcome: {
    readonly businessClock: Omit<DatabaseBusinessClock, "currentTime"> & {
      readonly currentTime: string;
    };
    readonly expiresAt: string;
    readonly personaDisplayName: string;
    readonly schemaVersion: string;
    readonly seedVersion: string;
    readonly targetRole: "customer";
  };
}

interface DemoToolsOptions {
  readonly consumeResetAdmission?: (
    client: PoolClient,
    input: {
      readonly clientIp: string | undefined;
      readonly visitorKey: string | undefined;
      readonly wallTime: Date;
    },
  ) => Promise<void>;
  readonly dueHandlers: DemoTimeDueHandlerRegistry;
  readonly holdSandboxAdmissionLock?: (client: PoolClient) => Promise<void>;
  readonly sandboxLifetimeMilliseconds: number;
  readonly wallClock: WallClock;
}

interface MaterializeSandboxInput {
  readonly client: PoolClient;
  readonly expiresAt: Date;
  readonly sandboxId: string;
  readonly selectedRole: PublicRole;
  readonly wallTime: Date;
}

type MaterializeSandbox = (
  input: MaterializeSandboxInput,
) => Promise<PublicSandboxResult>;

type ReadSandboxResult = (
  client: PoolClient,
  sandboxId: string,
  selectedRole: PublicRole,
  replayed: boolean,
  wallTime: Date,
) => Promise<PublicSandboxResult>;

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clockFromRow(
  sandbox: DemoSandboxRow,
  wallTime: Date,
): DatabaseBusinessClock {
  return {
    advanceLimitMilliseconds: SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
    advancedMilliseconds: sandbox.business_time_advance_ms,
    currentTime: sandboxBusinessTimeAt({
      advancedMilliseconds: sandbox.business_time_advance_ms,
      businessAnchor: sandbox.business_time_anchor_at,
      wallAnchor: sandbox.business_time_anchor_wall_at,
      wallTime,
    }),
    remainingAdvanceMilliseconds:
      SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS - sandbox.business_time_advance_ms,
    timeZone: SANDBOX_BUSINESS_TIME_ZONE,
  };
}

async function readActiveSandbox(
  client: PoolClient,
  input: DemoToolRoleContextInput,
  wallTime: Date,
  lock: boolean,
): Promise<{ persona: PersonaRow; sandbox: DemoSandboxRow }> {
  const sandbox = await client.query<DemoSandboxRow>(
    `select id, expires_at, invalidated_at, role_context_role, seed_version,
            role_context_version, business_time_anchor_at,
            business_time_anchor_wall_at, business_time_advance_ms
       from sandboxes where id = $1${lock ? " for update" : ""}`,
    [input.sandboxId],
  );
  const sandboxRow = sandbox.rows[0];
  if (!sandboxRow) throw new RoleContextUnavailableError();
  if (sandboxRow.expires_at.getTime() <= wallTime.getTime()) {
    throw new RoleContextUnavailableError("expired");
  }
  if (sandboxRow.invalidated_at !== null) {
    throw new RoleContextUnavailableError("reset");
  }
  if (
    sandboxRow.role_context_version !== input.contextVersion ||
    sandboxRow.role_context_role !== input.role
  ) {
    throw new RoleContextStaleError();
  }

  const persona = await client.query<PersonaRow>(
    `select id, store_id from demo_personas
      where sandbox_id = $1 and id = $2 and role = $3 and protected = true`,
    [input.sandboxId, input.personaId, input.role],
  );
  const personaRow = persona.rows[0];
  if (!personaRow) throw new RoleContextUnavailableError();
  return { persona: personaRow, sandbox: sandboxRow };
}

async function findNextEvent(
  client: PoolClient,
  dueHandlers: DemoTimeDueHandlerRegistry,
  sandboxId: string,
  currentBusinessTime: Date,
): Promise<Date | null> {
  const candidates: Date[] = [];
  for (const kind of DEMO_TIME_DUE_HANDLER_ORDER) {
    const handler = dueHandlers[kind];
    if (!handler) continue;
    const candidate = await handler.nextDueAt({
      client,
      currentBusinessTime,
      sandboxId,
    });
    if (candidate && candidate.getTime() > currentBusinessTime.getTime()) {
      candidates.push(candidate);
    }
  }
  return (
    candidates.toSorted((left, right) => left.getTime() - right.getTime())[0] ??
    null
  );
}

async function previewImpacts(
  client: PoolClient,
  dueHandlers: DemoTimeDueHandlerRegistry,
  sandboxId: string,
  currentBusinessTime: Date,
  targetBusinessTime: Date,
  recordedAt: Date,
): Promise<DemoTimeImpact[]> {
  const impacts: DemoTimeImpact[] = [];
  for (const kind of DEMO_TIME_DUE_HANDLER_ORDER) {
    const handler = dueHandlers[kind];
    if (!handler) continue;
    const count = await handler.previewDue({
      client,
      currentBusinessTime,
      recordedAt,
      sandboxId,
      targetBusinessTime,
    });
    if (count > 0) impacts.push({ count, kind });
  }
  return impacts;
}

async function processDueHandlers(
  client: PoolClient,
  dueHandlers: DemoTimeDueHandlerRegistry,
  sandboxId: string,
  currentBusinessTime: Date,
  targetBusinessTime: Date,
  recordedAt: Date,
): Promise<DemoTimeImpact[]> {
  const impacts: DemoTimeImpact[] = [];
  for (const kind of DEMO_TIME_DUE_HANDLER_ORDER) {
    const handler = dueHandlers[kind];
    if (!handler) continue;
    const count = await handler.processDue({
      client,
      currentBusinessTime,
      recordedAt,
      sandboxId,
      targetBusinessTime,
    });
    if (count > 0) impacts.push({ count, kind });
  }
  return impacts;
}

async function reserveCommand(
  client: PoolClient,
  input: {
    commandType: "demo_time.advance" | "sandbox.reset";
    idempotencyKey: string;
    payload: unknown;
    sandboxId: string;
    wallTime: Date;
  },
): Promise<{ replayed: boolean; result: unknown | null }> {
  const idempotencyKeyHash = hash(input.idempotencyKey);
  const payloadHash = hash(JSON.stringify(input.payload));
  const inserted = await client.query<CommandRow>(
    `insert into sandbox_command_requests (
       sandbox_id, command_type, idempotency_key_hash, payload_hash, created_at
     ) values ($1, $2, $3, $4, $5)
     on conflict (sandbox_id, command_type, idempotency_key_hash) do nothing
     returning payload_hash, result_data`,
    [
      input.sandboxId,
      input.commandType,
      idempotencyKeyHash,
      payloadHash,
      input.wallTime,
    ],
  );
  if (inserted.rowCount === 1) return { replayed: false, result: null };

  const existing = await client.query<CommandRow>(
    `select payload_hash, result_data from sandbox_command_requests
      where sandbox_id = $1 and command_type = $2 and idempotency_key_hash = $3`,
    [input.sandboxId, input.commandType, idempotencyKeyHash],
  );
  const row = existing.rows[0];
  if (!row || row.payload_hash !== payloadHash) {
    throw new SandboxCommandIdempotencyConflictError();
  }
  if (row.result_data === null) {
    throw new Error("The idempotent sandbox command did not persist a result.");
  }
  return { replayed: true, result: row.result_data };
}

async function saveCommandResult(
  client: PoolClient,
  input: {
    commandType: "demo_time.advance" | "sandbox.reset";
    idempotencyKey: string;
    result: unknown;
    sandboxId: string;
  },
) {
  await client.query(
    `update sandbox_command_requests set result_data = $4::jsonb
      where sandbox_id = $1 and command_type = $2 and idempotency_key_hash = $3`,
    [
      input.sandboxId,
      input.commandType,
      hash(input.idempotencyKey),
      JSON.stringify(input.result),
    ],
  );
}

function storedAdvanceResult(
  value: unknown,
  replayed: boolean,
): AdvanceDemoTimeResult {
  const stored = value as StoredAdvanceResult;
  return {
    ...stored,
    afterTime: new Date(stored.afterTime),
    beforeTime: new Date(stored.beforeTime),
    replayed,
  };
}

function storedResetResult(
  newSandboxId: string,
  replacement: PublicSandboxResult,
): StoredResetResult {
  return {
    newSandboxId,
    outcome: {
      businessClock: {
        ...replacement.roleContext.businessClock,
        currentTime:
          replacement.roleContext.businessClock.currentTime.toISOString(),
      },
      expiresAt: replacement.expiresAt.toISOString(),
      personaDisplayName: replacement.persona.displayName,
      schemaVersion: replacement.schemaVersion,
      seedVersion: replacement.seedVersion,
      targetRole: "customer",
    },
  };
}

function resetOutcomeFromStored(
  stored: StoredResetResult,
): ResetSandboxOutcome {
  return {
    ...stored.outcome,
    businessClock: {
      ...stored.outcome.businessClock,
      currentTime: new Date(stored.outcome.businessClock.currentTime),
    },
    expiresAt: new Date(stored.outcome.expiresAt),
  };
}

export function createSandboxDemoToolMethods(
  pool: Pool,
  options: DemoToolsOptions,
  materializeSandbox: MaterializeSandbox,
  readSandboxResult: ReadSandboxResult,
): SandboxDemoToolMethods {
  return {
    async readDemoTime(input) {
      const client = await pool.connect();
      const wallTime = options.wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const { sandbox } = await readActiveSandbox(
          client,
          input,
          wallTime,
          false,
        );
        const clock = clockFromRow(sandbox, wallTime);
        const nextEventTime = await findNextEvent(
          client,
          options.dueHandlers,
          input.sandboxId,
          clock.currentTime,
        );
        const nextEventPlan = nextEventTime
          ? planSandboxBusinessTimeAdvance({
              accumulatedAdvanceMilliseconds: clock.advancedMilliseconds,
              currentBusinessTime: clock.currentTime,
              mode: "next-event",
              nextEventTime,
            })
          : null;
        const previewedNextEventTime =
          nextEventPlan?.status === "ready"
            ? nextEventPlan.afterBusinessTime
            : null;
        const halfHourPlan = planSandboxBusinessTimeAdvance({
          accumulatedAdvanceMilliseconds: clock.advancedMilliseconds,
          currentBusinessTime: clock.currentTime,
          mode: "half-hour",
          nextEventTime: null,
        });
        const halfHourTime =
          halfHourPlan.status === "ready"
            ? halfHourPlan.afterBusinessTime
            : null;
        const halfHourImpacts = halfHourTime
          ? await previewImpacts(
              client,
              options.dueHandlers,
              input.sandboxId,
              clock.currentTime,
              halfHourTime,
              wallTime,
            )
          : [];
        const nextEventImpacts = previewedNextEventTime
          ? await previewImpacts(
              client,
              options.dueHandlers,
              input.sandboxId,
              clock.currentTime,
              previewedNextEventTime,
              wallTime,
            )
          : [];
        await client.query("commit");
        return {
          clock,
          halfHour: { afterTime: halfHourTime, impacts: halfHourImpacts },
          nextEvent: previewedNextEventTime
            ? { afterTime: previewedNextEventTime, impacts: nextEventImpacts }
            : null,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async advanceDemoTime(input) {
      const client = await pool.connect();
      const wallTime = options.wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const { persona, sandbox } = await readActiveSandbox(
          client,
          input,
          wallTime,
          true,
        );
        const command = await reserveCommand(client, {
          commandType: "demo_time.advance",
          idempotencyKey: input.idempotencyKey,
          payload: { mode: input.mode },
          sandboxId: input.sandboxId,
          wallTime,
        });
        if (command.replayed) {
          await client.query("commit");
          return storedAdvanceResult(command.result, true);
        }

        const clock = clockFromRow(sandbox, wallTime);
        const nextEventTime =
          input.mode === "next-event"
            ? await findNextEvent(
                client,
                options.dueHandlers,
                input.sandboxId,
                clock.currentTime,
              )
            : null;
        const plan = planSandboxBusinessTimeAdvance({
          accumulatedAdvanceMilliseconds: clock.advancedMilliseconds,
          currentBusinessTime: clock.currentTime,
          mode: input.mode,
          nextEventTime,
        });
        if (plan.status === "no-next-event") {
          throw new DemoTimeNoNextEventError();
        }
        if (plan.status === "limit-reached") {
          throw new DemoTimeAdvanceLimitReachedError();
        }

        const impacts = await processDueHandlers(
          client,
          options.dueHandlers,
          input.sandboxId,
          clock.currentTime,
          plan.afterBusinessTime,
          wallTime,
        );
        await client.query(
          `update sandboxes set business_time_advance_ms = $2 where id = $1`,
          [input.sandboxId, plan.accumulatedAdvanceMilliseconds],
        );
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, 'demo_time.advance', 'sandbox',
             $2, 'allowed', null, $6, $7::jsonb, $8::jsonb, $9, $10)`,
          [
            randomUUID(),
            input.sandboxId,
            persona.store_id,
            persona.id,
            input.role,
            input.requestId,
            JSON.stringify({
              advancedMilliseconds: clock.advancedMilliseconds,
              businessTime: clock.currentTime.toISOString(),
            }),
            JSON.stringify({
              advancedMilliseconds: plan.accumulatedAdvanceMilliseconds,
              businessTime: plan.afterBusinessTime.toISOString(),
              impacts,
              mode: input.mode,
            }),
            plan.afterBusinessTime,
            wallTime,
          ],
        );

        const stored = {
          afterTime: plan.afterBusinessTime.toISOString(),
          beforeTime: clock.currentTime.toISOString(),
          clock: {
            advanceLimitMilliseconds: SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS,
            advancedMilliseconds: plan.accumulatedAdvanceMilliseconds,
            remainingAdvanceMilliseconds:
              SANDBOX_BUSINESS_TIME_ADVANCE_LIMIT_MS -
              plan.accumulatedAdvanceMilliseconds,
            timeZone: SANDBOX_BUSINESS_TIME_ZONE,
          },
          impacts,
          mode: input.mode,
        } satisfies StoredAdvanceResult;
        await saveCommandResult(client, {
          commandType: "demo_time.advance",
          idempotencyKey: input.idempotencyKey,
          result: stored,
          sandboxId: input.sandboxId,
        });
        await client.query("commit");
        return storedAdvanceResult(stored, false);
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },

    async resetSandbox(input) {
      const client = await pool.connect();
      const wallTime = options.wallClock.now();
      try {
        await client.query("begin");
        await client.query("set local role jingshu_runtime");
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const command = await reserveCommand(client, {
          commandType: "sandbox.reset",
          idempotencyKey: input.idempotencyKey,
          payload: { targetRole: "customer" },
          sandboxId: input.sandboxId,
          wallTime,
        });
        if (command.replayed) {
          const stored = command.result as StoredResetResult;
          await client.query("select set_config('app.sandbox_id', $1, true)", [
            stored.newSandboxId,
          ]);
          const replayed = await readSandboxResult(
            client,
            stored.newSandboxId,
            "customer",
            true,
            wallTime,
          );
          await client.query("commit");
          return {
            outcome: resetOutcomeFromStored(stored),
            replayed: true,
            roleContext: replayed.roleContext,
          };
        }

        await options.consumeResetAdmission?.(client, {
          clientIp: input.clientIp,
          visitorKey: input.visitorKey,
          wallTime,
        });
        await options.holdSandboxAdmissionLock?.(client);

        const { persona, sandbox } = await readActiveSandbox(
          client,
          input,
          wallTime,
          true,
        );
        const oldBusinessClock = clockFromRow(sandbox, wallTime);
        const newSandboxId = randomUUID();
        await client.query("select set_config('app.sandbox_id', $1, true)", [
          newSandboxId,
        ]);
        const replacement = await materializeSandbox({
          client,
          expiresAt: new Date(
            wallTime.getTime() + options.sandboxLifetimeMilliseconds,
          ),
          sandboxId: newSandboxId,
          selectedRole: "customer",
          wallTime,
        });
        const stored = storedResetResult(newSandboxId, replacement);
        await reserveCommand(client, {
          commandType: "sandbox.reset",
          idempotencyKey: input.idempotencyKey,
          payload: { targetRole: "customer" },
          sandboxId: newSandboxId,
          wallTime,
        });
        await saveCommandResult(client, {
          commandType: "sandbox.reset",
          idempotencyKey: input.idempotencyKey,
          result: stored,
          sandboxId: newSandboxId,
        });
        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, null, $3, 'customer', 'sandbox.reset.source',
             'sandbox', $4, 'allowed', null, $5, null, $6::jsonb, $7, $8)`,
          [
            randomUUID(),
            newSandboxId,
            replacement.roleContext.persona.id,
            input.sandboxId,
            input.requestId,
            JSON.stringify({
              sourceContextVersion: input.contextVersion,
              sourceRole: input.role,
              sourceSandboxId: input.sandboxId,
            }),
            replacement.roleContext.businessClock.currentTime,
            wallTime,
          ],
        );

        await client.query("select set_config('app.sandbox_id', $1, true)", [
          input.sandboxId,
        ]);
        const invalidated = await client.query(
          `update sandboxes
              set invalidated_at = $3, replaced_by_sandbox_id = $4,
                  role_context_version = role_context_version + 1
            where id = $1 and role_context_version = $2 and invalidated_at is null`,
          [input.sandboxId, input.contextVersion, wallTime, newSandboxId],
        );
        if (invalidated.rowCount !== 1) throw new RoleContextStaleError();

        const cleanupTask = await client.query(
          `update sandbox_lifecycle_tasks
              set state = 'pending', cleanup_reason = 'reset',
                  cleanup_phase = 'blobs', cleanup_started_at = coalesce(
                    cleanup_started_at, $2
                  ), attempts = 0, available_at = $2, last_failure = null,
                  updated_at = $2
            where sandbox_id = $1`,
          [input.sandboxId, wallTime],
        );
        if (cleanupTask.rowCount !== 1) {
          throw new Error(
            "The replaced sandbox has no lifecycle cleanup task.",
          );
        }

        await client.query(
          `insert into audit_events (
             id, sandbox_id, store_id, persona_id, role, action, object_type,
             object_id, result, reason, request_id, before_data, after_data,
             business_occurred_at, recorded_at
           ) values ($1, $2, $3, $4, $5, 'sandbox.reset', 'sandbox',
             $2, 'allowed', null, $6, $7::jsonb, $8::jsonb, $9, $10)`,
          [
            randomUUID(),
            input.sandboxId,
            persona.store_id,
            persona.id,
            input.role,
            input.requestId,
            JSON.stringify({
              businessTime: oldBusinessClock.currentTime.toISOString(),
              contextVersion: input.contextVersion,
              seedVersion: sandbox.seed_version,
            }),
            JSON.stringify({
              contextVersion: replacement.roleContext.contextVersion,
              resetToRole: "customer",
              seedVersion: replacement.seedVersion,
            }),
            oldBusinessClock.currentTime,
            wallTime,
          ],
        );
        await saveCommandResult(client, {
          commandType: "sandbox.reset",
          idempotencyKey: input.idempotencyKey,
          result: stored,
          sandboxId: input.sandboxId,
        });
        await client.query("commit");
        return {
          outcome: resetOutcomeFromStored(stored),
          replayed: false,
          roleContext: replacement.roleContext,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
