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
});
