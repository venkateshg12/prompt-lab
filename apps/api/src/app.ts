import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { CORS_ORIGIN, NODE_ENV } from "./constants/env";
import { ok } from "./utils/api";
import { notFound } from "./middleware/notFound";
import { errorHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { isDbHealthy } from "./config/db";
import { authRoutes } from "./routes/auth.route";

/*
  Builds the Express app with no side effects: no listen, no DB connection. index.ts runs it;
  the integration tests (Phase 28) call it directly with Supertest.
 */
export const createApp = () => {
    const app = express();

    // First, so even a helmet or CORS rejection carries an id. Phase 06: trust proxy + limiters.
    app.use(requestId);
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
    app.get("/health", async (_req, res) => {
        const dbUp = await isDbHealthy();
        // Phases 06–07: redis and cache are reported here but never gate the status code.
        return res.status(dbUp ? 200 : 503).json(
            ok({ status: dbUp ? "ok" : "degraded", database: dbUp ? "up" : "down" })
        );
    });

    // Routes are registered here, phase by phase.
    app.use("/auth", authRoutes);

    app.use(notFound);
    app.use(errorHandler);
    return app;
};
