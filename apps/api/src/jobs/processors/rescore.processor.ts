import { Job } from "bullmq";
import { finalizePayloadSchema } from "@repo/types";
import { runWithRequestContext } from "../../utils/requestContext";
import { rescoreRun } from "../../services/results.service";
import { logger } from "../../utils/logger";

// Same payload shape as finalize: { orgId, runId }. Ids only.
export async function processRescoreRun(job: Job) {
    const p = finalizePayloadSchema.parse(job.data);
    return runWithRequestContext({ requestId: String(job.id), orgId: p.orgId, runId: p.runId, jobId: String(job.id) }, async () => {
        const result = await rescoreRun(p.runId);
        logger.info({ runId: p.runId, ...result }, "run re-scored from stored outputs (no model calls)");
        return result;
    });
}
