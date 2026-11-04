import { OK } from "../constants/https";
import { catchError } from "../utils/errors";
import { ok } from "../utils/api";
import { discardDeadJob, listDead, replayDeadJob } from "../services/dlq.service";

export const listDlqHandler = catchError(async (req, res) => {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    res.status(OK).json(ok(await listDead({ limit, offset })));
});

export const replayDlqHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await replayDeadJob(String(req.params.jobId))));
});

export const discardDlqHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await discardDeadJob(String(req.params.jobId))));
});
