import { Router } from "express";
import { exportMarkdownHandler, exportResultsCsvHandler, exportResultsJsonlHandler, exportSummaryCsvHandler } from "../controllers/export.controller";
import { judgeValidationHandler, listJudgedHandler, setHumanLabelHandler, startJudgeHandler } from "../controllers/judge.controller";
import { listOrgPublishedHandler, publishRunHandler, unpublishRunHandler } from "../controllers/publish.controller";
import requireOrgRole from "../middleware/requireOrgRole";
import { runCreateLimiter } from "../config/rateLimiter";
import {
    cancelRunHandler,
    compareResultsHandler,
    createRunHandler,
    estimateRunHandler,
    getRunHandler,
    listRunsHandler,
    runEventsHandler,
    rescoreRunHandler,
    runResultsHandler,
    runSummaryHandler,
} from "../controllers/run.controller";

// /orgs/:orgId/runs, behind org.route's `one` router (authenticated, limited, resolved to a workspace).
export const runRouter = Router({ mergeParams: true });
runRouter.post("/", requireOrgRole("runs.start"), runCreateLimiter, createRunHandler);
runRouter.post("/estimate", requireOrgRole("runs.start"), estimateRunHandler); // before /:runId
runRouter.get("/", requireOrgRole("runs.read"), listRunsHandler);
runRouter.get("/published", requireOrgRole("runs.read"), listOrgPublishedHandler); // before /:runId
runRouter.get("/:runId", requireOrgRole("runs.read"), getRunHandler);
runRouter.post("/:runId/cancel", requireOrgRole("runs.start"), cancelRunHandler);
runRouter.get("/:runId/events", requireOrgRole("runs.read"), runEventsHandler);
runRouter.get("/:runId/summary", requireOrgRole("runs.read"), runSummaryHandler); // ?tag=
runRouter.get("/:runId/results", requireOrgRole("runs.read"), runResultsHandler); // ?variant&field&reason&tag&failedOnly&cursor
runRouter.get("/:runId/compare", requireOrgRole("runs.read"), compareResultsHandler); // ?example=<ref>&a=<variantId>&b=<variantId>
runRouter.post("/:runId/rescore", requireOrgRole("runs.start"), rescoreRunHandler);

// Phase 22: exports (streamed, attachment) and publishing.
runRouter.get("/:runId/export/results.jsonl", requireOrgRole("runs.read"), exportResultsJsonlHandler);
runRouter.get("/:runId/export/results.csv", requireOrgRole("runs.read"), exportResultsCsvHandler); // ?includeText=true
runRouter.get("/:runId/export/summary.csv", requireOrgRole("runs.read"), exportSummaryCsvHandler);
runRouter.get("/:runId/export/markdown", requireOrgRole("runs.read"), exportMarkdownHandler);
runRouter.post("/:runId/publish", requireOrgRole("runs.publish"), publishRunHandler);
runRouter.delete("/:runId/publish", requireOrgRole("runs.publish"), unpublishRunHandler);

// Phase 26: the LLM judge. Starting one spends the owner's keys (runs.start); human labels are a labeller's job.
runRouter.post("/:runId/judge", requireOrgRole("runs.start"), startJudgeHandler);
runRouter.get("/:runId/judge", requireOrgRole("runs.read"), listJudgedHandler); // ?unlabelledOnly&limit
runRouter.get("/:runId/judge/validation", requireOrgRole("runs.read"), judgeValidationHandler);
runRouter.patch("/:runId/judge/:resultId/human", requireOrgRole("examples.second_label"), setHumanLabelHandler);
