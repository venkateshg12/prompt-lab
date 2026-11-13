import { catchError } from "../utils/errors";
import { OK } from "../constants/https";
import { ok } from "../utils/api";
import {
    autoSplitSchema,
    idSchema,
    importExamplesSchema,
    listExamplesQuerySchema,
    secondLabelSchema,
    updateExampleSchema,
} from "@repo/types";
import {
    agreement,
    autoSplit,
    deleteExample,
    exportExamples,
    getExample,
    importExamples,
    listExamples,
    setSecondLabel,
    updateExample,
} from "../services/example.service";
import { actorOf } from "../utils/actor";

const taskId = (req: { params: Record<string, unknown> }) => idSchema("task id").parse(req.params.taskId);
const exampleId = (req: { params: Record<string, unknown> }) => idSchema("example id").parse(req.params.exampleId);

export const listExamplesHandler = catchError(async (req, res) => {
    const query = listExamplesQuerySchema.parse(req.query);
    const { items, meta } = await listExamples(taskId(req), query, req.orgRole);
    res.status(OK).json(ok(items, meta));
});

export const getExampleHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await getExample(taskId(req), exampleId(req), req.orgRole)));
});

export const importExamplesHandler = catchError(async (req, res) => {
    const body = importExamplesSchema.parse(req.body);
    res.status(OK).json(ok(await importExamples(req.orgId, taskId(req), body, actorOf(req))));
});

export const autoSplitHandler = catchError(async (req, res) => {
    const body = autoSplitSchema.parse(req.body ?? {});
    res.status(OK).json(ok(await autoSplit(req.orgId, taskId(req), body, actorOf(req))));
});

export const agreementHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await agreement(taskId(req))));
});

export const exportExamplesHandler = catchError(async (req, res) => {
    const split = req.query.split === "dev" || req.query.split === "test" ? req.query.split : undefined;
    const body = await exportExamples(taskId(req), { split, publicOnly: req.query.public === "true" || req.query.publicOnly === "true" });
    res.status(OK).type("application/x-ndjson").send(body);
});

export const updateExampleHandler = catchError(async (req, res) => {
    const body = updateExampleSchema.parse(req.body);
    res.status(OK).json(ok(await updateExample(req.orgId, taskId(req), exampleId(req), body, actorOf(req))));
});

export const secondLabelHandler = catchError(async (req, res) => {
    const { label } = secondLabelSchema.parse(req.body);
    res.status(OK).json(ok(await setSecondLabel(req.orgId, taskId(req), exampleId(req), label, req.userId)));
});

export const deleteExampleHandler = catchError(async (req, res) => {
    await deleteExample(taskId(req), exampleId(req));
    res.status(OK).json(ok({ deleted: true }));
});
