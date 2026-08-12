import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrateEmptyDatabase } from "../src/index.js";

const { Client } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Postgres integration tests.");
}

const client = new Client({ connectionString: databaseUrl });

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe("empty Postgres migration", () => {
  it("migrates a new database and records the workspace schema version", async () => {
    const before = await client.query<{ relation: string | null }>(
      "select to_regclass('public.jingshu_schema_metadata') as relation",
    );
    expect(before.rows[0]?.relation).toBeNull();

    await migrateEmptyDatabase(databaseUrl);

    const after = await client.query<{ relation: string | null }>(
      "select to_regclass('public.jingshu_schema_metadata') as relation",
    );
    expect(after.rows[0]?.relation).toBe("jingshu_schema_metadata");

    const metadata = await client.query<{ key: string; value: string }>(
      "select key, value from jingshu_schema_metadata order by key",
    );
    expect(metadata.rows).toEqual([{ key: "schema_version", value: "23" }]);
  });
});
