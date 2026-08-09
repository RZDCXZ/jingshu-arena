import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

import {
  createPublicSandboxDatabase,
  migrateEmptyDatabase,
} from "../src/index.js";
import type { PublicSandboxIdempotencyConflictError } from "../src/index.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const database = createPublicSandboxDatabase(databaseUrl);
const { Client } = pg;

beforeAll(async () => {
  await migrateEmptyDatabase(databaseUrl);
});

afterAll(async () => {
  await database.close();
});

describe("public sandbox creation", () => {
  it("materializes the fixed three-store world with schema and seed versions", async () => {
    const result = await database.create({
      creationKey: "00000000-0000-4000-8000-000000000003",
      selectedRole: "customer",
      visitorKey: "visitor-000000000003",
    });

    expect(result).toEqual({
      replayed: false,
      sandboxId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      ),
      schemaVersion: "2",
      seedVersion: "2026-08-09.1",
      expiresAt: expect.any(Date),
      selectedRole: "customer",
      persona: {
        displayName: "林澈",
        protected: true,
        scope: "浏览三店 · 只管理自己的记录",
      },
      operator: {
        displayName: "竞枢演示经营方",
        city: "栖光市",
      },
      stores: [
        {
          code: "prism-flagship",
          displayName: "棱镜旗舰店",
          seatCount: 96,
          businessHours: "24 小时",
        },
        {
          code: "starbridge-standard",
          displayName: "星桥标准店",
          seatCount: 64,
          businessHours: "10:00–次日 02:00",
        },
        {
          code: "apex-new",
          displayName: "极点新店",
          seatCount: 40,
          businessHours: "12:00–24:00",
        },
      ],
    });
  });

  it("replays the same successful world for the same creation key and payload", async () => {
    const command = {
      creationKey: "00000000-0000-4000-8000-000000000004",
      selectedRole: "staff" as const,
      visitorKey: "visitor-000000000004",
    };

    const first = await database.create(command);
    const retry = await database.create(command);

    expect(retry).toEqual({ ...first, replayed: true });
  });

  it("limits business reads to the active sandbox through Postgres RLS", async () => {
    const firstCreationKey = "00000000-0000-4000-8000-000000000005";
    const first = await database.create({
      creationKey: firstCreationKey,
      selectedRole: "customer",
      visitorKey: "visitor-000000000005",
    });
    const second = await database.create({
      creationKey: "00000000-0000-4000-8000-000000000006",
      selectedRole: "customer",
      visitorKey: "visitor-000000000006",
    });
    const client = new Client({ connectionString: databaseUrl });

    await client.connect();
    try {
      await client.query("begin");
      await client.query("set local role jingshu_runtime");
      await client.query("select set_config('app.sandbox_id', $1, true)", [
        first.sandboxId,
      ]);

      const visibleStores = await client.query<{ sandbox_id: string }>(
        "select sandbox_id from stores order by code",
      );
      const crossSandbox = await client.query<{ count: string }>(
        "select count(*)::text as count from stores where sandbox_id = $1",
        [second.sandboxId],
      );
      const crossSandboxWrite = await client.query(
        "update stores set display_name = '不可见改写' where sandbox_id = $1",
        [second.sandboxId],
      );
      const requestsWithoutCreationKey = await client.query<{ count: string }>(
        "select count(*)::text as count from sandbox_creation_requests",
      );

      await client.query(
        "select set_config('app.creation_key_hash', $1, true)",
        [createHash("sha256").update(firstCreationKey).digest("hex")],
      );
      const visibleRequests = await client.query<{ sandbox_id: string }>(
        "select sandbox_id from sandbox_creation_requests",
      );

      expect(visibleStores.rows).toHaveLength(3);
      expect(
        visibleStores.rows.every((row) => row.sandbox_id === first.sandboxId),
      ).toBe(true);
      expect(crossSandbox.rows[0]?.count).toBe("0");
      expect(crossSandboxWrite.rowCount).toBe(0);
      expect(requestsWithoutCreationKey.rows[0]?.count).toBe("0");
      expect(visibleRequests.rows).toEqual([{ sandbox_id: first.sandboxId }]);
    } finally {
      await client.query("rollback").catch(() => undefined);
      await client.end();
    }
  });

  it("rejects reuse of a creation key with a different role payload", async () => {
    const creationKey = "00000000-0000-4000-8000-000000000007";
    const visitorKey = "visitor-000000000007";
    await database.create({ creationKey, selectedRole: "staff", visitorKey });

    await expect(
      database.create({ creationKey, selectedRole: "hq", visitorKey }),
    ).rejects.toMatchObject({
      name: "PublicSandboxIdempotencyConflictError",
      code: "PUBLIC_SANDBOX_IDEMPOTENCY_CONFLICT",
    } satisfies Partial<PublicSandboxIdempotencyConflictError>);
  });

  it("does not let another visitor replay a creation key", async () => {
    const creationKey = "00000000-0000-4000-8000-000000000015";
    await database.create({
      creationKey,
      selectedRole: "customer",
      visitorKey: "visitor-owner-000000000015",
    });

    await expect(
      database.create({
        creationKey,
        selectedRole: "customer",
        visitorKey: "visitor-intruder-000000000015",
      }),
    ).rejects.toMatchObject({
      code: "PUBLIC_SANDBOX_OWNERSHIP_CONFLICT",
      name: "PublicSandboxOwnershipConflictError",
    });
  });

  it("rolls back the whole world when seed materialization fails", async () => {
    const command = {
      creationKey: "00000000-0000-4000-8000-000000000008",
      selectedRole: "manager" as const,
      visitorKey: "visitor-000000000008",
    };
    const client = new Client({ connectionString: databaseUrl });

    await client.connect();
    await client.query(`
      create function fail_public_sandbox_store_seed() returns trigger
      language plpgsql as $$
      begin
        if new.code = 'apex-new' then
          raise exception 'forced public sandbox seed failure';
        end if;
        return new;
      end
      $$
    `);
    await client.query(`
      create trigger fail_public_sandbox_store_seed
      before insert on stores
      for each row execute function fail_public_sandbox_store_seed()
    `);

    try {
      await expect(database.create(command)).rejects.toThrow(
        "forced public sandbox seed failure",
      );
    } finally {
      await client.query(
        "drop trigger fail_public_sandbox_store_seed on stores",
      );
      await client.query("drop function fail_public_sandbox_store_seed() ");
      await client.end();
    }

    const retry = await database.create(command);
    expect(retry.replayed).toBe(false);
    expect(retry.stores).toHaveLength(3);
  });
});
