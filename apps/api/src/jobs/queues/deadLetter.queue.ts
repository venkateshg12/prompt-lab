import { Queue } from "bullmq";
import { QUEUE_NAMES } from "../../constants/queue";
import { redisConnection } from "../redis/connection";

export const deadLetterQueue = new Queue(QUEUE_NAMES.DEAD_LETTER, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: false,
    removeOnFail: false,
  },
});
