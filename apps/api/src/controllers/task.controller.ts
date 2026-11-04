import { catchError } from "../utils/errors";
import { CREATED, OK } from "../constants/https";
import { ok } from "../utils/api";
import { createTaskSchema, idSchema, jsonSchemaFor, updateTaskSchema } from "@repo/types";
import { createTask, deleteTask, getTask, listTasks, updateTask } from "../services/task.service";
import { actorOf } from "../utils/actor";

export const listTasksHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await listTasks(req.orgId)));
});

export const createTaskHandler = catchError(async (req, res) => {
    const body = createTaskSchema.parse(req.body);
    const task = await createTask(req.orgId, body, actorOf(req));
    res.status(CREATED).json(ok({ task }));
});

export const getTaskHandler = catchError(async (req, res) => {
    const task = await getTask(idSchema("task id").parse(req.params.taskId));
    res.status(OK).json(ok({ task, jsonSchema: jsonSchemaFor(task.fields) }));
});

export const updateTaskHandler = catchError(async (req, res) => {
    const body = updateTaskSchema.parse(req.body);
    const { task, versionBumped } = await updateTask(req.orgId, idSchema("task id").parse(req.params.taskId), body, actorOf(req));
    // Phase 17: + runsAffected
    res.status(OK).json(ok({ task, versionBumped, version: task.version }));
});

export const deleteTaskHandler = catchError(async (req, res) => {
    await deleteTask(idSchema("task id").parse(req.params.taskId));
    res.status(OK).json(ok({ deleted: true }));
});
