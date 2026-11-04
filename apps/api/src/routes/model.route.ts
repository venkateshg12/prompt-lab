import { Router } from "express";
import authenticate from "../middleware/authenticate";
import { protectedApiLimiter } from "../config/rateLimiter";
import { listModelsHandler } from "../controllers/model.controller";

// GET /models: the registry is global (not tenant-owned), so any signed-in user may read it.
export const modelRouter = Router();
modelRouter.use(authenticate, protectedApiLimiter);
modelRouter.get("/", listModelsHandler);
