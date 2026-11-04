import { deadLetterQueue } from "../jobs/queues/deadLetter.queue";
import { runCellQueue } from "../jobs/queues/runCell.queue";
import { runFinalizeQueue } from "../jobs/queues/runFinalize.queue";
import { withTransaction } from "../utils/db";
import { runWithRequestContext } from "../utils/requestContext";
import { AppError } from "../utils/errors";
import { NOT_FOUND } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { QUEUE_NAMES, JOB_NAMES } from "../constants/queue";
import { cellPayloadSchema } from "@repo/types";
import { logger } from "../utils/logger";

export interface DeadJobSummary {
    id: string;
    queue: string;
    name: string;
    runId?: string;
    failedReason: string;
    failedAt: string;
}

/** Platform-admin view of every dead job (cells that failed for a reason they couldn't record themselves). */
export const listDead = async (options: { limit?: number; offset?: number } = {}): Promise<DeadJobSummary[]> => {
    const jobs = await deadLetterQueue.getJobs(["waiting", "delayed", "completed", "failed", "active"], 0, 1000);
    return jobs
        .filter((j) => j?.data)
        .slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 50))
        .map((j) => ({
            id: String(j.id),
            queue: j.data.queue,
            name: j.data.name,
            runId: j.data.data?.runId ? String(j.data.data.runId) : undefined,
            failedReason: j.data.failedReason,
            failedAt: j.data.failedAt,
        }));
};

const notFound = () => new AppError(NOT_FOUND, "Dead job not found in DLQ", appErrorCode.ValidationError);

/*
  Replaying a dead CELL: delete its `error` result and take it back out of the counters in ONE
  transaction (put the run back to `running` if it had completed), then re-add the cell under its original
  job id. The unique result row makes a double replay harmless.
 */
export const replayDeadJob = async (deadJobId: string) => {
    const job = await deadLetterQueue.getJob(deadJobId);
    if (!job) throw notFound();
    const original = job.data;
    if (original.queue !== QUEUE_NAMES.RUN_CELL) throw new AppError(404, "Only run-cell jobs can be replayed", appErrorCode.ValidationError);
    const cell = cellPayloadSchema.parse(original.data);

    await runWithRequestContext({ requestId: `dlq-${deadJobId}`, orgId: cell.orgId, runId: cell.runId }, async () => {
        await withTransaction(async (tx) => {
            const existing = await tx.result.findFirst({ where: { runId: cell.runId, variantId: cell.variantId, exampleId: cell.exampleId, repeatIndex: cell.repeat } });
            if (existing) {
                await tx.result.delete({ where: { id: existing.id } });
                await tx.run.update({
                    where: { id: cell.runId },
                    data: { doneCells: { decrement: 1 }, ...(existing.status === "error" ? { errorCells: { decrement: 1 } } : {}), status: "running", finishedAt: null },
                });
            }
        });
    });
    // The old jobs must go first: BullMQ ignores an add whose id still exists.
    await runCellQueue.getJob(String(original.jobId))?.then((j) => j?.remove()).catch(() => undefined);
    await runFinalizeQueue.getJob(`finalize-${cell.runId}`)?.then((j) => j?.remove()).catch(() => undefined);
    await runCellQueue.add(JOB_NAMES.RUN_CELL.CELL, cell, { jobId: String(original.jobId) });
    await job.remove().catch((err) => logger.warn({ err, deadJobId }, "failed to remove replayed DLQ job"));
    return { replayed: true, runId: cell.runId };
};

export const discardDeadJob = async (deadJobId: string) => {
    const job = await deadLetterQueue.getJob(deadJobId);
    if (!job) throw notFound();
    await job.remove();
    return { discarded: true };
};
