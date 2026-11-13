import { catchError } from "../utils/errors";
import { idSchema, publishSchema } from "@repo/types";
import { OK } from "../constants/https";
import { ok } from "../utils/api";
import { actorOf } from "../utils/actor";
import { listOrgPublished, publishRun, unpublishRun } from "../services/publish.service";

const runId = (req: { params: Record<string, unknown> }) => idSchema("run id").parse(req.params.runId);

export const publishRunHandler = catchError(async (req, res) => {
    const body = publishSchema.parse(req.body ?? {});
    res.status(OK).json(ok(await publishRun(req.orgId, runId(req), body, actorOf(req))));
});

export const unpublishRunHandler = catchError(async (req, res) => {
    res.status(OK).json(ok(await unpublishRun(req.orgId, runId(req), actorOf(req))));
});

export const listOrgPublishedHandler = catchError(async (_req, res) => {
    res.status(OK).json(ok(await listOrgPublished()));
});
