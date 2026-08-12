import type { PublicSandboxDatabase } from "@jingshu/database";

import type { RepairImageStorage } from "./repair-image-storage.js";

const ORPHAN_UPLOAD_GRACE_MS = 60 * 60 * 1_000;

export interface SandboxLifecycleCleanupOptions {
  readonly database: Pick<
    PublicSandboxDatabase,
    | "deleteSandboxBusinessBatch"
    | "markSandboxCleanupBlobsDeleted"
    | "readDueSandboxCleanupTasks"
    | "retrySandboxCleanupTask"
    | "scheduleExpiredSandboxCleanup"
  >;
  readonly repairImageStorage: RepairImageStorage;
  readonly wallClock: { now(): Date };
}

export interface RepairImageCleanupOptions {
  readonly database: Pick<
    PublicSandboxDatabase,
    | "completeRepairImageCleanupJob"
    | "readDueRepairImageCleanupJobs"
    | "retryRepairImageCleanupJob"
  >;
  readonly repairImageStorage: RepairImageStorage;
  readonly wallClock: { now(): Date };
}

function retryDelayMilliseconds(attempts: number) {
  return Math.min(6 * 60 * 60 * 1_000, 30_000 * 2 ** Math.min(attempts, 9));
}

function failureMessage(error: unknown) {
  return error instanceof Error ? error.message : "sandbox-cleanup-failed";
}

export async function runSandboxLifecycleCleanup(
  options: SandboxLifecycleCleanupOptions,
) {
  await options.repairImageStorage.sweepExpiredQuarantine(
    ORPHAN_UPLOAD_GRACE_MS,
  );
  await options.database.scheduleExpiredSandboxCleanup();
  const tasks = await options.database.readDueSandboxCleanupTasks(25);

  for (const task of tasks) {
    try {
      if (task.phase === "blobs") {
        await options.repairImageStorage.deleteSandbox(task.sandboxId);
        await options.database.markSandboxCleanupBlobsDeleted(task.sandboxId);
        continue;
      }
      await options.database.deleteSandboxBusinessBatch({
        batchSize: 100,
        sandboxId: task.sandboxId,
      });
    } catch (error) {
      const now = options.wallClock.now();
      await options.database.retrySandboxCleanupTask({
        availableAt: new Date(
          now.getTime() + retryDelayMilliseconds(task.attempts),
        ),
        failure: failureMessage(error),
        sandboxId: task.sandboxId,
      });
    }
  }

  return { processed: tasks.length };
}

export async function runRepairImageCleanupJobs(
  options: RepairImageCleanupOptions,
) {
  const jobs = await options.database.readDueRepairImageCleanupJobs(25);

  for (const job of jobs) {
    try {
      if (job.targetKind === "sandbox") {
        await options.repairImageStorage.deleteSandbox(job.sandboxId);
      } else if (job.objectKey) {
        await options.repairImageStorage.delete(job.objectKey);
      }
      await options.database.completeRepairImageCleanupJob(job.jobId);
    } catch (error) {
      const now = options.wallClock.now();
      await options.database.retryRepairImageCleanupJob({
        availableAt: new Date(
          now.getTime() + retryDelayMilliseconds(job.attempts),
        ),
        failure: failureMessage(error),
        jobId: job.jobId,
      });
    }
  }

  return { processed: jobs.length };
}
