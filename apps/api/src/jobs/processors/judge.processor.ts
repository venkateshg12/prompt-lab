import { Job } from "bullmq";
import { judgePayloadSchema } from "@repo/types";
import { runWithRequestContext } from "../../utils/requestContext";
import { judgeOne } from "../../services/judge.service";

// Ids only in the payload; everything else is read inside the run's workspace scope.
export async function processJudge(job: Job) {
    const p = judgePayloadSchema.parse(job.data);
    return runWithRequestContext({ requestId: String(job.id), orgId: p.orgId, runId: p.runId, jobId: String(job.id) }, () => judgeOne(p));
}
