import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import pg from "pg";

const { Client } = pg;
const POSTGRES_IMAGE = "postgres:17-alpine";
const TEST_DATABASE = "jingshu_test";
const TEST_PASSWORD = "jingshu_test_password";
const TEST_USER = "jingshu_test";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function assertDisposableDatabase(databaseUrl) {
  const url = new URL(databaseUrl);
  const allowedHosts = new Set(["127.0.0.1", "localhost", "postgres"]);

  if (
    !allowedHosts.has(url.hostname) ||
    /prod(?:uction)?/iu.test(url.pathname)
  ) {
    throw new Error(
      "Postgres integration tests only accept a local or CI disposable database.",
    );
  }
}

async function waitForPostgres(databaseUrl) {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const client = new Client({ connectionString: databaseUrl });

    try {
      await client.connect();
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await delay(250);
    }
  }

  throw new Error("Temporary Postgres did not become ready within 30 seconds.");
}

async function resetDisposableDatabase(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await client.query("drop schema if exists drizzle cascade");
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }
}

function runVitest(databaseUrl, testFiles) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "vitest",
      ["run", "--no-file-parallelism", ...testFiles],
      {
        env: { ...process.env, DATABASE_URL: databaseUrl },
        stdio: "inherit",
        cwd: workspaceRoot,
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(
          new Error(`Postgres test process exited with signal ${signal}.`),
        );
        return;
      }

      resolve(code ?? 1);
    });
  });
}

async function main() {
  let containerName;
  let databaseUrl = process.env.DATABASE_URL;
  const requestedTestFiles = process.argv.slice(2);
  const testFiles = requestedTestFiles.length
    ? requestedTestFiles
    : [
        "packages/database/tests/migrations.integration.test.ts",
        "packages/database/tests/migration-upgrade.integration.test.ts",
        "packages/database/tests/public-sandbox.integration.test.ts",
        "packages/database/tests/reservation-lifecycle.integration.test.ts",
        "packages/database/tests/staff-reservation-operations.integration.test.ts",
        "apps/api/src/public-sandbox.integration.test.ts",
        "apps/api/src/customer-seat-browse.integration.test.ts",
        "apps/api/src/staff-reservation.integration.test.ts",
        "apps/api/src/role-context.integration.test.ts",
        "apps/api/src/demo-tools.integration.test.ts",
      ];

  try {
    execFileSync(
      "pnpm",
      [
        "--filter",
        "@jingshu/contracts",
        "--filter",
        "@jingshu/domain",
        "build",
      ],
      {
        cwd: workspaceRoot,
        stdio: "inherit",
      },
    );

    if (!databaseUrl) {
      containerName = `jingshu-postgres-${process.pid}-${randomUUID().slice(0, 8)}`;
      execFileSync(
        "docker",
        [
          "run",
          "--detach",
          "--rm",
          "--name",
          containerName,
          "--env",
          `POSTGRES_DB=${TEST_DATABASE}`,
          "--env",
          `POSTGRES_PASSWORD=${TEST_PASSWORD}`,
          "--env",
          `POSTGRES_USER=${TEST_USER}`,
          "--publish",
          "127.0.0.1::5432",
          POSTGRES_IMAGE,
        ],
        { stdio: ["ignore", "pipe", "inherit"] },
      );

      const portOutput = execFileSync(
        "docker",
        ["port", containerName, "5432/tcp"],
        { encoding: "utf8" },
      ).trim();
      const port = portOutput.slice(portOutput.lastIndexOf(":") + 1);
      databaseUrl = `postgresql://${TEST_USER}:${TEST_PASSWORD}@127.0.0.1:${port}/${TEST_DATABASE}`;
    }

    assertDisposableDatabase(databaseUrl);
    await waitForPostgres(databaseUrl);
    for (const testFile of testFiles) {
      await resetDisposableDatabase(databaseUrl);
      const exitCode = await runVitest(databaseUrl, [testFile]);
      if (exitCode !== 0) {
        process.exitCode = exitCode;
        break;
      }
    }
  } finally {
    if (containerName) {
      execFileSync("docker", ["stop", "--time", "0", containerName], {
        stdio: "ignore",
      });
    }
  }
}

await main();
