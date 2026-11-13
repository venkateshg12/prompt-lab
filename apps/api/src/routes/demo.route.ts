import { Router } from "express";
import { demoDailyCapLimiter, demoDualLimiter, publicReadLimiter } from "../config/rateLimiter";
import { providerKey } from "../middleware/providerKey";
import { demoOptionsHandler, demoRunHandler } from "../controllers/demo.controller";

// /demo: public (app.ts gives it a 16 kB body limit). Limiters first (they never look at the key), then the key leaves req.headers, then the handler.
export const demoRouter = Router();
demoRouter.get("/runs/:slug/options", publicReadLimiter, demoOptionsHandler);
demoRouter.post("/run", demoDailyCapLimiter, demoDualLimiter, providerKey, demoRunHandler);
