import { Queue } from "bullmq";
import { QUEUE_NAMES } from "../../constants/queue";
import { CELL_BACKOFF_MS } from "../../constants/env";
import { redisConnection } from "../redis/connection";

// One job per CELL (variant × example × repeat). The cell retries transient failures itself; on its final
// attempt it records an `error` result and completes, so a run can always finish.
export const runCellQueue = new Queue(QUEUE_NAMES.RUN_CELL, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: CELL_BACKOFF_MS },
    removeOnComplete: { age: 24 * 3600, count: 20000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});
