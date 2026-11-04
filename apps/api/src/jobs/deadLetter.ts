import type { Job } from "bullmq";
import { deadLetterQueue } from "./queues/deadLetter.queue";

/**
 * Called from every worker's "failed" event. Only the LAST attempt counts: earlier failures are just
 * backoff. The job is copied to the dead-letter queue with everything needed to replay it.
 */
export const onFinalFailure = async (job: Job | undefined, err: Error): Promise<void> => {
    if (!job) return;

    const isUnrecoverable = err.name === "UnrecoverableError";
    if (!isUnrecoverable && job.attemptsMade < (job.opts.attempts ?? 1)) return;

    // Phase 17: for run-cell jobs, first write the cell's Result with status "error" so the run can finish.
    await deadLetterQueue.add(
        "dead",
        {
            queue: job.queueName,
            name: job.name,
            jobId: job.id,
            data: job.data,
            failedReason: err.message.slice(0, 2000),
            failedAt: new Date().toISOString(),
        },
        { jobId: `dead-${job.id}` }
    );
};
