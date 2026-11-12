import { type Prisma } from "../db/prisma";
import { isUniqueViolation } from "../db/errors";
import { withTransaction } from "../utils/db";
import { publishRunProgress } from "../utils/events/pubsub";
import { runFinalizeQueue } from "../jobs/queues/runFinalize.queue";
import { JOB_NAMES } from "../constants/queue";
import type { CellPayload } from "@repo/types";
import type { CellOutcome } from "./executeCell";
import { runTotals } from "./totals";

const json = (v: unknown): Prisma.InputJsonValue | undefined => (v === null || v === undefined ? undefined : (v as Prisma.InputJsonValue));

/*
  Inserts the cell's Result and moves the run's counters in ONE transaction. A retried cell hits the
  unique row (P2002), the transaction rolls back, and nothing is counted twice. Exactly one transaction
  sees doneCells === totalCells (the increments serialise on the run row), so finalize is enqueued once
  (its job id dedupes it anyway). Returns false when the cell was already recorded.
 */
export const persistCell = async (p: CellPayload, outcome: CellOutcome): Promise<boolean> => {
    try {
        const run = await withTransaction(async (tx) => {
            await tx.result.create({
                data: {
                    orgId: p.orgId,
                    runId: p.runId,
                    variantId: p.variantId,
                    exampleId: p.exampleId,
                    repeatIndex: p.repeat,
                    status: outcome.status,
                    rawOutput: outcome.rawOutput ?? null,
                    extractedText: outcome.extractedText ?? null,
                    parsedJson: json(outcome.parsedJson),
                    validJson: outcome.validJson ?? null,
                    schemaValid: outcome.schemaValid ?? null,
                    fieldScores: json(outcome.fieldScores),
                    fieldDetails: json(outcome.fieldDetails),
                    overallScore: outcome.overallScore ?? null,
                    exactMatch: outcome.exactMatch ?? null,
                    inputTokens: outcome.inputTokens ?? null,
                    outputTokens: outcome.outputTokens ?? null,
                    costUsdMicros: outcome.costUsdMicros ?? null,
                    latencyMs: outcome.latencyMs ?? null,
                    finishReason: outcome.finishReason ?? null,
                    attempts: outcome.attempts ?? 1,
                    error: outcome.error ?? null,
                },
            });
            await tx.run.updateMany({ where: { id: p.runId, status: "queued" }, data: { status: "running" } });
            return tx.run.update({
                where: { id: p.runId },
                data: {
                    doneCells: { increment: 1 },
                    ...(outcome.status === "error" ? { errorCells: { increment: 1 } } : {}),
                },
                select: { id: true, status: true, doneCells: true, errorCells: true, totalCells: true },
            });
        });
        await publishRunProgress(
            { runId: run.id, status: run.status, doneCells: run.doneCells, errorCells: run.errorCells, totalCells: run.totalCells },
            () => runTotals(p.runId)
        );
        if (run.doneCells === run.totalCells) {
            await runFinalizeQueue.add(JOB_NAMES.RUN_FINALIZE.FINALIZE, { orgId: p.orgId, runId: p.runId }, { jobId: `finalize-${p.runId}` });
        }
        return true;
    } catch (e) {
        if (isUniqueViolation(e)) return false; // this cell was already recorded: count nothing
        throw e;
    }
};

