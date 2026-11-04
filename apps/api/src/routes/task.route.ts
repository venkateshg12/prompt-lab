import { Router } from "express";
import requireOrgRole from "../middleware/requireOrgRole";
import {
    createTaskHandler,
    deleteTaskHandler,
    getTaskHandler,
    listTasksHandler,
    updateTaskHandler,
} from "../controllers/task.controller";

// Mounted at /orgs/:orgId/tasks behind org.route's `one` router (authenticated, limited, resolved).
export const taskRouter = Router({ mergeParams: true });
taskRouter.get("/", requireOrgRole("tasks.read"), listTasksHandler);
taskRouter.post("/", requireOrgRole("tasks.manage"), createTaskHandler);
taskRouter.get("/:taskId", requireOrgRole("tasks.read"), getTaskHandler); // + jsonSchema in the response
taskRouter.patch("/:taskId", requireOrgRole("tasks.manage"), updateTaskHandler);
taskRouter.delete("/:taskId", requireOrgRole("tasks.manage"), deleteTaskHandler);
// Phase 12: taskRouter.use("/:taskId/examples", exampleRouter)   Phase 13: prompts
