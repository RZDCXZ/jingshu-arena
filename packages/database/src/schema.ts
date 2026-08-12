import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
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
    fictitiousCity: text("fictitious_city").notNull(),
    introduction: text("introduction").notNull(),
    seatCount: integer("seat_count").notNull(),
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
    closesNextDay: boolean("closes_next_day").default(false).notNull(),
    isOpen24Hours: boolean("is_open_24_hours").default(false).notNull(),
    configVersion: integer("config_version").default(1).notNull(),
  },
  (table) => [
    unique("stores_sandbox_code_unique").on(table.sandboxId, table.code),
    check("stores_positive_seat_count", sql`${table.seatCount} > 0`),
    check("stores_positive_config_version", sql`${table.configVersion} > 0`),
    pgPolicy("stores_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    archived: boolean("archived").default(false).notNull(),
    configVersion: integer("config_version").default(1).notNull(),
  },
  (table) => [
    unique("products_sandbox_code_unique").on(table.sandboxId, table.code),
    check(
      "products_category",
      sql`${table.category} IN ('drink', 'snack', 'meal', 'supply')`,
    ),
    check("products_positive_config_version", sql`${table.configVersion} > 0`),
    pgPolicy("products_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const productStoreScopes = pgTable(
  "product_store_scopes",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({
      columns: [table.sandboxId, table.productId, table.storeId],
      name: "product_store_scopes_pk",
    }),
    pgPolicy("product_store_scopes_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "restrict",
    }),
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    onHandQuantity: integer("on_hand_quantity").default(0).notNull(),
    reservedQuantity: integer("reserved_quantity").default(0).notNull(),
    lowStockThreshold: integer("low_stock_threshold").default(0).notNull(),
  },
  (table) => [
    unique("inventory_items_sandbox_store_code_unique").on(
      table.sandboxId,
      table.storeId,
      table.code,
    ),
    unique("inventory_items_store_product_unique").on(
      table.sandboxId,
      table.storeId,
      table.productId,
    ),
    check("inventory_items_kind", sql`${table.kind} IN ('product', 'spare')`),
    check(
      "inventory_items_product_reference",
      sql`(${table.kind} = 'product' AND ${table.productId} IS NOT NULL) OR (${table.kind} = 'spare' AND ${table.productId} IS NULL)`,
    ),
    check(
      "inventory_items_quantity_invariants",
      sql`${table.onHandQuantity} >= 0 AND ${table.reservedQuantity} >= 0 AND ${table.reservedQuantity} <= ${table.onHandQuantity} AND ${table.lowStockThreshold} >= 0`,
    ),
    pgPolicy("inventory_items_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const storeProducts = pgTable(
  "store_products",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    listed: boolean("listed").default(false).notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    archived: boolean("archived").default(false).notNull(),
    configVersion: integer("config_version").default(1).notNull(),
  },
  (table) => [
    unique("store_products_sandbox_store_product_unique").on(
      table.sandboxId,
      table.storeId,
      table.productId,
    ),
    unique("store_products_inventory_item_unique").on(table.inventoryItemId),
    check(
      "store_products_non_negative_price",
      sql`${table.unitPriceCents} >= 0`,
    ),
    check(
      "store_products_positive_config_version",
      sql`${table.configVersion} > 0`,
    ),
    pgPolicy("store_products_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const machineProfiles = pgTable(
  "machine_profiles",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    experienceDescription: text("experience_description").notNull(),
    archived: boolean("archived").default(false).notNull(),
    configVersion: integer("config_version").default(1).notNull(),
  },
  (table) => [
    unique("machine_profiles_sandbox_code_unique").on(
      table.sandboxId,
      table.code,
    ),
    check(
      "machine_profiles_positive_config_version",
      sql`${table.configVersion} > 0`,
    ),
    pgPolicy("machine_profiles_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const storeAreas = pgTable(
  "store_areas",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    lifecycleStatus: text("lifecycle_status").default("active").notNull(),
    configVersion: integer("config_version").default(1).notNull(),
  },
  (table) => [
    unique("store_areas_sandbox_store_code_unique").on(
      table.sandboxId,
      table.storeId,
      table.code,
    ),
    check("store_areas_positive_sort_order", sql`${table.sortOrder} >= 0`),
    check(
      "store_areas_lifecycle_status",
      sql`${table.lifecycleStatus} IN ('active', 'archived', 'draft')`,
    ),
    check(
      "store_areas_positive_config_version",
      sql`${table.configVersion} > 0`,
    ),
    pgPolicy("store_areas_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const seats = pgTable(
  "seats",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    areaId: uuid("area_id")
      .notNull()
      .references(() => storeAreas.id, { onDelete: "restrict" }),
    machineProfileId: uuid("machine_profile_id")
      .notNull()
      .references(() => machineProfiles.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    sortOrder: integer("sort_order").notNull(),
    operationalStatus: text("operational_status").default("normal").notNull(),
    lifecycleStatus: text("lifecycle_status").default("active").notNull(),
    configVersion: integer("config_version").default(1).notNull(),
  },
  (table) => [
    unique("seats_sandbox_store_code_unique").on(
      table.sandboxId,
      table.storeId,
      table.code,
    ),
    check(
      "seats_operational_status",
      sql`${table.operationalStatus} IN ('normal', 'maintenance')`,
    ),
    check("seats_positive_sort_order", sql`${table.sortOrder} >= 0`),
    check(
      "seats_lifecycle_status",
      sql`${table.lifecycleStatus} IN ('active', 'inactive', 'draft')`,
    ),
    check("seats_positive_config_version", sql`${table.configVersion} > 0`),
    pgPolicy("seats_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const storeBusinessHoursVersions = pgTable(
  "store_business_hours_versions",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    daySet: text("day_set").notNull(),
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
    closesNextDay: boolean("closes_next_day").default(false).notNull(),
    isOpen24Hours: boolean("is_open_24_hours").default(false).notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    createdByPersonaId: uuid("created_by_persona_id")
      .notNull()
      .references((): AnyPgColumn => demoPersonas.id, {
        onDelete: "restrict",
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("store_business_hours_scope_effective_unique").on(
      table.sandboxId,
      table.storeId,
      table.daySet,
      table.effectiveFrom,
    ),
    check(
      "store_business_hours_day_set",
      sql`${table.daySet} IN ('all', 'weekdays', 'weekends')`,
    ),
    pgPolicy("store_business_hours_versions_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const pricePlans = pgTable(
  "price_plans",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    areaId: uuid("area_id")
      .notNull()
      .references(() => storeAreas.id, { onDelete: "restrict" }),
    machineProfileId: uuid("machine_profile_id")
      .notNull()
      .references(() => machineProfiles.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    baseHourlyCents: integer("base_hourly_cents").notNull(),
    startsAt: time("starts_at").default("06:00").notNull(),
    endsAt: time("ends_at").default("06:00").notNull(),
    endsNextDay: boolean("ends_next_day").default(true).notNull(),
    weekdayHalfHourCents: integer("weekday_half_hour_cents")
      .default(0)
      .notNull(),
    weekendHalfHourCents: integer("weekend_half_hour_cents")
      .default(0)
      .notNull(),
    pricingModel: text("pricing_model").default("legacy").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    status: text("status").default("active").notNull(),
    configVersion: integer("config_version").default(1).notNull(),
  },
  (table) => [
    unique("price_plans_scope_version_unique").on(
      table.sandboxId,
      table.storeId,
      table.areaId,
      table.machineProfileId,
      table.startsAt,
      table.endsAt,
      table.endsNextDay,
      table.version,
    ),
    check("price_plans_positive_version", sql`${table.version} > 0`),
    check(
      "price_plans_non_negative_base_price",
      sql`${table.baseHourlyCents} >= 0`,
    ),
    check(
      "price_plans_non_negative_half_hour_prices",
      sql`${table.weekdayHalfHourCents} >= 0 AND ${table.weekendHalfHourCents} >= 0`,
    ),
    check(
      "price_plans_effective_range",
      sql`${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
    check("price_plans_status", sql`${table.status} IN ('active', 'archived')`),
    check(
      "price_plans_positive_config_version",
      sql`${table.configVersion} > 0`,
    ),
    check(
      "price_plans_pricing_model",
      sql`${table.pricingModel} IN ('legacy', 'explicit-half-hour')`,
    ),
    pgPolicy("price_plans_isolate_by_sandbox", {
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
    uniqueIndex("demo_personas_protected_sandbox_role_unique")
      .on(table.sandboxId, table.role)
      .where(sql`${table.protected} = true`),
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

export const storeConfigCommandRequests = pgTable(
  "store_config_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    actorPersonaId: uuid("actor_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.actorPersonaId,
        table.idempotencyKeyHash,
      ],
      name: "store_config_command_requests_pk",
    }),
    pgPolicy("store_config_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const headquartersCatalogCommandRequests = pgTable(
  "headquarters_catalog_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    actorPersonaId: uuid("actor_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.actorPersonaId,
        table.idempotencyKeyHash,
      ],
      name: "headquarters_catalog_command_requests_pk",
    }),
    check(
      "headquarters_catalog_command_requests_type",
      sql`${table.commandType} IN ('create-product', 'update-product', 'archive-product', 'create-machine-profile', 'update-machine-profile', 'archive-machine-profile')`,
    ),
    pgPolicy("headquarters_catalog_commands_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    personaId: uuid("persona_id").references(() => demoPersonas.id, {
      onDelete: "restrict",
    }),
    employeeCode: text("employee_code").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull(),
    active: boolean("active").default(true).notNull(),
    protected: boolean("protected").default(false).notNull(),
    configVersion: integer("config_version").default(1).notNull(),
  },
  (table) => [
    unique("employees_sandbox_store_code_unique").on(
      table.sandboxId,
      table.storeId,
      table.employeeCode,
    ),
    unique("employees_sandbox_persona_unique").on(
      table.sandboxId,
      table.personaId,
    ),
    unique("employees_sandbox_store_id_unique").on(
      table.sandboxId,
      table.storeId,
      table.id,
    ),
    check("employees_role", sql`${table.role} IN ('staff', 'manager')`),
    pgPolicy("employees_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: text("status").default("scheduled").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("shifts_sandbox_store_employee_id_unique").on(
      table.sandboxId,
      table.storeId,
      table.employeeId,
      table.id,
    ),
    check("shifts_status", sql`${table.status} IN ('scheduled', 'cancelled')`),
    check(
      "shifts_aligned_duration",
      sql`extract(minute from ${table.startsAt}) IN (0, 30)
        AND extract(second from ${table.startsAt}) = 0
        AND extract(minute from ${table.endsAt}) IN (0, 30)
        AND extract(second from ${table.endsAt}) = 0
        AND ${table.endsAt} - ${table.startsAt} BETWEEN interval '4 hours' AND interval '12 hours'`,
    ),
    foreignKey({
      columns: [table.sandboxId, table.storeId, table.employeeId],
      foreignColumns: [employees.sandboxId, employees.storeId, employees.id],
      name: "shifts_employee_scope_fk",
    }).onDelete("restrict"),
    pgPolicy("shifts_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const attendanceRecords = pgTable(
  "attendance_records",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    status: text("status").notNull(),
    checkInOutcome: text("check_in_outcome"),
    checkInBusinessAt: timestamp("check_in_business_at", {
      withTimezone: true,
    }),
    checkInRecordedAt: timestamp("check_in_recorded_at", {
      withTimezone: true,
    }),
    checkOutBusinessAt: timestamp("check_out_business_at", {
      withTimezone: true,
    }),
    checkOutRecordedAt: timestamp("check_out_recorded_at", {
      withTimezone: true,
    }),
    absenceBusinessAt: timestamp("absence_business_at", {
      withTimezone: true,
    }),
    absenceRecordedAt: timestamp("absence_recorded_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    unique("attendance_records_shift_unique").on(
      table.sandboxId,
      table.shiftId,
    ),
    uniqueIndex("attendance_records_one_open_per_employee")
      .on(table.sandboxId, table.employeeId)
      .where(sql`${table.status} = 'checked-in'`),
    check(
      "attendance_records_status",
      sql`${table.status} IN ('checked-in', 'checked-out', 'absent')`,
    ),
    check(
      "attendance_records_check_in_outcome",
      sql`${table.checkInOutcome} IN ('on-time', 'late')`,
    ),
    foreignKey({
      columns: [
        table.sandboxId,
        table.storeId,
        table.employeeId,
        table.shiftId,
      ],
      foreignColumns: [
        shifts.sandboxId,
        shifts.storeId,
        shifts.employeeId,
        shifts.id,
      ],
      name: "attendance_records_shift_scope_fk",
    }).onDelete("restrict"),
    pgPolicy("attendance_records_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const attendanceEvents = pgTable(
  "attendance_events",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "restrict" }),
    attendanceRecordId: uuid("attendance_record_id")
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventData: jsonb("event_data").notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "attendance_events_type",
      sql`${table.eventType} IN ('attendance.simulated-check-in', 'attendance.manual-check-out', 'attendance.absence-recorded')`,
    ),
    pgPolicy("attendance_events_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const attendanceCorrections = pgTable(
  "attendance_corrections",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "restrict" }),
    attendanceRecordId: uuid("attendance_record_id")
      .notNull()
      .references(() => attendanceRecords.id, { onDelete: "restrict" }),
    correctedByPersonaId: uuid("corrected_by_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "restrict" }),
    correctionKind: text("correction_kind").notNull(),
    correctedBusinessAt: timestamp("corrected_business_at", {
      withTimezone: true,
    }).notNull(),
    reason: text("reason").notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "attendance_corrections_kind",
      sql`${table.correctionKind} IN ('late', 'absence', 'check-out')`,
    ),
    check(
      "attendance_corrections_reason",
      sql`char_length(${table.reason}) BETWEEN 1 AND 200`,
    ),
    pgPolicy("attendance_corrections_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const attendanceCommandRequests = pgTable(
  "attendance_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.sandboxId, table.employeeId, table.idempotencyKeyHash],
      name: "attendance_command_requests_pk",
    }),
    pgPolicy("attendance_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const managerPeopleCommandRequests = pgTable(
  "manager_people_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    actorPersonaId: uuid("actor_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.actorPersonaId,
        table.commandType,
        table.idempotencyKeyHash,
      ],
      name: "manager_people_command_requests_pk",
    }),
    check(
      "manager_people_command_requests_type",
      sql`${table.commandType} IN ('create-employee', 'update-employee', 'deactivate-employee', 'create-shift', 'update-shift', 'cancel-shift', 'correct-attendance')`,
    ),
    pgPolicy("manager_people_commands_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const handovers = pgTable(
  "handovers",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    shiftId: uuid("shift_id").notNull(),
    submittedByEmployeeId: uuid("submitted_by_employee_id").notNull(),
    note: text("note").default("").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    submittedBusinessAt: timestamp("submitted_business_at", {
      withTimezone: true,
    }).notNull(),
    submittedRecordedAt: timestamp("submitted_recorded_at", {
      withTimezone: true,
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("handovers_sandbox_shift_unique").on(table.sandboxId, table.shiftId),
    unique("handovers_sandbox_store_id_unique").on(
      table.sandboxId,
      table.storeId,
      table.id,
    ),
    check("handovers_note_length", sql`char_length(${table.note}) <= 500`),
    foreignKey({
      columns: [
        table.sandboxId,
        table.storeId,
        table.submittedByEmployeeId,
        table.shiftId,
      ],
      foreignColumns: [
        shifts.sandboxId,
        shifts.storeId,
        shifts.employeeId,
        shifts.id,
      ],
      name: "handovers_submitter_shift_scope_fk",
    }).onDelete("restrict"),
    pgPolicy("handovers_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const handoverConfirmations = pgTable(
  "handover_confirmations",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    handoverId: uuid("handover_id").notNull(),
    confirmedByEmployeeId: uuid("confirmed_by_employee_id").notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("handover_confirmations_handover_unique").on(
      table.sandboxId,
      table.handoverId,
    ),
    foreignKey({
      columns: [table.sandboxId, table.storeId, table.handoverId],
      foreignColumns: [handovers.sandboxId, handovers.storeId, handovers.id],
      name: "handover_confirmations_handover_scope_fk",
    }).onDelete("restrict"),
    foreignKey({
      columns: [table.sandboxId, table.storeId, table.confirmedByEmployeeId],
      foreignColumns: [employees.sandboxId, employees.storeId, employees.id],
      name: "handover_confirmations_employee_scope_fk",
    }).onDelete("restrict"),
    pgPolicy("handover_confirmations_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const handoverExceptions = pgTable(
  "handover_exceptions",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => shifts.id, { onDelete: "restrict" }),
    handoverId: uuid("handover_id").references(() => handovers.id, {
      onDelete: "restrict",
    }),
    kind: text("kind").notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("handover_exceptions_shift_kind_unique").on(
      table.sandboxId,
      table.shiftId,
      table.kind,
    ),
    check(
      "handover_exceptions_kind",
      sql`${table.kind} IN ('submission-overdue', 'late-submission', 'confirmation-overdue')`,
    ),
    pgPolicy("handover_exceptions_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const handoverCommandRequests = pgTable(
  "handover_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.employeeId,
        table.commandType,
        table.idempotencyKeyHash,
      ],
      name: "handover_command_requests_pk",
    }),
    check(
      "handover_command_requests_type",
      sql`${table.commandType} IN ('submit', 'confirm')`,
    ),
    pgPolicy("handover_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const memberProfiles = pgTable(
  "member_profiles",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    customerPersonaId: uuid("customer_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    growthPoints: integer("growth_points").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("member_profiles_sandbox_customer_unique").on(
      table.sandboxId,
      table.customerPersonaId,
    ),
    check(
      "member_profiles_non_negative_growth",
      sql`${table.growthPoints} >= 0`,
    ),
    pgPolicy("member_profiles_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const experienceCoupons = pgTable(
  "experience_coupons",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    customerPersonaId: uuid("customer_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, {
      onDelete: "restrict",
    }),
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    businessKind: text("business_kind").notNull(),
    discountCents: integer("discount_cents").notNull(),
    minimumSpendCents: integer("minimum_spend_cents").notNull(),
    eligibleStartMinutes: integer("eligible_start_minutes").notNull(),
    eligibleEndMinutes: integer("eligible_end_minutes").notNull(),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
    status: text("status").default("available").notNull(),
    reservedReservationId: uuid("reserved_reservation_id"),
    reservedOrderId: uuid("reserved_order_id"),
    reservedUntil: timestamp("reserved_until", { withTimezone: true }),
  },
  (table) => [
    unique("experience_coupons_sandbox_code_unique").on(
      table.sandboxId,
      table.code,
    ),
    check(
      "experience_coupons_business_kind",
      sql`${table.businessKind} IN ('reservation', 'order')`,
    ),
    check(
      "experience_coupons_non_negative_amounts",
      sql`${table.discountCents} >= 0 AND ${table.minimumSpendCents} >= 0`,
    ),
    check(
      "experience_coupons_time_minutes",
      sql`${table.eligibleStartMinutes} >= 0 AND ${table.eligibleStartMinutes} < 1440 AND ${table.eligibleEndMinutes} > 0 AND ${table.eligibleEndMinutes} <= 1440`,
    ),
    check(
      "experience_coupons_valid_range",
      sql`${table.validUntil} > ${table.validFrom}`,
    ),
    check(
      "experience_coupons_status",
      sql`${table.status} IN ('available', 'reserved', 'redeemed', 'expired')`,
    ),
    check(
      "experience_coupons_single_reservation",
      sql`NOT (${table.reservedReservationId} IS NOT NULL AND ${table.reservedOrderId} IS NOT NULL)`,
    ),
    pgPolicy("experience_coupons_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    customerPersonaId: uuid("customer_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "restrict" }),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
    createdBusinessAt: timestamp("created_business_at", {
      withTimezone: true,
    }),
    priceSnapshot: jsonb("price_snapshot"),
    couponId: uuid("coupon_id").references(() => experienceCoupons.id, {
      onDelete: "restrict",
    }),
    couponSnapshot: jsonb("coupon_snapshot"),
    simulatedPaymentCents: integer("simulated_payment_cents"),
    confirmedBusinessAt: timestamp("confirmed_business_at", {
      withTimezone: true,
    }),
    arrivedBusinessAt: timestamp("arrived_business_at", {
      withTimezone: true,
    }),
    startedBusinessAt: timestamp("started_business_at", {
      withTimezone: true,
    }),
    completedBusinessAt: timestamp("completed_business_at", {
      withTimezone: true,
    }),
    cancelledBusinessAt: timestamp("cancelled_business_at", {
      withTimezone: true,
    }),
    expiredBusinessAt: timestamp("expired_business_at", {
      withTimezone: true,
    }),
    terminalReason: text("terminal_reason"),
  },
  (table) => [
    check("reservations_time_range", sql`${table.endsAt} > ${table.startsAt}`),
    check(
      "reservations_status",
      sql`${table.status} IN ('pending-confirmation', 'confirmed', 'arrived', 'in-use', 'completed', 'cancelled', 'expired')`,
    ),
    check(
      "reservations_pending_snapshot",
      sql`${table.status} <> 'pending-confirmation' OR (${table.holdExpiresAt} IS NOT NULL AND ${table.createdBusinessAt} IS NOT NULL AND ${table.priceSnapshot} IS NOT NULL)`,
    ),
    check(
      "reservations_non_negative_simulated_payment",
      sql`${table.simulatedPaymentCents} IS NULL OR ${table.simulatedPaymentCents} >= 0`,
    ),
    index("reservations_seat_time_idx").on(
      table.sandboxId,
      table.seatId,
      table.startsAt,
      table.endsAt,
    ),
    pgPolicy("reservations_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const repairs = pgTable(
  "repairs",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id, { onDelete: "restrict" }),
    machineProfileId: uuid("machine_profile_id")
      .notNull()
      .references(() => machineProfiles.id, { onDelete: "restrict" }),
    machineProfileSnapshot: jsonb("machine_profile_snapshot")
      .$type<{
        code: string;
        displayName: string;
        experienceDescription: string;
      }>()
      .notNull(),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "restrict",
    }),
    customerPersonaId: uuid("customer_persona_id").references(
      () => demoPersonas.id,
      { onDelete: "restrict" },
    ),
    createdByPersonaId: uuid("created_by_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "restrict" }),
    assignedToPersonaId: uuid("assigned_to_persona_id").references(
      () => demoPersonas.id,
      { onDelete: "restrict" },
    ),
    source: text("source").notNull(),
    description: text("description").notNull(),
    priority: text("priority").default("normal").notNull(),
    status: text("status").default("new").notNull(),
    createdBusinessAt: timestamp("created_business_at", {
      withTimezone: true,
    }).notNull(),
    assignedBusinessAt: timestamp("assigned_business_at", {
      withTimezone: true,
    }),
    processingBusinessAt: timestamp("processing_business_at", {
      withTimezone: true,
    }),
    resolutionNote: text("resolution_note"),
    resolutionSubmittedByPersonaId: uuid(
      "resolution_submitted_by_persona_id",
    ).references(() => demoPersonas.id, { onDelete: "restrict" }),
    resolutionBusinessAt: timestamp("resolution_business_at", {
      withTimezone: true,
    }),
    latestVerificationOutcome: text("latest_verification_outcome"),
    latestVerificationReason: text("latest_verification_reason"),
    verifiedByPersonaId: uuid("verified_by_persona_id").references(
      () => demoPersonas.id,
      { onDelete: "restrict" },
    ),
    verificationBusinessAt: timestamp("verification_business_at", {
      withTimezone: true,
    }),
    closedBusinessAt: timestamp("closed_business_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("repairs_source", sql`${table.source} IN ('customer', 'staff')`),
    check(
      "repairs_priority",
      sql`${table.priority} IN ('normal', 'high', 'urgent')`,
    ),
    check(
      "repairs_status",
      sql`${table.status} IN ('new', 'assigned', 'processing', 'verification', 'closed')`,
    ),
    check(
      "repairs_machine_profile_snapshot_shape",
      sql`jsonb_typeof(${table.machineProfileSnapshot}) = 'object' AND coalesce(${table.machineProfileSnapshot}->>'code', '') <> '' AND coalesce(${table.machineProfileSnapshot}->>'displayName', '') <> '' AND coalesce(${table.machineProfileSnapshot}->>'experienceDescription', '') <> ''`,
    ),
    check(
      "repairs_customer_source",
      sql`(${table.source} = 'customer' AND ${table.customerPersonaId} IS NOT NULL AND ${table.reservationId} IS NOT NULL) OR (${table.source} = 'staff' AND ${table.customerPersonaId} IS NULL)`,
    ),
    check(
      "repairs_assignment_state",
      sql`(${table.status} = 'new' AND ${table.assignedToPersonaId} IS NULL AND ${table.assignedBusinessAt} IS NULL) OR (${table.status} <> 'new' AND ${table.assignedToPersonaId} IS NOT NULL AND ${table.assignedBusinessAt} IS NOT NULL)`,
    ),
    check(
      "repairs_verification_outcome",
      sql`${table.latestVerificationOutcome} IN ('success', 'failure')`,
    ),
    check(
      "repairs_resolution_state",
      sql`${table.status} NOT IN ('verification', 'closed') OR (${table.resolutionNote} IS NOT NULL AND ${table.resolutionSubmittedByPersonaId} IS NOT NULL AND ${table.resolutionBusinessAt} IS NOT NULL)`,
    ),
    check(
      "repairs_closed_state",
      sql`${table.status} <> 'closed' OR (${table.latestVerificationOutcome} = 'success' AND ${table.verifiedByPersonaId} IS NOT NULL AND ${table.verificationBusinessAt} IS NOT NULL AND ${table.closedBusinessAt} IS NOT NULL)`,
    ),
    uniqueIndex("repairs_one_open_per_seat_unique")
      .on(table.sandboxId, table.seatId)
      .where(sql`${table.status} <> 'closed'`),
    pgPolicy("repairs_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const repairBusinessEvents = pgTable(
  "repair_business_events",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    repairId: uuid("repair_id")
      .notNull()
      .references(() => repairs.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventData: jsonb("event_data").notNull(),
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    pgPolicy("repair_business_events_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const repairCommandRequests = pgTable(
  "repair_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    actorPersonaId: uuid("actor_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    repairId: uuid("repair_id")
      .notNull()
      .references(() => repairs.id, { onDelete: "cascade" }),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.actorPersonaId,
        table.idempotencyKeyHash,
      ],
      name: "repair_command_requests_pk",
    }),
    pgPolicy("repair_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const repairStateCommandRequests = pgTable(
  "repair_state_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    actorPersonaId: uuid("actor_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    repairId: uuid("repair_id")
      .notNull()
      .references(() => repairs.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.actorPersonaId,
        table.commandType,
        table.idempotencyKeyHash,
      ],
      name: "repair_state_command_requests_pk",
    }),
    check(
      "repair_state_command_requests_type",
      sql`${table.commandType} IN ('assign', 'start', 'spare-claim', 'spare-return', 'submit-resolution', 'verify-success', 'verify-failure')`,
    ),
    pgPolicy("repair_state_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const repairUploadIntents = pgTable(
  "repair_upload_intents",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    repairId: uuid("repair_id")
      .notNull()
      .references(() => repairs.id, { onDelete: "cascade" }),
    actorPersonaId: uuid("actor_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    filenameExtension: text("filename_extension").notNull(),
    declaredContentType: text("declared_content_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    quarantineObjectKey: text("quarantine_object_key").notNull(),
    status: text("status").default("issued").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
  },
  (table) => [
    unique("repair_upload_intents_quarantine_key_unique").on(
      table.quarantineObjectKey,
    ),
    check(
      "repair_upload_intents_extension",
      sql`${table.filenameExtension} IN ('jpg', 'jpeg', 'png', 'webp')`,
    ),
    check(
      "repair_upload_intents_content_type",
      sql`${table.declaredContentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      "repair_upload_intents_size",
      sql`${table.declaredSize} > 0 AND ${table.declaredSize} <= 5242880`,
    ),
    check(
      "repair_upload_intents_status",
      sql`${table.status} IN ('issued', 'uploading', 'uploaded', 'consumed', 'failed')`,
    ),
    pgPolicy("repair_upload_intents_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const repairImages = pgTable(
  "repair_images",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    repairId: uuid("repair_id")
      .notNull()
      .references(() => repairs.id, { onDelete: "cascade" }),
    createdByPersonaId: uuid("created_by_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "restrict" }),
    source: text("source").notNull(),
    contentType: text("content_type").notNull(),
    objectKey: text("object_key"),
    sampleAssetId: text("sample_asset_id"),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("repair_images_object_key_unique").on(table.objectKey),
    check(
      "repair_images_source",
      sql`${table.source} IN ('uploaded', 'sample')`,
    ),
    check(
      "repair_images_storage_source",
      sql`(${table.source} = 'uploaded' AND ${table.objectKey} IS NOT NULL AND ${table.sampleAssetId} IS NULL) OR (${table.source} = 'sample' AND ${table.objectKey} IS NULL AND ${table.sampleAssetId} IS NOT NULL)`,
    ),
    check(
      "repair_images_content_type",
      sql`${table.contentType} IN ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check(
      "repair_images_dimensions",
      sql`${table.byteSize} > 0 AND ${table.byteSize} <= 5242880 AND ${table.width} > 0 AND ${table.width} <= 4096 AND ${table.height} > 0 AND ${table.height} <= 4096 AND (${table.width}::bigint * ${table.height}::bigint) <= 16000000`,
    ),
    pgPolicy("repair_images_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const repairImageCleanupJobs = pgTable(
  "repair_image_cleanup_jobs",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id").notNull(),
    targetKind: text("target_kind").notNull(),
    objectKey: text("object_key"),
    reason: text("reason").notNull(),
    status: text("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
    lastFailure: text("last_failure"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "repair_image_cleanup_jobs_target",
      sql`(${table.targetKind} = 'object' AND ${table.objectKey} IS NOT NULL) OR (${table.targetKind} = 'sandbox' AND ${table.objectKey} IS NULL)`,
    ),
    check(
      "repair_image_cleanup_jobs_status",
      sql`${table.status} IN ('pending', 'completed')`,
    ),
    index("repair_image_cleanup_jobs_due_idx").on(
      table.status,
      table.availableAt,
    ),
  ],
);

export const customerOrders = pgTable(
  "customer_orders",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    customerPersonaId: uuid("customer_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "restrict" }),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id, { onDelete: "restrict" }),
    status: text("status").notNull(),
    holdExpiresAt: timestamp("hold_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdBusinessAt: timestamp("created_business_at", {
      withTimezone: true,
    }).notNull(),
    orderSnapshot: jsonb("order_snapshot").notNull(),
    couponId: uuid("coupon_id").references(() => experienceCoupons.id, {
      onDelete: "restrict",
    }),
    couponSnapshot: jsonb("coupon_snapshot"),
    simulatedPaymentCents: integer("simulated_payment_cents"),
    paidBusinessAt: timestamp("paid_business_at", { withTimezone: true }),
    preparingBusinessAt: timestamp("preparing_business_at", {
      withTimezone: true,
    }),
    readyBusinessAt: timestamp("ready_business_at", { withTimezone: true }),
    completedBusinessAt: timestamp("completed_business_at", {
      withTimezone: true,
    }),
    cancelledBusinessAt: timestamp("cancelled_business_at", {
      withTimezone: true,
    }),
    expiredBusinessAt: timestamp("expired_business_at", { withTimezone: true }),
    terminalReason: text("terminal_reason"),
  },
  (table) => [
    check(
      "customer_orders_status",
      sql`${table.status} IN ('pending-simulated-payment', 'simulated-paid', 'preparing', 'ready-for-pickup', 'completed', 'cancelled', 'expired')`,
    ),
    check(
      "customer_orders_non_negative_payment",
      sql`${table.simulatedPaymentCents} IS NULL OR ${table.simulatedPaymentCents} >= 0`,
    ),
    check(
      "customer_orders_hold_after_creation",
      sql`${table.holdExpiresAt} > ${table.createdBusinessAt}`,
    ),
    pgPolicy("customer_orders_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const orderInventoryReservations = pgTable(
  "order_inventory_reservations",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    status: text("status").notNull(),
    releasedBusinessAt: timestamp("released_business_at", {
      withTimezone: true,
    }),
  },
  (table) => [
    unique("order_inventory_reservations_order_item_unique").on(
      table.sandboxId,
      table.orderId,
      table.inventoryItemId,
    ),
    check(
      "order_inventory_reservations_positive_quantity",
      sql`${table.quantity} > 0`,
    ),
    check(
      "order_inventory_reservations_status",
      sql`${table.status} IN ('active', 'released', 'sold', 'wasted')`,
    ),
    pgPolicy("order_inventory_reservations_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "restrict" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    orderId: uuid("order_id").references(() => customerOrders.id, {
      onDelete: "restrict",
    }),
    repairId: uuid("repair_id").references(() => repairs.id, {
      onDelete: "restrict",
    }),
    movementKind: text("movement_kind"),
    compensatesMovementId: uuid("compensates_movement_id"),
    reason: text("reason").notNull(),
    onHandDelta: integer("on_hand_delta").notNull(),
    onHandAfter: integer("on_hand_after").notNull(),
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "inventory_movements_non_negative_after",
      sql`${table.onHandAfter} >= 0`,
    ),
    check("inventory_movements_non_zero_delta", sql`${table.onHandDelta} <> 0`),
    check(
      "inventory_movements_kind",
      sql`${table.movementKind} IN ('receipt', 'stocktake', 'compensation', 'sale', 'waste', 'spare-usage', 'spare-return')`,
    ),
    foreignKey({
      columns: [table.compensatesMovementId],
      foreignColumns: [table.id],
      name: "inventory_movements_compensates_movement_id_fk",
    }).onDelete("restrict"),
    pgPolicy("inventory_movements_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const repairSpareUsages = pgTable(
  "repair_spare_usages",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    repairId: uuid("repair_id")
      .notNull()
      .references(() => repairs.id, { onDelete: "restrict" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    claimedByPersonaId: uuid("claimed_by_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "restrict" }),
    inventoryMovementId: uuid("inventory_movement_id")
      .notNull()
      .references(() => inventoryMovements.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    returnedQuantity: integer("returned_quantity").default(0).notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("repair_spare_usages_movement_unique").on(table.inventoryMovementId),
    check("repair_spare_usages_quantity", sql`${table.quantity} > 0`),
    check(
      "repair_spare_usages_returned_quantity",
      sql`${table.returnedQuantity} >= 0 AND ${table.returnedQuantity} <= ${table.quantity}`,
    ),
    pgPolicy("repair_spare_usages_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const repairSpareReturns = pgTable(
  "repair_spare_returns",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    repairId: uuid("repair_id")
      .notNull()
      .references(() => repairs.id, { onDelete: "restrict" }),
    usageId: uuid("usage_id")
      .notNull()
      .references(() => repairSpareUsages.id, { onDelete: "restrict" }),
    returnedByPersonaId: uuid("returned_by_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "restrict" }),
    inventoryMovementId: uuid("inventory_movement_id")
      .notNull()
      .references(() => inventoryMovements.id, { onDelete: "restrict" }),
    quantity: integer("quantity").notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("repair_spare_returns_movement_unique").on(
      table.inventoryMovementId,
    ),
    check("repair_spare_returns_quantity", sql`${table.quantity} > 0`),
    pgPolicy("repair_spare_returns_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const inventoryCommandRequests = pgTable(
  "inventory_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    actorPersonaId: uuid("actor_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id")
      .notNull()
      .references(() => inventoryItems.id, { onDelete: "restrict" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.actorPersonaId,
        table.idempotencyKeyHash,
      ],
      name: "inventory_command_requests_pk",
    }),
    check(
      "inventory_command_requests_type",
      sql`${table.commandType} IN ('receipt', 'stocktake', 'compensation')`,
    ),
    pgPolicy("inventory_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const orderBusinessEvents = pgTable(
  "order_business_events",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventData: jsonb("event_data").notNull(),
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    pgPolicy("order_business_events_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const orderCommandRequests = pgTable(
  "order_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    customerPersonaId: uuid("customer_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.customerPersonaId,
        table.idempotencyKeyHash,
      ],
      name: "order_command_requests_pk",
    }),
    pgPolicy("order_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const orderLifecycleCommandRequests = pgTable(
  "order_lifecycle_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    customerPersonaId: uuid("customer_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.customerPersonaId,
        table.commandType,
        table.idempotencyKeyHash,
      ],
      name: "order_lifecycle_command_requests_pk",
    }),
    check(
      "order_lifecycle_command_requests_type",
      sql`${table.commandType} IN ('simulate-payment', 'cancel')`,
    ),
    pgPolicy("order_lifecycle_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const orderFrontlineCommandRequests = pgTable(
  "order_frontline_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    actorPersonaId: uuid("actor_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.actorPersonaId,
        table.idempotencyKeyHash,
      ],
      name: "order_frontline_command_requests_pk",
    }),
    check(
      "order_frontline_command_requests_type",
      sql`${table.commandType} IN ('start-preparing', 'mark-ready', 'complete', 'cancel')`,
    ),
    pgPolicy("order_frontline_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const orderSimulatedRefunds = pgTable(
  "order_simulated_refunds",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => customerOrders.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("order_simulated_refunds_order_unique").on(
      table.sandboxId,
      table.orderId,
    ),
    check(
      "order_simulated_refunds_non_negative_amount",
      sql`${table.amountCents} >= 0`,
    ),
    pgPolicy("order_simulated_refunds_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const reservationSimulatedRefunds = pgTable(
  "reservation_simulated_refunds",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    amountCents: integer("amount_cents").notNull(),
    reason: text("reason").notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("reservation_simulated_refunds_reservation_unique").on(
      table.sandboxId,
      table.reservationId,
    ),
    check(
      "reservation_simulated_refunds_non_negative_amount",
      sql`${table.amountCents} >= 0`,
    ),
    pgPolicy("reservation_simulated_refunds_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const memberGrowthEvents = pgTable(
  "member_growth_events",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    memberProfileId: uuid("member_profile_id")
      .notNull()
      .references(() => memberProfiles.id, { onDelete: "cascade" }),
    customerPersonaId: uuid("customer_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    sourceKind: text("source_kind").notNull(),
    sourceId: uuid("source_id"),
    finalSimulatedAmountCents: integer(
      "final_simulated_amount_cents",
    ).notNull(),
    growthPoints: integer("growth_points").notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("member_growth_events_business_source_unique")
      .on(
        table.sandboxId,
        table.customerPersonaId,
        table.sourceKind,
        table.sourceId,
      )
      .where(sql`${table.sourceId} IS NOT NULL`),
    uniqueIndex("member_growth_events_seed_baseline_unique")
      .on(table.sandboxId, table.customerPersonaId, table.sourceKind)
      .where(sql`${table.sourceKind} = 'seed-baseline'`),
    check(
      "member_growth_events_source_kind",
      sql`${table.sourceKind} IN ('seed-baseline', 'reservation', 'order')`,
    ),
    check(
      "member_growth_events_source_reference",
      sql`(${table.sourceKind} = 'seed-baseline' AND ${table.sourceId} IS NULL) OR (${table.sourceKind} <> 'seed-baseline' AND ${table.sourceId} IS NOT NULL)`,
    ),
    check(
      "member_growth_events_non_negative_amounts",
      sql`${table.finalSimulatedAmountCents} >= 0 AND ${table.growthPoints} >= 0`,
    ),
    pgPolicy("member_growth_events_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const reservationLifecycleCommandRequests = pgTable(
  "reservation_lifecycle_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    customerPersonaId: uuid("customer_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.customerPersonaId,
        table.commandType,
        table.idempotencyKeyHash,
      ],
      name: "reservation_lifecycle_command_requests_pk",
    }),
    check(
      "reservation_lifecycle_command_requests_type",
      sql`${table.commandType} IN ('simulate-payment', 'cancel')`,
    ),
    pgPolicy("reservation_lifecycle_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const reservationFrontlineCommandRequests = pgTable(
  "reservation_frontline_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    actorPersonaId: uuid("actor_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    commandType: text("command_type").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    resultData: jsonb("result_data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.actorPersonaId,
        table.commandType,
        table.idempotencyKeyHash,
      ],
      name: "reservation_frontline_command_requests_pk",
    }),
    check(
      "reservation_frontline_command_requests_type",
      sql`${table.commandType} IN ('arrive', 'start-use', 'complete-early', 'cancel')`,
    ),
    pgPolicy("reservation_frontline_command_requests_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const reservationBusinessEvents = pgTable(
  "reservation_business_events",
  {
    id: uuid("id").primaryKey(),
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    eventData: jsonb("event_data").notNull(),
    sequence: bigserial("sequence", { mode: "number" }).notNull(),
    businessOccurredAt: timestamp("business_occurred_at", {
      withTimezone: true,
    }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    pgPolicy("reservation_business_events_isolate_by_sandbox", {
      using: sql`${table.sandboxId} = ${sandboxSetting}`,
      withCheck: sql`${table.sandboxId} = ${sandboxSetting}`,
    }),
  ],
).enableRLS();

export const reservationCommandRequests = pgTable(
  "reservation_command_requests",
  {
    sandboxId: uuid("sandbox_id")
      .notNull()
      .references(() => sandboxes.id, { onDelete: "cascade" }),
    customerPersonaId: uuid("customer_persona_id")
      .notNull()
      .references(() => demoPersonas.id, { onDelete: "cascade" }),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.sandboxId,
        table.customerPersonaId,
        table.idempotencyKeyHash,
      ],
      name: "reservation_command_requests_pk",
    }),
    pgPolicy("reservation_command_requests_isolate_by_sandbox", {
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
    }).notNull(),
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
    index("audit_events_store_business_idx").on(
      table.sandboxId,
      table.storeId,
      table.businessOccurredAt,
      table.id,
    ),
    index("audit_events_store_recorded_idx").on(
      table.sandboxId,
      table.storeId,
      table.recordedAt,
      table.id,
    ),
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

export const sandboxLifecycleTasks = pgTable(
  "sandbox_lifecycle_tasks",
  {
    sandboxId: uuid("sandbox_id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    state: text("state").default("active").notNull(),
    cleanupReason: text("cleanup_reason"),
    cleanupPhase: text("cleanup_phase"),
    cleanupStartedAt: timestamp("cleanup_started_at", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    availableAt: timestamp("available_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastFailure: text("last_failure"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "sandbox_lifecycle_tasks_state",
      sql`${table.state} IN ('active', 'pending', 'retry')`,
    ),
    check(
      "sandbox_lifecycle_tasks_cleanup_reason",
      sql`${table.cleanupReason} IS NULL OR ${table.cleanupReason} IN ('expired', 'reset')`,
    ),
    check(
      "sandbox_lifecycle_tasks_cleanup_phase",
      sql`${table.cleanupPhase} IS NULL OR ${table.cleanupPhase} IN ('blobs', 'business')`,
    ),
    check(
      "sandbox_lifecycle_tasks_cleanup_shape",
      sql`(${table.state} = 'active' AND ${table.cleanupReason} IS NULL AND ${table.cleanupPhase} IS NULL) OR (${table.state} IN ('pending', 'retry') AND ${table.cleanupReason} IS NOT NULL AND ${table.cleanupPhase} IS NOT NULL)`,
    ),
    index("sandbox_lifecycle_tasks_due_idx").on(table.state, table.availableAt),
  ],
);

export const sandboxRequestRateLimits = pgTable(
  "sandbox_request_rate_limits",
  {
    operation: text("operation").notNull(),
    subjectKind: text("subject_kind").notNull(),
    windowKind: text("window_kind").notNull(),
    subjectHash: text("subject_hash").notNull(),
    windowStartedAt: timestamp("window_started_at", {
      withTimezone: true,
    }).notNull(),
    requestCount: integer("request_count").default(0).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.operation,
        table.subjectKind,
        table.windowKind,
        table.subjectHash,
        table.windowStartedAt,
      ],
      name: "sandbox_request_rate_limits_pk",
    }),
    check(
      "sandbox_request_rate_limits_operation",
      sql`${table.operation} IN ('create', 'reset')`,
    ),
    check(
      "sandbox_request_rate_limits_subject_kind",
      sql`${table.subjectKind} IN ('visitor', 'ip')`,
    ),
    check(
      "sandbox_request_rate_limits_window_kind",
      sql`${table.windowKind} IN ('hour', 'day')`,
    ),
    check(
      "sandbox_request_rate_limits_positive_count",
      sql`${table.requestCount} > 0`,
    ),
  ],
);

export const sandboxDeletionReceipts = pgTable(
  "sandbox_deletion_receipts",
  {
    id: uuid("id").primaryKey(),
    reason: text("reason").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull(),
    attempts: integer("attempts").default(0).notNull(),
  },
  (table) => [
    check(
      "sandbox_deletion_receipts_reason",
      sql`${table.reason} IN ('expired', 'reset')`,
    ),
    check(
      "sandbox_deletion_receipts_non_negative_attempts",
      sql`${table.attempts} >= 0`,
    ),
  ],
);
