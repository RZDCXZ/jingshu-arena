import { serve } from "@hono/node-server";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicSandboxDatabase } from "@jingshu/database";

import { resolveAllowedOrigins } from "./allowed-origins.js";
import { createApp } from "./app.js";
import { nodeClientIp } from "./node-client-ip.js";
import { FileRepairImageStorage } from "./repair-image-storage.js";
import { PostgresSandboxInvalidationHub } from "./sandbox-realtime.js";
import {
  runRepairImageCleanupJobs,
  runSandboxLifecycleCleanup,
} from "./sandbox-lifecycle-cleanup.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const hostname = process.env.JINGSHU_API_HOST;
const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;
const publicOrigin = process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3000";
const allowedOrigins = resolveAllowedOrigins({
  ...(process.env.JINGSHU_DEV_ALLOWED_ORIGINS
    ? { developmentOrigins: process.env.JINGSHU_DEV_ALLOWED_ORIGINS }
    : {}),
  ...(process.env.NODE_ENV ? { nodeEnvironment: process.env.NODE_ENV } : {}),
  publicOrigin,
});

function positiveIntegerFromEnvironment(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function requestRateFromEnvironment(input: {
  readonly dayName: string;
  readonly defaultPerDay: number;
  readonly defaultPerHour: number;
  readonly hourName: string;
}) {
  const perDay = positiveIntegerFromEnvironment(input.dayName);
  const perHour = positiveIntegerFromEnvironment(input.hourName);
  if (perDay === undefined && perHour === undefined) return undefined;
  return {
    perDay: perDay ?? input.defaultPerDay,
    perHour: perHour ?? input.defaultPerHour,
  };
}

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to start the Jingshu API.");
}
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must contain at least 32 characters.");
}

const configuredRepairImageStorageDirectory =
  process.env.REPAIR_IMAGE_STORAGE_DIR;
if (
  process.env.NODE_ENV === "production" &&
  !configuredRepairImageStorageDirectory
) {
  throw new Error(
    "REPAIR_IMAGE_STORAGE_DIR must point to a persistent shared private volume in production.",
  );
}

const activeSandboxLimit = positiveIntegerFromEnvironment(
  "PUBLIC_SANDBOX_ACTIVE_CAPACITY",
);
const createPerIp = requestRateFromEnvironment({
  dayName: "PUBLIC_SANDBOX_CREATE_IP_PER_DAY",
  defaultPerDay: 200,
  defaultPerHour: 50,
  hourName: "PUBLIC_SANDBOX_CREATE_IP_PER_HOUR",
});
const createPerVisitor = requestRateFromEnvironment({
  dayName: "PUBLIC_SANDBOX_CREATE_VISITOR_PER_DAY",
  defaultPerDay: 20,
  defaultPerHour: 5,
  hourName: "PUBLIC_SANDBOX_CREATE_VISITOR_PER_HOUR",
});
const resetPerIp = requestRateFromEnvironment({
  dayName: "PUBLIC_SANDBOX_RESET_IP_PER_DAY",
  defaultPerDay: 200,
  defaultPerHour: 50,
  hourName: "PUBLIC_SANDBOX_RESET_IP_PER_HOUR",
});
const resetPerVisitor = requestRateFromEnvironment({
  dayName: "PUBLIC_SANDBOX_RESET_VISITOR_PER_DAY",
  defaultPerDay: 20,
  defaultPerHour: 5,
  hourName: "PUBLIC_SANDBOX_RESET_VISITOR_PER_HOUR",
});
const database = createPublicSandboxDatabase(databaseUrl, {
  admissionLimits: {
    ...(activeSandboxLimit === undefined ? {} : { activeSandboxLimit }),
    ...(createPerIp === undefined ? {} : { createPerIp }),
    ...(createPerVisitor === undefined ? {} : { createPerVisitor }),
    ...(resetPerIp === undefined ? {} : { resetPerIp }),
    ...(resetPerVisitor === undefined ? {} : { resetPerVisitor }),
  },
});
const realtimeHub = new PostgresSandboxInvalidationHub(databaseUrl);
function triggerRealtimeProbe() {
  void realtimeHub.start().catch(() => {
    console.warn(
      "Sandbox realtime probe is unavailable; clients will use polling fallback.",
    );
  });
}
triggerRealtimeProbe();
const realtimeProbeTimer = setInterval(triggerRealtimeProbe, 10_000);
realtimeProbeTimer.unref();
const repairImageStorage = new FileRepairImageStorage(
  configuredRepairImageStorageDirectory ??
    join(tmpdir(), "jingshu-arena-private-repair-images"),
);
let cleanupRunning = false;
async function runCleanup() {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    await runSandboxLifecycleCleanup({
      database,
      repairImageStorage,
      wallClock: { now: () => new Date() },
    });
    await runRepairImageCleanupJobs({
      database,
      repairImageStorage,
      wallClock: { now: () => new Date() },
    });
  } finally {
    cleanupRunning = false;
  }
}
function triggerCleanup() {
  void runCleanup().catch((error) => {
    console.error("Sandbox cleanup failed; it will retry.", error);
  });
}
triggerCleanup();
const cleanupTimer = setInterval(triggerCleanup, 60_000);
cleanupTimer.unref();
const app = createApp({
  allowedOrigins,
  sandboxDatabase: database,
  repairImageSigningSecret: sessionSecret,
  repairImageStorage,
  realtimeHub,
  sessionSecret,
});
const server = serve({
  fetch: (request, nodeBindings) =>
    app.fetch(request, { clientIp: nodeClientIp(nodeBindings) }),
  ...(hostname === undefined ? {} : { hostname }),
  port,
});

console.log(
  `Jingshu API listening on http://${hostname ?? "localhost"}:${port}`,
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(cleanupTimer);
    clearInterval(realtimeProbeTimer);
    server.close(() => {
      void Promise.all([database.close(), realtimeHub.close()]).finally(() =>
        process.exit(0),
      );
    });
  });
}
