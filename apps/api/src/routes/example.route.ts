import { Router } from "express";
import requireOrgRole from "../middleware/requireOrgRole";
import {
    agreementHandler,
    autoSplitHandler,
    deleteExampleHandler,
    exportExamplesHandler,
    getExampleHandler,
    importExamplesHandler,
    listExamplesHandler,
    secondLabelHandler,
    updateExampleHandler,
} from "../controllers/example.controller";

// /orgs/:orgId/tasks/:taskId/examples, behind org.route's `one` router. The 3 MB body parser for
// /import is mounted in app.ts, before the global parser (which would answer 413 first).
export const exampleRouter = Router({ mergeParams: true });
exampleRouter.get("/", requireOrgRole("tasks.read"), listExamplesHandler); // cursor list
exampleRouter.post("/import", requireOrgRole("examples.manage"), importExamplesHandler);
exampleRouter.post("/split", requireOrgRole("examples.manage"), autoSplitHandler);
exampleRouter.get("/agreement", requireOrgRole("tasks.read"), agreementHandler);
exampleRouter.get("/export.jsonl", requireOrgRole("tasks.read"), exportExamplesHandler); // application/x-ndjson
exampleRouter.get("/:exampleId", requireOrgRole("tasks.read"), getExampleHandler);
exampleRouter.patch("/:exampleId", requireOrgRole("examples.manage"), updateExampleHandler);
exampleRouter.put("/:exampleId/second-label", requireOrgRole("examples.second_label"), secondLabelHandler);
exampleRouter.delete("/:exampleId", requireOrgRole("examples.manage"), deleteExampleHandler);
