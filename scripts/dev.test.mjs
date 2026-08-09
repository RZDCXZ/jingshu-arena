import assert from "node:assert/strict";
import test from "node:test";

import { runDevelopment } from "./dev.mjs";

test("dev startup provisions Postgres before starting API and Web", async () => {
  const events = [];
  const databaseUrl =
    "postgresql://jingshu_dev:jingshu_dev@127.0.0.1:55432/jingshu_dev";

  const exitCode = await runDevelopment({
    createSessionSecret: () => "generated-local-session-secret-0001",
    environment: {},
    lifecycle: {
      async buildSharedPackages(environment) {
        events.push(["build", environment.DATABASE_URL]);
      },
      async migrateDatabase(environment) {
        events.push(["migrate", environment.DATABASE_URL]);
      },
      async startServices(environment) {
        events.push([
          "services",
          environment.DATABASE_URL,
          environment.SESSION_SECRET,
        ]);
        return 0;
      },
      async startTemporaryPostgres() {
        events.push(["postgres"]);
        return {
          databaseUrl,
          async stop() {
            events.push(["stop-postgres"]);
          },
        };
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(events, [
    ["postgres"],
    ["build", databaseUrl],
    ["migrate", databaseUrl],
    ["services", databaseUrl, "generated-local-session-secret-0001"],
    ["stop-postgres"],
  ]);
});

test("dev startup preserves an explicitly configured local environment", async () => {
  const events = [];
  const environment = {
    DATABASE_URL:
      "postgresql://configured:configured@localhost:5432/configured_dev",
    SESSION_SECRET: "configured-local-session-secret-0001",
  };

  const exitCode = await runDevelopment({
    createSessionSecret: () => {
      throw new Error("must not replace an explicit session secret");
    },
    environment,
    lifecycle: {
      async buildSharedPackages(runtimeEnvironment) {
        events.push(["build", runtimeEnvironment.DATABASE_URL]);
      },
      async migrateDatabase(runtimeEnvironment) {
        events.push(["migrate", runtimeEnvironment.DATABASE_URL]);
      },
      async startServices(runtimeEnvironment) {
        events.push([
          "services",
          runtimeEnvironment.DATABASE_URL,
          runtimeEnvironment.SESSION_SECRET,
        ]);
        return 0;
      },
      async startTemporaryPostgres() {
        throw new Error("must not provision Postgres when DATABASE_URL is set");
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(events, [
    ["build", environment.DATABASE_URL],
    ["migrate", environment.DATABASE_URL],
    ["services", environment.DATABASE_URL, environment.SESSION_SECRET],
  ]);
});
