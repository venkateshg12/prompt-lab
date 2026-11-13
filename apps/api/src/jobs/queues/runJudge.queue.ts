import { Queue } from "bullmq";
import { QUEUE_NAMES } from "../../constants/queue";
import { redisConnection } from "../redis/connection";

// Phase 26: one job per judged result, id judge-<runId>-<resultId> (dashes, never colons).
export const runJudgeQueue = new Queue(QUEUE_NAMES.RUN_JUDGE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
