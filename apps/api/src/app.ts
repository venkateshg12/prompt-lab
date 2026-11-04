import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { CORS_ORIGIN, NODE_ENV } from "./constants/env";
import { ok } from "./utils/api";
import { notFound } from "./middleware/notFound";
import { errorHandler } from "./middleware/errorHandler";

/*
  Builds the Express app with no side effects: no listen, no DB connection. index.ts runs it;
  the integration tests (Phase 28) call it directly with Supertest.
 */
export const createApp = () => {
    const app = express();

    // Phase 02: requestId first. Phase 06: trust proxy + limiters.
    app.use(
        helmet({
            crossOriginResourcePolicy: { policy: "cross-origin" },
            hsts: NODE_ENV === "production" ? undefined : false,
        })
    );

    const corsOrigin = CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
    app.use(cors({ origin: corsOrigin, credentials: true }));

    // 256 kB covers every JSON request this API takes. The test-set import route (Phase 12)
    // mounts its own larger parser for JSONL/CSV files, so only that route accepts big bodies.
    app.use(express.json({ limit: "256kb" }));
    app.use(cookieParser());

    // Health first, so routers that call router.use(authenticate) can never shadow it.
    app.get("/health", (_req, res) => {
        // Phase 03: database. Phases 06–07: redis, cache.
        res.status(200).json(ok({ status: "ok" }));
    });

    // Routes are registered here, phase by phase.

    app.use(notFound);
    app.use(errorHandler);
    return app;
};
