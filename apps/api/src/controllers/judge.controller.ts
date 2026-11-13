import { z } from "zod";
import { catchError } from "../utils/errors";
import { idSchema, judgeHumanSchema, startJudgeSchema } from "@repo/types";
import { OK } from "../constants/https";
import { ok } from "../utils/api";
import { actorOf } from "../utils/actor";
import { judgeValidation, listJudged, setHumanLabel, startJudge } from "../services/judge.service";

const runId = (req: { params: Record<string, unknown> }) => idSchema("run id").parse(req.params.runId);

export const startJudgeHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await startJudge(req.orgId, runId(req), startJudgeSchema.parse(req.body ?? {}), actorOf(req))));
});

export const judgeValidationHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await judgeValidation(runId(req))));
});

export const listJudgedHandler = catchError(async (req, res) => {
    const q = z.object({ unlabelledOnly: z.enum(["true", "false"]).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    res.status(OK).json(ok(await listJudged(runId(req), { unlabelledOnly: q.unlabelledOnly === "true", limit: q.limit })));
});

export const setHumanLabelHandler = catchError(async (req, res) => {
    const { pass } = judgeHumanSchema.parse(req.body);
    res.status(OK).json(ok(await setHumanLabel(runId(req), idSchema("result id").parse(req.params.resultId), pass, req.userId)));
});
