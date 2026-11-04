import { Job, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "../../constants/queue";
import { processRunFinalize } from "../processors/runFinalize.processor";
import { redisConnection } from "../redis/connection";
import { onFinalFailure } from "../deadLetter";
import { logger } from "../../utils/logger";

export const runFinalizeWorker = new Worker(
  QUEUE_NAMES.RUN_FINALIZE,
  async (job: Job) => {
    switch (job.name) {
      case JOB_NAMES.RUN_FINALIZE.FINALIZE:
        return await processRunFinalize(job);
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  },
  { connection: redisConnection, concurrency: 2 }
);

runFinalizeWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err: err.message }, "[RunFinalizeWorker] job failed");
  void onFinalFailure(job, err);
});
runFinalizeWorker.on("error", (err) => logger.error({ err: err.message }, "[RunFinalizeWorker] connection error"));
