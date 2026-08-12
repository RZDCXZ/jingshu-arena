import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const nextEnvironmentPath = path.join(
  workspaceRoot,
  "apps",
  "web",
  "next-env.d.ts",
);

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function waitForServer(child, origin) {
  const deadline = Date.now() + 240_000;
  let lastFailure = "not yet reachable";

  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        "Demo-story development services stopped before startup.",
      );
    }
    try {
      const response = await fetch(`${origin}/api/v1/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastFailure = `health returned ${response.status}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : "health failed";
    }
    await delay(250);
  }

  throw new Error(
    `Demo-story development services did not become ready: ${lastFailure}.`,
  );
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;

  child.kill("SIGTERM");
  await Promise.race([waitForExit(child), delay(20_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

const originalNextEnvironment = await readFile(nextEnvironmentPath, "utf8");
const server = spawn(
  process.execPath,
  [
    "--env-file-if-exists=.env",
    "--env-file-if-exists=.env.local",
    "scripts/dev.mjs",
  ],
  {
    cwd: workspaceRoot,
    env: {
      ...process.env,
      JINGSHU_API_ORIGIN: "http://127.0.0.1:3101",
      JINGSHU_API_PORT: "3101",
      JINGSHU_NEXT_DIST_DIR: ".next-demo-story-browser",
      JINGSHU_WEB_PORT: "3100",
      PUBLIC_ORIGIN: "http://127.0.0.1:3100",
    },
    stdio: "inherit",
  },
);

const forwardSignal = (signal) => server.kill(signal);
process.once("SIGINT", () => forwardSignal("SIGINT"));
process.once("SIGTERM", () => forwardSignal("SIGTERM"));

try {
  await waitForServer(server, "http://127.0.0.1:3100");
  const child = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      "--config",
      "playwright.demo-story.config.ts",
    ],
    {
      cwd: workspaceRoot,
      stdio: "inherit",
    },
  );
  const result = await waitForExit(child);
  process.exitCode = result.code ?? 1;
} finally {
  await stopChild(server);
  await writeFile(nextEnvironmentPath, originalNextEnvironment);
}
