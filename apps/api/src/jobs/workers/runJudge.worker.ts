import { Job, Worker } from "bullmq";
import { JOB_NAMES, QUEUE_NAMES } from "../../constants/queue";
import { processJudge } from "../processors/judge.processor";
import { redisConnection } from "../redis/connection";
import { logger } from "../../utils/logger";

export const runJudgeWorker = new Worker(
  QUEUE_NAMES.RUN_JUDGE,
  async (job: Job) => {
    switch (job.name) {
      case JOB_NAMES.RUN_JUDGE.JUDGE:
        return await processJudge(job);
      default:
        throw new Error(`Unknown job name: ${job.name}`);
    }
  },
  { connection: redisConnection, concurrency: 4 } // complete()'s per-model leases do the real pacing
);

runJudgeWorker.on("failed", (job, err) => logger.error({ jobId: job?.id, err: err.message, attemptsMade: job?.attemptsMade }, "[RunJudgeWorker] job failed"));
runJudgeWorker.on("error", (err) => logger.error({ err: err.message }, "[RunJudgeWorker] connection error"));
