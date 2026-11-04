import type { Job } from "bullmq";
import { deadLetterQueue } from "./queues/deadLetter.queue";
import { QUEUE_NAMES } from "../constants/queue";
import { cellPayloadSchema } from "@repo/types";
import { persistCell } from "../runner/persistCell";
import { runWithRequestContext } from "../utils/requestContext";
import { scrubSecrets } from "../utils/scrubSecrets";
import { logger } from "../utils/logger";

/**
 * Called from every worker's "failed" event. Only the LAST attempt counts: earlier failures are just
 * backoff. The job is copied to the dead-letter queue with everything needed to replay it.
 */
export const onFinalFailure = async (job: Job | undefined, err: Error): Promise<void> => {
    if (!job) return;

    const isUnrecoverable = err.name === "UnrecoverableError";
    if (!isUnrecoverable && job.attemptsMade < (job.opts.attempts ?? 1)) return;

    // A cell that failed for a reason it couldn't record itself (the database was down, a bug): write its
    // Result with status "error" first, so the run can still finish, THEN keep the job for replay.
    if (job.queueName === QUEUE_NAMES.RUN_CELL) {
        const parsed = cellPayloadSchema.safeParse(job.data);
        if (parsed.success) {
            try {
                await runWithRequestContext({ requestId: String(job.id), orgId: parsed.data.orgId, runId: parsed.data.runId }, () =>
                    persistCell(parsed.data, { status: "error", error: `${err.name}: ${scrubSecrets(err.message).slice(0, 300)}`, attempts: job.attemptsMade })
                );
            } catch (e) {
                logger.error({ jobId: job.id, err: (e as Error).message }, "could not record the dead cell as an error result");
            }
        }
    }
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
