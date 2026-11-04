import { Router } from "express";
import requireOrgRole from "../middleware/requireOrgRole";
import { runCreateLimiter } from "../config/rateLimiter";
import {
    cancelRunHandler,
    createRunHandler,
    estimateRunHandler,
    getRunHandler,
    listRunsHandler,
    runEventsHandler,
} from "../controllers/run.controller";

// /orgs/:orgId/runs, behind org.route's `one` router (authenticated, limited, resolved to a workspace).
export const runRouter = Router({ mergeParams: true });
runRouter.post("/", requireOrgRole("runs.start"), runCreateLimiter, createRunHandler);
runRouter.post("/estimate", requireOrgRole("runs.start"), estimateRunHandler); // before /:runId
runRouter.get("/", requireOrgRole("runs.read"), listRunsHandler);
runRouter.get("/:runId", requireOrgRole("runs.read"), getRunHandler);
runRouter.post("/:runId/cancel", requireOrgRole("runs.start"), cancelRunHandler);
runRouter.get("/:runId/events", requireOrgRole("runs.read"), runEventsHandler);
