import { prisma } from "../db/prisma";
import { afterCursor, cursorOrder, decodeCursor, pageOf } from "../utils/db/cursor";
import { cache } from "../utils/cache";
import { appAssert } from "../utils/errors";
import { CONFLICT, NOT_FOUND } from "../constants/https";
import { appErrorCode } from "../constants/appErrorCode";
import { recordAudit, type AuditActor } from "./audit.service";
import { runFinalizeQueue } from "../jobs/queues/runFinalize.queue";
import { JOB_NAMES } from "../constants/queue";
import type { Run } from "../generated/prisma/client";

/** A run as the API returns it. The (large) prompt snapshots are fetched separately. */
export const toRunDto = (r: Run) => ({
    id: r.id,
    taskId: r.taskId,
    taskVersion: r.taskVersion,
    split: r.split,
    repeats: r.repeats,
    temperature: r.temperature,
    status: r.status,
    datasetHash: r.datasetHash,
    testReused: r.testReused,
    pricesSnapshot: r.pricesSnapshot,
    totalCells: r.totalCells,
    doneCells: r.doneCells,
    errorCells: r.errorCells,
    notes: r.notes,
    startedById: r.startedById,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    finishedAt: r.finishedAt,
});

export const listRuns = async (query: { taskId?: string; cursor?: string; limit: number }) => {
    const rows = await prisma.run.findMany({
        where: { ...(query.taskId ? { taskId: query.taskId } : {}), ...afterCursor(decodeCursor(query.cursor)) },
        orderBy: cursorOrder,
        take: query.limit + 1,
        include: { task: { select: { name: true, slug: true } } },
    });
    const { items, meta } = pageOf(rows, query.limit);
    return { items: items.map((r) => ({ ...toRunDto(r), task: r.task })), meta };
};

export const getRun = async (id: string) => {
    const run = await prisma.run.findUnique({
        where: { id },
        include: {
            task: { select: { name: true, slug: true, version: true } },
            variants: { include: { promptVersion: { select: { key: true, version: true, technique: true } }, model: { select: { key: true, label: true } } } },
        },
    });
    appAssert(run, NOT_FOUND, "Run not found");
    const counts = await prisma.result.groupBy({ by: ["variantId", "status"], where: { runId: id }, _count: { _all: true } });
    const countOf = (variantId: string, status: string) => counts.find((c) => c.variantId === variantId && c.status === status)?._count._all ?? 0;
    return {
        ...toRunDto(run),
        task: run.task,
        variants: run.variants.map((v) => ({
            id: v.id,
            promptVersionId: v.promptVersionId,
            versionId: `${v.promptVersion.key}@${v.promptVersion.version}`,
            technique: v.promptVersion.technique,
            modelKey: v.model.key,
            modelLabel: v.model.label,
            summary: v.summary,
            scored: countOf(v.id, "scored"),
            errors: countOf(v.id, "error"),
            skipped: countOf(v.id, "skipped"),
        })),
        // Per model: how far each model has got (the launcher shows one bar per model).
        progressByModel: Object.values(
            run.variants.reduce<Record<string, { modelKey: string; done: number; errors: number }>>((acc, v) => {
                const e = (acc[v.model.key] ??= { modelKey: v.model.key, done: 0, errors: 0 });
                e.done += countOf(v.id, "scored") + countOf(v.id, "error") + countOf(v.id, "skipped");
                e.errors += countOf(v.id, "error");
                return acc;
            }, {})
        ),
    };
};

/*
  Conditional: only from queued/running. There is no "cancelling" state: cells that start afterwards see
  `cancelled` and record `skipped`, so queued jobs drain in seconds without spending money and the
  completed results are kept.
 */
export const cancelRun = async (orgId: string, id: string, actor: AuditActor) => {
    const { count } = await prisma.run.updateMany({ where: { id, status: { in: ["queued", "running"] } }, data: { status: "cancelled", finishedAt: new Date() } });
    if (count === 0) {
        const exists = await prisma.run.findUnique({ where: { id }, select: { id: true } });
        appAssert(exists, NOT_FOUND, "Run not found");
        appAssert(false, CONFLICT, "Only a queued or running run can be cancelled", appErrorCode.RunNotCancellable);
    }
    await recordAudit({ orgId, actor, action: "run.cancel", target: { type: "run", id } });
    await cache.bump("runs");
    // A run cancelled before any cell was enqueued (or with every cell already done) still needs its finalize.
    const run = await prisma.run.findUniqueOrThrow({ where: { id } });
    if (run.doneCells >= run.totalCells) {
        await runFinalizeQueue.add(JOB_NAMES.RUN_FINALIZE.FINALIZE, { orgId, runId: id }, { jobId: `finalize-${id}` });
    }
    return toRunDto(run);
};
