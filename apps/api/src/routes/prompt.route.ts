import { Router } from "express";
import requireOrgRole from "../middleware/requireOrgRole";
import {
    createPromptHandler,
    duplicateHandler,
    getPromptHandler,
    listPromptsHandler,
    newVersionHandler,
    previewHandler,
    updateDraftHandler,
} from "../controllers/prompt.controller";

// /orgs/:orgId/tasks/:taskId/prompts, behind org.route's `one` router (authenticated, limited, resolved).
export const promptRouter = Router({ mergeParams: true });
promptRouter.get("/", requireOrgRole("tasks.read"), listPromptsHandler);
promptRouter.post("/", requireOrgRole("prompts.manage"), createPromptHandler);
promptRouter.get("/:promptId", requireOrgRole("tasks.read"), getPromptHandler);
promptRouter.patch("/:promptId", requireOrgRole("prompts.manage"), updateDraftHandler);
promptRouter.post("/:promptId/versions", requireOrgRole("prompts.manage"), newVersionHandler);
promptRouter.post("/:promptId/duplicate", requireOrgRole("prompts.manage"), duplicateHandler);
promptRouter.get("/:promptId/preview", requireOrgRole("tasks.read"), previewHandler); // ?exampleId=
