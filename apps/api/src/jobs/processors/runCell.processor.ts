import { DelayedError, Job, UnrecoverableError } from "bullmq";
import { cellPayloadSchema } from "@repo/types";
import { runWithRequestContext } from "../../utils/requestContext";
import { complete } from "../../ai/complete";
import { isRetryable } from "../../ai/reliability";
import { ProviderBusy, ProviderSkipped, ProviderTimeout } from "../../ai/errors";
import { scrubSecrets } from "../../utils/scrubSecrets";
import { currentRunStatus, loadCellContext } from "../../runner/cellContext";
import { executeCell, type CellOutcome } from "../../runner/executeCell";
import { persistCell } from "../../runner/persistCell";
import { logger } from "../../utils/logger";
import { CELL_BACKOFF_MS } from "../../constants/env";

// A model at its rate limit or concurrency cap is WAITING, not failing: the cell is re-delayed without
// using up an attempt, up to this long after it was enqueued, then it is recorded as an error cell.
const MAX_BUSY_WAIT_MS = 2 * 60 * 60 * 1000;
const busyDelayMs = () => Math.round(CELL_BACKOFF_MS * (1 + Math.random()));

/** Worth another attempt of the whole cell later: busy/timeout/open breaker, or a transient HTTP failure. */
export const isTransient = (error: unknown): boolean =>
    error instanceof ProviderBusy || error instanceof ProviderTimeout || error instanceof ProviderSkipped || isRetryable(error);

/** A short code plus at most 300 characters of the provider message, after the key-pattern scrub. */
export const errorCode = (error: unknown): string => {
    const e = error as Error;
    return `${e?.name ?? "Error"}: ${scrubSecrets(String(e?.message ?? error)).slice(0, 300)}`;
};

export async function processRunCell(job: Job, token?: string) {
    const p = cellPayloadSchema.parse(job.data);
    // Log ids and statuses only, never an input, an output or a prompt.
    return runWithRequestContext({ requestId: p.traceId ?? String(job.id), orgId: p.orgId, runId: p.runId, jobId: String(job.id) }, async () => {
        const status = await currentRunStatus(p.runId);
        if (status === null) throw new UnrecoverableError("Run deleted");
        if (status === "cancelled") {
            await persistCell(p, { status: "skipped", error: "cancelled" });
            return { status: "skipped" };
        }
        const ctx = await loadCellContext(p);
        if (!ctx) throw new UnrecoverableError("Run, variant or example deleted");
        try {
            const outcome = await executeCell(ctx, { complete });
            await persistCell(p, outcome);
            logger.info({ runId: p.runId, validJson: outcome.validJson, overall: outcome.overallScore, latencyMs: outcome.latencyMs }, "cell scored");
            return { status: outcome.status };
        } catch (error) {
            if (error instanceof ProviderBusy && token && Date.now() - job.timestamp < MAX_BUSY_WAIT_MS) {
                await job.moveToDelayed(Date.now() + busyDelayMs(), token);
                throw new DelayedError();
            }
            const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
            if (isTransient(error) && !final) throw error; // BullMQ backoff
            // Final attempt, or an error no retry can fix (400/401/403/404/410, not configured…): record it
            // as an `error` cell and COMPLETE the job, so the run can still finish.
            const outcome: CellOutcome = { status: "error", error: errorCode(error), attempts: job.attemptsMade + 1 };
            await persistCell(p, outcome);
            logger.warn({ runId: p.runId, error: outcome.error }, "cell recorded as error");
            return { status: "error" };
        }
    });
}
