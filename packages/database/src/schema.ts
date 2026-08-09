import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const sandboxSetting = sql`nullif(current_setting('app.sandbox_id', true), '')::uuid`;
const creationKeySetting = sql`nullif(current_setting('app.creation_key_hash', true), '')`;

export const schemaMetadata = pgTable("jingshu_schema_metadata", {
  key: text("key").primaryKey(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  value: text("value").notNull(),
});

export const sandboxes = pgTable(
  "sandboxes",
  {
    id: uuid("id").primaryKey(),
    schemaVersion: text("schema_version").notNull(),
    seedVersion: text("seed_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    businessTimeAnchorAt: timestamp("business_time_anchor_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    businessTimeAnchorWallAt: timestamp("business_time_anchor_wall_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
    businessTimeAdvanceMs: integer("business_time_advance_ms")
      .default(0)
      .notNull(),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    replacedBySandboxId: uuid("replaced_by_sandbox_id").references(
      (): AnyPgColumn => sandboxes.id,
      { onDelete: "set null" },
    ),
    roleContextRole: text("role_context_role"),
    roleContextVersion: integer("role_context_version").default(1).notNull(),
  },
  (table) => [
    check(
      "sandboxes_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
    ),
    check(
      "sandboxes_positive_role_context_version",
      sql`${table.roleContextVersion} > 0`,
    ),
    check(
      "sandboxes_business_time_advance_range",
      sql`${table.businessTimeAdvanceMs} >= 0 AND ${table.businessTimeAdvanceMs} <= 86400000`,
    ),
    check(
      "sandboxes_public_role_context_role",
      sql`${table.roleContextRole} IN ('customer', 'staff', 'manager', 'hq')`,
    ),
    pgPolicy("sandboxes_isolate_by_sandbox", {
      using: sql`${table.id} = ${sandboxSetting}`,
      withCheck: sql`${table.id} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const operators = pgTable(
  "operators",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    city: text("city").notNull(),
  },
  (table) => [
    unique("operators_sandbox_unique").on(table.sandboxId),
    pgPolicy("operators_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => operators.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    seatCount: integer("seat_count").notNull(),
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
    closesNextDay: boolean("closes_next_day").default(false).notNull(),
    isOpen24Hours: boolean("is_open_24_hours").default(false).notNull(),
  },
  (table) => [
    unique("stores_sandbox_code_unique").on(table.sandboxId, table.code),
    check("stores_positive_seat_count", sql`${table.seatCount} > 0`),
    pgPolicy("stores_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const demoPersonas = pgTable(
  "demo_personas",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    role: text("role").notNull(),
    displayName: text("display_name").notNull(),
    scope: text("scope").notNull(),
    protected: boolean("protected").default(true).notNull(),
  },
  (table) => [
    unique("demo_personas_sandbox_role_unique").on(table.sandboxId, table.role),
    check(
      "demo_personas_public_role",
      sql`${table.role} IN ('customer', 'staff', 'manager', 'hq')`,
    ),
    pgPolicy("demo_personas_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    personaId: uuid("persona_id").references(() => demoPersonas.id, {
      onDelete: "restrict",
    }),
    role: text("role").notNull(),
    action: text("action").notNull(),
    objectType: text("object_type").notNull(),
    objectId: uuid("object_id"),
    result: text("result").notNull(),
    reason: text("reason"),
    requestId: uuid("request_id").notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data"),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "audit_events_public_role",
      sql`${table.role} IN ('customer', 'staff', 'manager', 'hq')`,
    ),
    check("audit_events_result", sql`${table.result} IN ('allowed', 'denied')`),
    pgPolicy("audit_events_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const sandboxCommandRequests = pgTable(
  "sandbox_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sandboxId, table.commandType, table.idempotencyKeyHash],
      name: "sandbox_command_requests_pk",
    }),
    check(
      "sandbox_command_requests_command_type",
      sql`${table.commandType} IN ('demo_time.advance', 'sandbox.reset')`,
    ),
    pgPolicy("sandbox_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const sandboxCreationRequests = pgTable(
  "sandbox_creation_requests",
  {
    creationKeyHash: text("creation_key_hash").primaryKey(),
    visitorKeyHash: text("visitor_key_hash"),
    payloadHash: text("payload_hash").notNull(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    selectedRole: text("selected_role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "sandbox_creation_requests_public_role",
      sql`${table.selectedRole} IN ('customer', 'staff', 'manager', 'hq')`,
    ),
    pgPolicy("sandbox_creation_requests_isolate_by_creation_key", {
      using: sql`${table.creationKeyHash} = ${creationKeySetting}`,
      withCheck: sql`${table.creationKeyHash} = ${creationKeySetting}`,
    }),
  ],
).enableRLS();
