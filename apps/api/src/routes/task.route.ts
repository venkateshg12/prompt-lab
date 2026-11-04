import { Router } from "express";
import requireOrgRole from "../middleware/requireOrgRole";
import {
    createTaskHandler,
    deleteTaskHandler,
    getTaskHandler,
    listTasksHandler,
    updateTaskHandler,
} from "../controllers/task.controller";
import { exampleRouter } from "./example.route";
import { promptRouter } from "./prompt.route";

// Mounted at /orgs/:orgId/tasks behind org.route's `one` router (authenticated, limited, resolved).
export const taskRouter = Router({ mergeParams: true });
taskRouter.get("/", requireOrgRole("tasks.read"), listTasksHandler);
taskRouter.post("/", requireOrgRole("tasks.manage"), createTaskHandler);
taskRouter.get("/:taskId", requireOrgRole("tasks.read"), getTaskHandler); // + jsonSchema in the response
taskRouter.patch("/:taskId", requireOrgRole("tasks.manage"), updateTaskHandler);
taskRouter.delete("/:taskId", requireOrgRole("tasks.manage"), deleteTaskHandler);
taskRouter.use("/:taskId/examples", exampleRouter);
taskRouter.use("/:taskId/prompts", promptRouter);
