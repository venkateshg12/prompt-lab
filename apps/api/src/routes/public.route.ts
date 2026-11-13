import { Router } from "express";
import { publicReadLimiter } from "../config/rateLimiter";
import { getPublicResultsHandler, getPublicRunHandler, listPublicRunsHandler } from "../controllers/public.controller";

// /public: published runs, read-only, no authentication. Cached reads; the limiter only stops scraping loops.
export const publicRouter = Router();
publicRouter.use(publicReadLimiter);
publicRouter.get("/runs", listPublicRunsHandler);
publicRouter.get("/runs/:slug", getPublicRunHandler);
publicRouter.get("/runs/:slug/results", getPublicResultsHandler); // ?variant&field&reason&tag&failedOnly&cursor
