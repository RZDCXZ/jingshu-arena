import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgPolicy,
  pgTable,
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
  },
  (table) => [
    check(
      "sandboxes_expiry_after_creation",
      sql`${table.expiresAt} > ${table.createdAt}`,
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
