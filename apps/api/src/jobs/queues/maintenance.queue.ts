import { Queue } from "bullmq";
import { QUEUE_NAMES } from "../../constants/queue";
import { redisConnection } from "../redis/connection";

export const maintenanceQueue = new Queue(QUEUE_NAMES.MAINTENANCE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  },
});
