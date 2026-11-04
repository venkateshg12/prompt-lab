import { Job } from "bullmq";
import { finalizePayloadSchema } from "@repo/types";
import { prisma } from "../../db/prisma";
import { cache } from "../../utils/cache";
import { runWithRequestContext } from "../../utils/requestContext";
import { publishProgress } from "../../utils/events/pubsub";
import { EmailProducer } from "../producers/email.producer";
import { logger } from "../../utils/logger";

/*
  Runs once, when the last cell is recorded. Marks the run completed (a cancelled run stays cancelled).
  Phase 18 computes RunVariant.summary here.
 */
export async function processRunFinalize(job: Job) {
    const p = finalizePayloadSchema.parse(job.data);
    return runWithRequestContext({ requestId: String(job.id), orgId: p.orgId, runId: p.runId, jobId: String(job.id) }, async () => {
        await prisma.run.updateMany({ where: { id: p.runId, status: "running" }, data: { status: "completed", finishedAt: new Date() } });
        const run = await prisma.run.findUnique({ where: { id: p.runId }, include: { task: { select: { name: true } } } });
        if (!run) return { status: "gone" };
        if (!run.finishedAt) await prisma.run.updateMany({ where: { id: p.runId, finishedAt: null }, data: { finishedAt: new Date() } });
        // Phase 18: compute RunVariant.summary (aggregates) here.
        await cache.bump("runs"); // after the write: run lists and summaries are re-read
        await publishProgress({ runId: run.id, status: run.status, doneCells: run.doneCells, errorCells: run.errorCells, totalCells: run.totalCells });
        if (run.status === "completed" || run.status === "cancelled") {
            await EmailProducer.sendRunFinished({
                runId: run.id,
                orgId: run.orgId,
                startedById: run.startedById,
                taskName: run.task.name,
                status: run.status,
                totalCells: run.totalCells,
                errorCells: run.errorCells,
            });
        }
        logger.info({ runId: run.id, status: run.status, errorCells: run.errorCells }, "run finalized");
        return { status: run.status };
    });
}
