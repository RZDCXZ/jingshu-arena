import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigserial,
  boolean,
  check,
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
  },
  (table) => [
    unique("products_sandbox_code_unique").on(table.sandboxId, table.code),
    check(
      "products_category",
      sql`${table.category} IN ('drink', 'snack', 'meal', 'supply')`,
    ),
    pgPolicy("products_isolate_by_sandbox", {
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
  },
  (table) => [
    unique("machine_profiles_sandbox_code_unique").on(
      table.sandboxId,
      table.code,
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
  },
  (table) => [
    unique("store_areas_sandbox_store_code_unique").on(
      table.sandboxId,
      table.storeId,
      table.code,
    ),
    check("store_areas_positive_sort_order", sql`${table.sortOrder} >= 0`),
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
    pgPolicy("seats_isolate_by_sandbox", {
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
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
    }).notNull(),
    effectiveUntil: timestamp("effective_until", { withTimezone: true }),
    status: text("status").default("active").notNull(),
  },
  (table) => [
    unique("price_plans_scope_version_unique").on(
      table.sandboxId,
      table.storeId,
      table.areaId,
      table.machineProfileId,
      table.version,
    ),
    check("price_plans_positive_version", sql`${table.version} > 0`),
    check(
      "price_plans_non_negative_base_price",
      sql`${table.baseHourlyCents} >= 0`,
    ),
    check(
      "price_plans_effective_range",
      sql`${table.effectiveUntil} IS NULL OR ${table.effectiveUntil} > ${table.effectiveFrom}`,
    ),
    check("price_plans_status", sql`${table.status} IN ('active', 'archived')`),
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
    cancelledBusinessAt: timestamp("cancelled_business_at", {
      withTimezone: true,
    }),
    expiredBusinessAt: timestamp("expired_business_at", { withTimezone: true }),
    terminalReason: text("terminal_reason"),
  },
  (table) => [
    check(
      "customer_orders_status",
      sql`${table.status} IN ('pending-simulated-payment', 'simulated-paid', 'cancelled', 'expired')`,
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
      sql`${table.status} IN ('active', 'released')`,
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
    reason: text("reason").notNull(),
    onHandDelta: integer("on_hand_delta").notNull(),
    onHandAfter: integer("on_hand_after").notNull(),
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
    pgPolicy("inventory_movements_isolate_by_sandbox", {
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
