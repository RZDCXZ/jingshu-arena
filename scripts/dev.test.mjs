import assert from "node:assert/strict";
import test from "node:test";

import { resolveDevelopmentNetwork, runDevelopment } from "./dev.mjs";

test("dev network defaults expose Web on the private LAN with exact origins", () => {
  const network = resolveDevelopmentNetwork(
    {},
    {
      docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
      en0: [{ address: "192.168.1.8", family: "IPv4", internal: false }],
      lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    },
  );

  assert.deepEqual(network, {
    allowedWebOrigins: [
      "http://192.168.1.8:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3000",
    ],
    networkWebOrigin: "http://192.168.1.8:3000",
    publicOrigin: "http://192.168.1.8:3000",
    webHost: "0.0.0.0",
    webPort: "3000",
  });
});

test("dev network preserves explicit host, origin, port, and access host overrides", () => {
  const network = resolveDevelopmentNetwork(
    {
      JINGSHU_DEV_ACCESS_HOST: "devbox.test",
      JINGSHU_WEB_HOST: "0.0.0.0",
      JINGSHU_WEB_PORT: "4100",
      PUBLIC_ORIGIN: "https://devbox.test:4443",
    },
    {},
  );

  assert.deepEqual(network, {
    allowedWebOrigins: [
      "https://devbox.test:4443",
      "http://127.0.0.1:4100",
      "http://localhost:4100",
      "http://devbox.test:4100",
    ],
    networkWebOrigin: "http://devbox.test:4100",
    publicOrigin: "https://devbox.test:4443",
    webHost: "0.0.0.0",
    webPort: "4100",
  });
});

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
