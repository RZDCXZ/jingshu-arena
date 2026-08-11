import { serve } from "@hono/node-server";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicSandboxDatabase } from "@jingshu/database";

import { createApp } from "./app.js";
import { FileRepairImageStorage } from "./repair-image-storage.js";
import { PostgresSandboxInvalidationHub } from "./sandbox-realtime.js";

const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SESSION_SECRET;
const publicOrigin = process.env.PUBLIC_ORIGIN ?? "http://127.0.0.1:3000";

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

const database = createPublicSandboxDatabase(databaseUrl);
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
let repairImageCleanupRunning = false;
async function runRepairImageCleanup() {
  if (repairImageCleanupRunning) return;
  repairImageCleanupRunning = true;
  try {
    await repairImageStorage.sweepExpiredQuarantine();
    const jobs = await database.readDueRepairImageCleanupJobs(25);
    for (const job of jobs) {
      try {
        if (job.targetKind === "sandbox") {
          await repairImageStorage.deleteSandbox(job.sandboxId);
        } else if (job.objectKey) {
          await repairImageStorage.delete(job.objectKey);
        }
        await database.completeRepairImageCleanupJob(job.jobId);
      } catch (error) {
        const retryDelay = Math.min(
          6 * 60 * 60 * 1_000,
          30_000 * 2 ** Math.min(job.attempts, 9),
        );
        await database.retryRepairImageCleanupJob({
          availableAt: new Date(Date.now() + retryDelay),
          failure: error instanceof Error ? error.message : "cleanup-failed",
          jobId: job.jobId,
        });
      }
    }
  } finally {
    repairImageCleanupRunning = false;
  }
}
function triggerRepairImageCleanup() {
  void runRepairImageCleanup().catch((error) => {
    console.error("Private repair image cleanup failed; it will retry.", error);
  });
}
triggerRepairImageCleanup();
const repairImageCleanupTimer = setInterval(triggerRepairImageCleanup, 60_000);
repairImageCleanupTimer.unref();
const app = createApp({
  allowedOrigins: [publicOrigin],
  sandboxDatabase: database,
  repairImageSigningSecret: sessionSecret,
  repairImageStorage,
  realtimeHub,
  sessionSecret,
});
const server = serve({
  fetch: app.fetch,
  port,
});

console.log(`Jingshu API listening on http://localhost:${port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(repairImageCleanupTimer);
    clearInterval(realtimeProbeTimer);
    server.close(() => {
      void Promise.all([database.close(), realtimeHub.close()]).finally(() =>
        process.exit(0),
      );
    });
  });
}
