import { Job, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "../../constants/queue";
import { processRunCell } from "../processors/runCell.processor";
import { redisConnection } from "../redis/connection";
import { onFinalFailure } from "../deadLetter";
import { logger } from "../../utils/logger";

export const runCellWorker = new Worker(
  QUEUE_NAMES.RUN_CELL,
  async (job: Job, token?: string) => {
    switch (job.name) {
      case JOB_NAMES.RUN_CELL.CELL:
        return await processRunCell(job, token);
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  },
  {
    connection: redisConnection,
    concurrency: 16, // the per-model leases do the real pacing
    lockDuration: 240_000,
  }
);

runCellWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message, attemptsMade: job?.attemptsMade }, "[RunCellWorker] job failed");
  void onFinalFailure(job, err);
});
runCellWorker.on("stalled", (jobId) => logger.warn({ jobId }, "[RunCellWorker] job stalled"));
runCellWorker.on("error", (err) => logger.error({ err: err.message }, "[RunCellWorker] connection error"));
