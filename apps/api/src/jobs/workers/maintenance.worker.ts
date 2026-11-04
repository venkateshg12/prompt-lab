import { Job, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "../../constants/queue";
import { processPurgeExpired } from "../processors/purgeExpired.processor";
import { redisConnection } from "../redis/connection";
import { logger } from "../../utils/logger";

export const maintenanceWorker = new Worker(
  QUEUE_NAMES.MAINTENANCE,
  async (job: Job) => {
    switch (job.name) {
      case JOB_NAMES.MAINTENANCE.PURGE_EXPIRED:
        return await processPurgeExpired();
      // Phase 17: SWEEP_STALE_RUNS
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
  }
);

maintenanceWorker.on("completed", (job, result) => {
  logger.info({ jobId: job.id, jobName: job.name, result }, "[MaintenanceWorker] Job completed");
});

maintenanceWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, jobName: job?.name, err: err.message }, "[MaintenanceWorker] Job failed");
});

maintenanceWorker.on("error", (err) => {
  logger.error({ err: err.message }, "[MaintenanceWorker Connection Error]");
});
