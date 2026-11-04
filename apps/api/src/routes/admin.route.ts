import { Router } from "express";
import authenticate from "../middleware/authenticate";
import requireAdmin from "../middleware/requireAdmin";
import { protectedApiLimiter } from "../config/rateLimiter";
import { probeModelHandler } from "../controllers/model.controller";
import { discardDlqHandler, listDlqHandler, replayDlqHandler } from "../controllers/dlq.controller";

// Platform admin only (live role from the database, never the token): /admin/models/probe and /admin/dlq.
export const adminRouter = Router();
adminRouter.use(authenticate, protectedApiLimiter, requireAdmin);
adminRouter.post("/models/probe", probeModelHandler);
adminRouter.get("/dlq", listDlqHandler);
adminRouter.post("/dlq/:jobId/replay", replayDlqHandler);
adminRouter.delete("/dlq/:jobId", discardDlqHandler);
