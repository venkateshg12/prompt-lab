import { catchError } from "../utils/errors";
import { OK } from "../constants/https";
import { ok } from "../utils/api";
import { listEnabledModels } from "../services/model.service";

export const listModelsHandler = catchError(async (_req, res) => {
    res.status(OK).json(ok(await listEnabledModels()));
});
