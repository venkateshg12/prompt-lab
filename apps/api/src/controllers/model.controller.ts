import { z } from "zod";
import { appAssert, catchError } from "../utils/errors";
import { BAD_REQUEST, NOT_FOUND, OK } from "../constants/https";
import { ok } from "../utils/api";
import { getModelByKey, listEnabledModels } from "../services/model.service";
import { modelConfigByKey } from "../config/models.config";
import { isEnabled } from "../ai/enabled";
import { probeModel } from "../services/probe.service";

export const listModelsHandler = catchError(async (_req, res) => {
    res.status(OK).json(ok(await listEnabledModels()));
});

// Platform admin: re-probe one model after a provider update. Same function as probe-structured.ts.
export const probeModelHandler = catchError(async (req, res) => {
    const { modelKey } = z.object({ modelKey: z.string().min(1).max(200) }).parse(req.body);
    const config = modelConfigByKey(modelKey);
    const row = await getModelByKey(modelKey);
    appAssert(config && row, NOT_FOUND, "Unknown model");
    appAssert(isEnabled(config), BAD_REQUEST, "No API key is set for this model's provider");
    res.status(OK).json(ok(await probeModel(config, row)));
});
