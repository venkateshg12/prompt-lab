import { Router } from "express";
import authenticate from "../middleware/authenticate";
import requireAdmin from "../middleware/requireAdmin";
import { protectedApiLimiter } from "../config/rateLimiter";
import { listModelsHandler, probeModelHandler } from "../controllers/model.controller";

// GET /models: the registry is global (not tenant-owned), so any signed-in user may read it.
export const modelRouter = Router();
modelRouter.use(authenticate, protectedApiLimiter);
modelRouter.get("/", listModelsHandler);

// POST /admin/models/probe: platform admin only (live role from the database, never the token).
export const adminModelRouter = Router();
adminModelRouter.use(authenticate, protectedApiLimiter, requireAdmin);
adminModelRouter.post("/models/probe", probeModelHandler);
