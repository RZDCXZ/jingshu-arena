import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

const POSTGRES_DATABASE = "jingshu_dev";
const POSTGRES_IMAGE = "postgres:17-alpine";
const POSTGRES_USER = "jingshu_dev";
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function spawnProcess(command, args, options = {}) {
  return spawn(command, args, {
    cwd: workspaceRoot,
    stdio: "inherit",
    ...options,
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function runProcess(command, args, options = {}) {
  const result = await waitForExit(spawnProcess(command, args, options));
  if (result.signal) {
    throw new Error(`${command} exited after receiving ${result.signal}.`);
  }
  if (result.code !== 0) {
    throw new Error(`${command} exited with code ${result.code ?? 1}.`);
  }
}

async function captureProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: workspaceRoot,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  const stdout = [];
  const stderr = [];
  child.stdout?.on("data", (chunk) => stdout.push(chunk));
  child.stderr?.on("data", (chunk) => stderr.push(chunk));
  const result = await waitForExit(child);
  const output = Buffer.concat(stdout).toString("utf8").trim();
  const errorOutput = Buffer.concat(stderr).toString("utf8").trim();

  if (result.signal || result.code !== 0) {
    throw new Error(
      errorOutput ||
        `${command} exited ${
          result.signal
            ? `after receiving ${result.signal}`
            : `with code ${result.code ?? 1}`
        }.`,
    );
  }

  return output;
}

function assertDisposableDatabase(databaseUrl) {
  const url = new URL(databaseUrl);
  const allowedHosts = new Set(["127.0.0.1", "localhost", "postgres"]);

  if (
    !allowedHosts.has(url.hostname) ||
    /prod(?:uction)?/iu.test(url.pathname)
  ) {
    throw new Error(
      "Local development only accepts a local or CI disposable Postgres database.",
    );
  }
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await Promise.race([waitForExit(child), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

async function startTemporaryPostgres() {
  const containerName = `jingshu-dev-postgres-${process.pid}-${randomUUID().slice(0, 8)}`;
  const password = randomBytes(24).toString("hex");
  let started = false;

  const stop = async () => {
    if (!started) {
      return;
    }
    started = false;
    await captureProcess("docker", ["stop", "--time", "0", containerName], {
      stdio: ["ignore", "ignore", "ignore"],
    }).catch(() => undefined);
  };

  try {
    await captureProcess("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      containerName,
      "--env",
      `POSTGRES_DB=${POSTGRES_DATABASE}`,
      "--env",
      `POSTGRES_PASSWORD=${password}`,
      "--env",
      `POSTGRES_USER=${POSTGRES_USER}`,
      "--publish",
      "127.0.0.1::5432",
      POSTGRES_IMAGE,
    ]);
    started = true;

    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const ready = await captureProcess("docker", [
        "exec",
        containerName,
        "pg_isready",
        "--username",
        POSTGRES_USER,
        "--dbname",
        POSTGRES_DATABASE,
      ]).then(
        () => true,
        () => false,
      );
      if (ready) {
        break;
      }
      await delay(250);
    }

    const ready = await captureProcess("docker", [
      "exec",
      containerName,
      "pg_isready",
      "--username",
      POSTGRES_USER,
      "--dbname",
      POSTGRES_DATABASE,
    ]).then(
      () => true,
      () => false,
    );
    if (!ready) {
      throw new Error(
        "Temporary Postgres did not become ready within 60 seconds.",
      );
    }

    const portOutput = await captureProcess("docker", [
      "port",
      containerName,
      "5432/tcp",
    ]);
    const port = portOutput.slice(portOutput.lastIndexOf(":") + 1);
    const databaseUrl = `postgresql://${POSTGRES_USER}:${encodeURIComponent(password)}@127.0.0.1:${port}/${POSTGRES_DATABASE}`;

    console.log(`Temporary Postgres ready on 127.0.0.1:${port}.`);
    return { databaseUrl, stop };
  } catch (error) {
    await stop();
    if (error instanceof Error && error.message.includes("ENOENT")) {
      throw new Error(
        "Docker is required when DATABASE_URL is not configured for local development.",
        { cause: error },
      );
    }
    throw error;
  }
}

async function buildSharedPackages(environment) {
  await runProcess(
    "pnpm",
    [
      "--filter",
      "@jingshu/contracts",
      "--filter",
      "@jingshu/domain",
      "--filter",
      "@jingshu/database",
      "build",
    ],
    { env: environment },
  );
}

async function migrateDatabase(environment) {
  await runProcess("pnpm", ["--filter", "@jingshu/database", "db:migrate"], {
    env: environment,
  });
}

async function startServices(environment) {
  const apiPort = environment.JINGSHU_API_PORT ?? "3001";
  const webPort = environment.JINGSHU_WEB_PORT ?? "3000";
  const webOrigin = environment.PUBLIC_ORIGIN ?? `http://127.0.0.1:${webPort}`;
  const apiOrigin =
    environment.JINGSHU_API_ORIGIN ?? `http://127.0.0.1:${apiPort}`;
  const api = spawnProcess("pnpm", ["--filter", "@jingshu/api", "dev"], {
    env: {
      ...environment,
      PORT: apiPort,
      PUBLIC_ORIGIN: webOrigin,
    },
  });
  const web = spawnProcess(
    "pnpm",
    [
      "--filter",
      "@jingshu/web",
      "exec",
      "next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      webPort,
    ],
    {
      env: {
        ...environment,
        JINGSHU_API_ORIGIN: apiOrigin,
      },
    },
  );
  let resolveSignal;
  const signalPromise = new Promise((resolve) => {
    resolveSignal = resolve;
  });
  const onSigint = () => resolveSignal("SIGINT");
  const onSigterm = () => resolveSignal("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  try {
    const first = await Promise.race([
      waitForExit(api).then((result) => ({ service: "API", ...result })),
      waitForExit(web).then((result) => ({ service: "Web", ...result })),
      signalPromise.then((signal) => ({ service: "development", signal })),
    ]);
    await Promise.allSettled([stopChild(api), stopChild(web)]);

    if (first.service === "development") {
      return 0;
    }
    if (first.signal) {
      console.error(
        `${first.service} stopped after receiving ${first.signal}.`,
      );
      return 1;
    }
    if (first.code !== 0) {
      console.error(`${first.service} exited with code ${first.code ?? 1}.`);
      return first.code ?? 1;
    }
    return 0;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

const defaultLifecycle = {
  buildSharedPackages,
  migrateDatabase,
  startServices,
  startTemporaryPostgres,
};

export async function runDevelopment({
  createSessionSecret = () => randomBytes(32).toString("hex"),
  environment = process.env,
  lifecycle = defaultLifecycle,
} = {}) {
  let temporaryPostgres;
  let databaseUrl = environment.DATABASE_URL;

  try {
    if (!databaseUrl) {
      temporaryPostgres = await lifecycle.startTemporaryPostgres();
      databaseUrl = temporaryPostgres.databaseUrl;
    }
    assertDisposableDatabase(databaseUrl);

    const runtimeEnvironment = {
      ...environment,
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: environment.SESSION_SECRET || createSessionSecret(),
    };

    await lifecycle.buildSharedPackages(runtimeEnvironment);
    await lifecycle.migrateDatabase(runtimeEnvironment);
    return await lifecycle.startServices(runtimeEnvironment);
  } finally {
    await temporaryPostgres?.stop();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  runDevelopment()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(
        error instanceof Error ? error.message : "Development startup failed.",
      );
      process.exitCode = 1;
    });
}
