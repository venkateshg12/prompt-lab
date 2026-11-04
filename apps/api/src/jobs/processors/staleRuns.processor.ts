import { prisma } from "../../db/prisma";
import { runAsSystem, runWithRequestContext } from "../../utils/requestContext";
import { enqueueCells } from "../../runner/createRun";
import { runFinalizeQueue } from "../queues/runFinalize.queue";
import { JOB_NAMES } from "../../constants/queue";
import { logger } from "../../utils/logger";

const STALE_AFTER_MS = 10 * 60_000;

/*
  Recovers runs left `queued`/`running` with no progress for 10 minutes: a crash between "run committed"
  and "cells enqueued", or lost jobs. Re-adds every cell that has no Result yet. Same job ids, so live
  jobs aren't duplicated; and the unique result row makes a double execution harmless anyway. A run whose
  cells are all recorded but is still `running` gets its finalize job re-added.
 */
export async function processSweepStaleRuns(now = new Date()) {
    const stale = await runAsSystem(() =>
        prisma.run.findMany({
            where: { status: { in: ["queued", "running"] }, updatedAt: { lt: new Date(now.getTime() - STALE_AFTER_MS) } },
            select: { id: true, orgId: true, taskId: true, split: true, repeats: true, totalCells: true, doneCells: true },
            take: 100,
        })
    );

    let requeued = 0;
    let refinalized = 0;
    for (const run of stale) {
        await runWithRequestContext({ requestId: `sweep-${run.id}`, orgId: run.orgId, runId: run.id }, async () => {
            const [variants, examples, results] = await Promise.all([
                prisma.runVariant.findMany({ where: { runId: run.id }, select: { id: true } }),
                prisma.example.findMany({ where: { taskId: run.taskId, split: run.split }, select: { id: true } }),
                prisma.result.findMany({ where: { runId: run.id }, select: { variantId: true, exampleId: true, repeatIndex: true } }),
            ]);
            const done = new Set(results.map((r) => `${r.variantId}|${r.exampleId}|${r.repeatIndex}`));
            const missing = new Set<string>();
            for (const e of examples) for (let r = 0; r < run.repeats; r++) for (const v of variants) {
                const k = `${v.id}|${e.id}|${r}`;
                if (!done.has(k)) missing.add(k);
            }
            if (missing.size > 0) {
                requeued += await enqueueCells({ id: run.id, orgId: run.orgId, repeats: run.repeats }, variants.map((v) => v.id), examples.map((e) => e.id), missing);
            } else {
                await runFinalizeQueue.add(JOB_NAMES.RUN_FINALIZE.FINALIZE, { orgId: run.orgId, runId: run.id }, { jobId: `finalize-${run.id}` });
                refinalized++;
            }
        });
    }
    if (stale.length) logger.info({ runs: stale.length, requeued, refinalized }, "stale-run sweep");
    return { runs: stale.length, requeued, refinalized };
}
