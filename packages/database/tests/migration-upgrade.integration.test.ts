import { readFile } from "node:fs/promises";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const client = new Client({ connectionString: databaseUrl });

async function applyMigration(filename: string) {
  const sql = await readFile(
    new URL(`../drizzle/${filename}`, import.meta.url),
    "utf8",
  );
  for (const statement of sql
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    await client.query(statement);
  }
}

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe("role-context expand migration", () => {
  it("backfills FORCE-RLS data as a non-bypass owner and keeps the old writer compatible", async () => {
    for (const filename of [
      "0000_workspace_bootstrap.sql",
      "0001_public_sandbox.sql",
      "0002_sandbox_creation_idempotency.sql",
      "0003_sandbox_rls.sql",
      "0004_creation_request_rls.sql",
      "0005_creation_request_visitor.sql",
    ]) {
      await applyMigration(filename);
    }

    const legacySandboxId = "00000000-0000-4000-8000-000000000601";
    const legacyCreationHash = "legacy-creation-hash-000000000601";
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      legacySandboxId,
    ]);
    await client.query("select set_config('app.creation_key_hash', $1, true)", [
      legacyCreationHash,
    ]);
    await client.query(
      `insert into sandbox_creation_requests (
         creation_key_hash, visitor_key_hash, payload_hash, sandbox_id, selected_role
       ) values ($1, 'legacy-visitor', 'legacy-payload', $2, 'staff')`,
      [legacyCreationHash, legacySandboxId],
    );
    await client.query(
      `insert into sandboxes (id, schema_version, seed_version, expires_at)
       values ($1, '2', 'legacy-seed', now() + interval '24 hours')`,
      [legacySandboxId],
    );
    await client.query("commit");

    await client.query(`
      do $$
      begin
        if not exists (
          select 1 from pg_roles where rolname = 'ticket04_migration_owner'
        ) then
          create role ticket04_migration_owner nologin;
        end if;
      end
      $$
    `);
    await client.query("grant ticket04_migration_owner to current_user");
    await client.query(
      "grant usage, create on schema public to ticket04_migration_owner",
    );
    await client.query(
      "grant references on stores, demo_personas to ticket04_migration_owner",
    );
    await client.query(
      "alter table sandboxes owner to ticket04_migration_owner",
    );
    await client.query(
      "alter table sandbox_creation_requests owner to ticket04_migration_owner",
    );
    await client.query(
      "alter table jingshu_schema_metadata owner to ticket04_migration_owner",
    );

    await client.query("set role ticket04_migration_owner");
    try {
      await applyMigration("0006_role_context.sql");
    } finally {
      await client.query("reset role");
    }

    const backfilled = await client.query<{
      role_context_role: string | null;
      role_context_version: number;
    }>(
      `select role_context_role, role_context_version
         from sandboxes where id = $1`,
      [legacySandboxId],
    );
    expect(backfilled.rows).toEqual([
      { role_context_role: "staff", role_context_version: 1 },
    ]);

    const rls = await client.query<{
      relforcerowsecurity: boolean;
      relname: string;
    }>(
      `select relname, relforcerowsecurity
         from pg_class
        where relname in ('sandboxes', 'sandbox_creation_requests')
        order by relname`,
    );
    expect(rls.rows).toEqual([
      { relforcerowsecurity: true, relname: "sandbox_creation_requests" },
      { relforcerowsecurity: true, relname: "sandboxes" },
    ]);

    const rollingSandboxId = "00000000-0000-4000-8000-000000000602";
    const rollingCreationHash = "rolling-creation-hash-000000000602";
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      rollingSandboxId,
    ]);
    await client.query("select set_config('app.creation_key_hash', $1, true)", [
      rollingCreationHash,
    ]);
    await client.query(
      `insert into sandbox_creation_requests (
         creation_key_hash, visitor_key_hash, payload_hash, sandbox_id, selected_role
       ) values ($1, 'rolling-visitor', 'rolling-payload', $2, 'manager')`,
      [rollingCreationHash, rollingSandboxId],
    );
    await client.query(
      `insert into sandboxes (id, schema_version, seed_version, expires_at)
       values ($1, '2', 'rolling-seed', now() + interval '24 hours')`,
      [rollingSandboxId],
    );
    await client.query("commit");

    const rolling = await client.query<{ role_context_role: string | null }>(
      "select role_context_role from sandboxes where id = $1",
      [rollingSandboxId],
    );
    expect(rolling.rows).toEqual([{ role_context_role: null }]);
  });

  it("adds dual-clock and reset structures with safe defaults for rolling writers", async () => {
    await applyMigration("0007_dual_clock_reset.sql");

    const rolling = await client.query<{
      business_time_advance_ms: number;
      business_time_anchor_at: Date;
      business_time_anchor_wall_at: Date;
      created_at: Date;
      expires_at: Date;
      invalidated_at: Date | null;
    }>(
      `select business_time_advance_ms, business_time_anchor_at,
              business_time_anchor_wall_at, created_at, expires_at,
              invalidated_at
         from sandboxes
        where id = '00000000-0000-4000-8000-000000000602'`,
    );
    expect(rolling.rows).toEqual([
      {
        business_time_advance_ms: 0,
        business_time_anchor_at: expect.any(Date),
        business_time_anchor_wall_at: expect.any(Date),
        created_at: expect.any(Date),
        expires_at: expect.any(Date),
        invalidated_at: null,
      },
    ]);
    expect(rolling.rows[0]?.business_time_anchor_at).toEqual(
      rolling.rows[0]?.created_at,
    );
    expect(rolling.rows[0]?.business_time_anchor_wall_at).toEqual(
      rolling.rows[0]?.created_at,
    );

    const rollingSandboxId = "00000000-0000-4000-8000-000000000603";
    const rollingCreationHash = "rolling-creation-hash-000000000603";
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      rollingSandboxId,
    ]);
    await client.query("select set_config('app.creation_key_hash', $1, true)", [
      rollingCreationHash,
    ]);
    await client.query(
      `insert into sandbox_creation_requests (
         creation_key_hash, visitor_key_hash, payload_hash, sandbox_id, selected_role
       ) values ($1, 'rolling-visitor-603', 'rolling-payload-603', $2, 'customer')`,
      [rollingCreationHash, rollingSandboxId],
    );
    await client.query(
      `insert into sandboxes (id, schema_version, seed_version, expires_at)
       values ($1, '3', 'rolling-seed', now() + interval '24 hours')`,
      [rollingSandboxId],
    );
    await client.query("commit");

    const defaults = await client.query<{
      business_time_advance_ms: number;
      role_context_role: string | null;
    }>(
      `select business_time_advance_ms, role_context_role
         from sandboxes where id = $1`,
      [rollingSandboxId],
    );
    expect(defaults.rows).toEqual([
      { business_time_advance_ms: 0, role_context_role: null },
    ]);

    await applyMigration("0008_customer_seat_browse.sql");
    await applyMigration("0009_reservation_hold_snapshot.sql");
    await applyMigration("0010_reservation_payment_lifecycle.sql");
    await applyMigration("0011_staff_reservation_operations.sql");
    await applyMigration("0012_membership_journey.sql");

    const metadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(metadata.rows).toEqual([{ value: "9" }]);

    await applyMigration("0013_customer_order_inventory.sql");

    const customerOrderMetadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(customerOrderMetadata.rows).toEqual([{ value: "10" }]);

    await applyMigration("0014_staff_order_fulfillment.sql");
    await applyMigration("0015_manager_inventory.sql");

    const inventoryMetadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(inventoryMetadata.rows).toEqual([{ value: "12" }]);
    const inventoryStructures = await client.query<{
      command_table: string | null;
      movement_kind: string | null;
    }>(
      `select
        to_regclass('public.inventory_command_requests')::text as command_table,
        (select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'inventory_movements'
            and column_name = 'movement_kind') as movement_kind`,
    );
    expect(inventoryStructures.rows).toEqual([
      {
        command_table: "inventory_command_requests",
        movement_kind: "movement_kind",
      },
    ]);

    const rollingOperatorId = "00000000-0000-4000-8000-000000000613";
    const rollingStoreId = "00000000-0000-4000-8000-000000000614";
    const rollingStaffPersonaId = "00000000-0000-4000-8000-000000000617";
    const rollingInventoryItemId = "00000000-0000-4000-8000-000000000615";
    const rollingMovementId = "00000000-0000-4000-8000-000000000616";
    await client.query("begin");
    await client.query("set local role jingshu_runtime");
    await client.query("select set_config('app.sandbox_id', $1, true)", [
      rollingSandboxId,
    ]);
    await client.query(
      `insert into operators (id, sandbox_id, display_name, city)
       values ($1, $2, '滚动部署经营方', '栖光市')`,
      [rollingOperatorId, rollingSandboxId],
    );
    await client.query(
      `insert into stores (
         id, sandbox_id, operator_id, code, display_name, seat_count,
         opens_at, closes_at, is_open_24_hours
       ) values ($1, $2, $3, 'rolling-store', '滚动部署门店', 1,
         '00:00', '00:00', true)`,
      [rollingStoreId, rollingSandboxId, rollingOperatorId],
    );
    await client.query(
      `insert into demo_personas (
         id, sandbox_id, store_id, role, display_name, scope, protected
       ) values ($1, $2, $3, 'staff', '滚动部署店员', 'rolling-store', true)`,
      [rollingStaffPersonaId, rollingSandboxId, rollingStoreId],
    );
    await client.query(
      `insert into inventory_items (
         id, sandbox_id, store_id, kind, code, display_name,
         on_hand_quantity, reserved_quantity, low_stock_threshold
       ) values ($1, $2, $3, 'spare', 'rolling-spare', '滚动部署备件', 1, 0, 0)`,
      [rollingInventoryItemId, rollingSandboxId, rollingStoreId],
    );
    await client.query(
      `insert into inventory_movements (
         id, sandbox_id, store_id, inventory_item_id, order_id, reason,
         on_hand_delta, on_hand_after, business_occurred_at, recorded_at
       ) values ($1, $2, $3, $4, null, 'legacy-writer', 1, 1, now(), now())`,
      [
        rollingMovementId,
        rollingSandboxId,
        rollingStoreId,
        rollingInventoryItemId,
      ],
    );
    await client.query("commit");
    const rollingMovement = await client.query<{
      movement_kind: string | null;
    }>("select movement_kind from inventory_movements where id = $1", [
      rollingMovementId,
    ]);
    expect(rollingMovement.rows).toEqual([{ movement_kind: null }]);

    await applyMigration("0016_repair_intake_private_images.sql");
    const repairMetadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(repairMetadata.rows).toEqual([{ value: "13" }]);
    const repairStructures = await client.query<{
      force_rls: boolean;
      image_table: string | null;
      intent_table: string | null;
      repair_table: string | null;
    }>(
      `select
         to_regclass('public.repairs')::text as repair_table,
         to_regclass('public.repair_upload_intents')::text as intent_table,
         to_regclass('public.repair_images')::text as image_table,
         (select relforcerowsecurity from pg_class
           where oid = 'public.repair_images'::regclass) as force_rls`,
    );
    expect(repairStructures.rows).toEqual([
      {
        force_rls: true,
        image_table: "repair_images",
        intent_table: "repair_upload_intents",
        repair_table: "repairs",
      },
    ]);

    await applyMigration("0017_repair_maintenance_refund.sql");
    const maintenanceMetadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(maintenanceMetadata.rows).toEqual([{ value: "14" }]);
    const maintenanceStructures = await client.query<{
      assigned_column: string | null;
      command_table: string | null;
      force_rls: boolean;
      processing_column: string | null;
    }>(
      `select
         to_regclass('public.repair_state_command_requests')::text as command_table,
         (select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'repairs'
             and column_name = 'assigned_to_persona_id') as assigned_column,
         (select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'repairs'
             and column_name = 'processing_business_at') as processing_column,
         (select relforcerowsecurity from pg_class
           where oid = 'public.repair_state_command_requests'::regclass) as force_rls`,
    );
    expect(maintenanceStructures.rows).toEqual([
      {
        assigned_column: "assigned_to_persona_id",
        command_table: "repair_state_command_requests",
        force_rls: true,
        processing_column: "processing_business_at",
      },
    ]);

    await applyMigration("0018_repair_spares_verification.sql");
    const verificationMetadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(verificationMetadata.rows).toEqual([{ value: "15" }]);
    const verificationStructures = await client.query<{
      movement_repair_column: string | null;
      resolution_column: string | null;
      return_table: string | null;
      usage_force_rls: boolean;
      usage_table: string | null;
    }>(
      `select
         to_regclass('public.repair_spare_usages')::text as usage_table,
         to_regclass('public.repair_spare_returns')::text as return_table,
         (select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'repairs'
             and column_name = 'resolution_note') as resolution_column,
         (select column_name from information_schema.columns
           where table_schema = 'public' and table_name = 'inventory_movements'
             and column_name = 'repair_id') as movement_repair_column,
         (select relforcerowsecurity from pg_class
           where oid = 'public.repair_spare_usages'::regclass) as usage_force_rls`,
    );
    expect(verificationStructures.rows).toEqual([
      {
        movement_repair_column: "repair_id",
        resolution_column: "resolution_note",
        return_table: "repair_spare_returns",
        usage_force_rls: true,
        usage_table: "repair_spare_usages",
      },
    ]);

    await client.query(
      "alter table demo_personas owner to ticket04_migration_owner",
    );
    await client.query("alter table stores owner to ticket04_migration_owner");
    await client.query(
      "alter table store_areas owner to ticket04_migration_owner",
    );
    await client.query("alter table seats owner to ticket04_migration_owner");
    await client.query("set role ticket04_migration_owner");
    try {
      await applyMigration("0019_staff_shift_attendance.sql");
    } finally {
      await client.query("reset role");
    }
    const attendanceMetadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(attendanceMetadata.rows).toEqual([{ value: "16" }]);
    const attendanceStructures = await client.query<{
      attendance_table: string | null;
      employee_force_rls: boolean;
      employee_table: string | null;
      open_attendance_index: string | null;
      persona_force_rls: boolean;
      shift_table: string | null;
    }>(
      `select
         to_regclass('public.employees')::text as employee_table,
         to_regclass('public.shifts')::text as shift_table,
         to_regclass('public.attendance_records')::text as attendance_table,
         to_regclass('public.attendance_records_one_open_per_employee')::text as open_attendance_index,
         (select relforcerowsecurity from pg_class
           where oid = 'public.demo_personas'::regclass) as persona_force_rls,
         (select relforcerowsecurity from pg_class
           where oid = 'public.employees'::regclass) as employee_force_rls`,
    );
    expect(attendanceStructures.rows).toEqual([
      {
        attendance_table: "attendance_records",
        employee_force_rls: true,
        employee_table: "employees",
        open_attendance_index: "attendance_records_one_open_per_employee",
        persona_force_rls: true,
        shift_table: "shifts",
      },
    ]);
    const backfilledEmployee = await client.query<{
      display_name: string;
      employee_code: string;
      persona_id: string;
      role: string;
      store_id: string;
    }>(
      `select display_name, employee_code, persona_id, role, store_id
         from employees where sandbox_id = $1 and persona_id = $2`,
      [rollingSandboxId, rollingStaffPersonaId],
    );
    expect(backfilledEmployee.rows).toEqual([
      {
        display_name: "滚动部署店员",
        employee_code: "LEGACY-S-00000000",
        persona_id: rollingStaffPersonaId,
        role: "staff",
        store_id: rollingStoreId,
      },
    ]);

    await client.query("set role ticket04_migration_owner");
    try {
      await applyMigration("0020_staff_handover.sql");
    } finally {
      await client.query("reset role");
    }
    const handoverMetadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(handoverMetadata.rows).toEqual([{ value: "17" }]);
    const handoverStructures = await client.query<{
      confirmation_force_rls: boolean;
      confirmation_table: string | null;
      exception_table: string | null;
      handover_force_rls: boolean;
      handover_table: string | null;
    }>(
      `select
         to_regclass('public.handovers')::text as handover_table,
         to_regclass('public.handover_confirmations')::text as confirmation_table,
         to_regclass('public.handover_exceptions')::text as exception_table,
         (select relforcerowsecurity from pg_class
           where oid = 'public.handovers'::regclass) as handover_force_rls,
         (select relforcerowsecurity from pg_class
           where oid = 'public.handover_confirmations'::regclass) as confirmation_force_rls`,
    );
    expect(handoverStructures.rows).toEqual([
      {
        confirmation_force_rls: true,
        confirmation_table: "handover_confirmations",
        exception_table: "handover_exceptions",
        handover_force_rls: true,
        handover_table: "handovers",
      },
    ]);

    await client.query("set role ticket04_migration_owner");
    try {
      await applyMigration("0021_manager_store_configuration.sql");
    } finally {
      await client.query("reset role");
    }
    const configurationMetadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(configurationMetadata.rows).toEqual([{ value: "18" }]);
    const configurationStructures = await client.query<{
      command_force_rls: boolean;
      command_table: string | null;
      hours_force_rls: boolean;
      hours_table: string | null;
    }>(
      `select
         to_regclass('public.store_business_hours_versions')::text as hours_table,
         to_regclass('public.store_config_command_requests')::text as command_table,
         (select relforcerowsecurity from pg_class
           where oid = 'public.store_business_hours_versions'::regclass) as hours_force_rls,
         (select relforcerowsecurity from pg_class
           where oid = 'public.store_config_command_requests'::regclass) as command_force_rls`,
    );
    expect(configurationStructures.rows).toEqual([
      {
        command_force_rls: true,
        command_table: "store_config_command_requests",
        hours_force_rls: true,
        hours_table: "store_business_hours_versions",
      },
    ]);
    const backfilledConfiguration = await client.query<{
      config_version: number;
      fictitious_city: string;
      introduction: string;
    }>(
      `select config_version, fictitious_city, introduction
         from stores where id = $1`,
      [rollingStoreId],
    );
    expect(backfilledConfiguration.rows).toEqual([
      {
        config_version: 1,
        fictitious_city: "栖光市（虚构）",
        introduction: "竞枢固定虚构演示门店。",
      },
    ]);
    await client.query(
      "alter table price_plans owner to ticket04_migration_owner",
    );
    await client.query(
      "alter table store_products owner to ticket04_migration_owner",
    );
    await client.query(
      "alter table inventory_items owner to ticket04_migration_owner",
    );
    await client.query("set role ticket04_migration_owner");
    try {
      await applyMigration("0022_manager_price_store_product.sql");
    } finally {
      await client.query("reset role");
    }
    const pricingMetadata = await client.query<{ value: string }>(
      "select value from jingshu_schema_metadata where key = 'schema_version'",
    );
    expect(pricingMetadata.rows).toEqual([{ value: "19" }]);
    const pricingDefaults = await client.query<{
      column_name: string;
      default_expression: string;
    }>(
      `select attribute.attname as column_name,
              pg_get_expr(definition.adbin, definition.adrelid) as default_expression
         from pg_attribute attribute
         join pg_attrdef definition
           on definition.adrelid = attribute.attrelid
          and definition.adnum = attribute.attnum
        where attribute.attrelid = 'price_plans'::regclass
          and attribute.attname in (
            'config_version', 'pricing_model',
            'weekday_half_hour_cents', 'weekend_half_hour_cents'
          )
        order by attribute.attname`,
    );
    expect(pricingDefaults.rows).toEqual([
      { column_name: "config_version", default_expression: "1" },
      {
        column_name: "pricing_model",
        default_expression: "'legacy'::text",
      },
      { column_name: "weekday_half_hour_cents", default_expression: "0" },
      { column_name: "weekend_half_hour_cents", default_expression: "0" },
    ]);
  });
});
