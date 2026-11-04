import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import { CORS_ORIGIN, DEBUG_IP_ENDPOINT, NODE_ENV } from "./constants/env";
import { ok } from "./utils/api";
import { notFound } from "./middleware/notFound";
import { errorHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { isDbHealthy } from "./config/db";
import { cache } from "./utils/cache";
import { extractClientIp, trustProxy } from "./utils/rateLimiter/ipExtractor";
import { visitorIdMiddleware } from "./middleware/visitorId";
import { globalLimiter } from "./config/rateLimiter";
import { authRoutes } from "./routes/auth.route";
import sessionRoutes from "./routes/session.route";

/*
  Builds the Express app with no side effects: no listen, no DB connection. index.ts runs it;
  the integration tests (Phase 28) call it directly with Supertest.
 */
export const createApp = () => {
    const app = express();

    /*
      Trust exactly the proxies the rate limiter trusts, so req.ip and the limiter agree on the client.
     */
    app.set("trust proxy", trustProxy);
    // First middleware, so even a helmet or CORS rejection carries an id.
    app.use(requestId);
    app.use(
        helmet({
            crossOriginResourcePolicy: { policy: "cross-origin" },
            hsts: NODE_ENV === "production" ? undefined : false,
        })
    );

    const corsOrigin = CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
    app.use(
        cors({
            origin: corsOrigin,
            credentials: true,
            // X-Lab-Visitor: the web app's per-browser visitor id (demo fairness key, Phase 06/23).
            // Phase 10 adds X-Org-Id, Phase 23 X-Provider-Key.
            allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Lab-Visitor"],
        })
    );

    // 256 kB covers every JSON request this API takes. The test-set import route (Phase 12)
    // mounts its own larger parser for JSONL/CSV files, so only that route accepts big bodies.
    app.use(express.json({ limit: "256kb" }));
    app.use(cookieParser());
    app.use(visitorIdMiddleware);
    app.use(globalLimiter);

    /*
      Shows how the rate limiter identifies the caller, to check TRUSTED_PROXY_CIDRS on a real deploy.
      Off unless DEBUG_IP_ENDPOINT=true: it echoes proxy headers and reveals which ones are trusted.
      Declared before the routers mounted at "/" for the same reason as /health below.
     */
    if (DEBUG_IP_ENDPOINT === "true") {
        app.get("/debug-ip", (req, res) => {
            const peer = req.socket.remoteAddress;
            res.json(
                ok({
                    resolvedIp: extractClientIp(req),
                    expressReqIp: req.ip,
                    tcpPeer: peer,
                    peerIsTrustedProxy: peer ? trustProxy(peer) : false,
                    visitorId: req.visitorId ?? null,
                    headers: {
                        "cf-connecting-ip": req.headers["cf-connecting-ip"] ?? null,
                        "x-forwarded-for": req.headers["x-forwarded-for"] ?? null,
                        "true-client-ip": req.headers["true-client-ip"] ?? null,
                    },
                })
            );
        });
    }

    /*
      Health first. Routers mounted at "/" that call `router.use(authenticate)` run for every request
      that reaches them, so a route declared after them answers 401 instead of its own response.
      The database check gates the status code; Redis is reported but optional (the cache degrades).
     */
    app.get("/health", async (_req, res) => {
        const [dbUp, redisReady] = await Promise.all([isDbHealthy(), cache.ping()]);
        return res.status(dbUp ? 200 : 503).json(
            ok({
                status: dbUp ? "ok" : "degraded",
                database: dbUp ? "up" : "down",
                redis: redisReady ? "up" : "down",
            })
        );
    });

    // Routes are registered here, phase by phase.
    app.use("/auth", authRoutes);
    app.use("/session", sessionRoutes);

    app.use(notFound);
    app.use(errorHandler);
    return app;
};
