import { catchError } from "../utils/errors";
import { CREATED, OK } from "../constants/https";
import { ok } from "../utils/api";
import { duplicatePromptSchema, idSchema, newVersionSchema, promptBodySchema } from "@repo/types";
import { z } from "zod";
import {
    createPrompt,
    duplicatePrompt,
    getPrompt,
    listPrompts,
    newVersion,
    previewPrompt,
    toPromptDto,
    updateDraft,
} from "../services/prompt.service";
import { actorOf } from "../utils/actor";

const taskId = (req: { params: Record<string, unknown> }) => idSchema("task id").parse(req.params.taskId);
const promptId = (req: { params: Record<string, unknown> }) => idSchema("prompt id").parse(req.params.promptId);

export const listPromptsHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await listPrompts(taskId(req))));
});

export const createPromptHandler = catchError(async (req, res) => {
    const body = promptBodySchema.parse(req.body);
    res.status(CREATED).json(ok(toPromptDto(await createPrompt(req.orgId, taskId(req), body, actorOf(req)))));
});

export const getPromptHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(toPromptDto(await getPrompt(taskId(req), promptId(req)))));
});

export const updateDraftHandler = catchError(async (req, res) => {
    const patch = newVersionSchema.parse(req.body);
    res.status(OK).json(ok(toPromptDto(await updateDraft(taskId(req), promptId(req), patch))));
});

export const newVersionHandler = catchError(async (req, res) => {
    const patch = newVersionSchema.parse(req.body ?? {});
    res.status(CREATED).json(ok(toPromptDto(await newVersion(req.orgId, taskId(req), promptId(req), patch, actorOf(req)))));
});

export const duplicateHandler = catchError(async (req, res) => {
    const { key } = duplicatePromptSchema.parse(req.body);
    res.status(CREATED).json(ok(toPromptDto(await duplicatePrompt(req.orgId, taskId(req), promptId(req), key, actorOf(req)))));
});

export const previewHandler = catchError(async (req, res) => {
    const target = z
        .object({ exampleId: idSchema("example id").optional(), exampleRef: z.string().min(1).max(64).optional() })
        .refine((q) => q.exampleId || q.exampleRef, "exampleId or exampleRef is required")
        .parse(req.query);
    res.status(OK).json(ok(await previewPrompt(taskId(req), promptId(req), target)));
});
