import express from "express";
import helmet from "helmet";
import cors from "cors";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import {
    CORS_ORIGIN,
    DEBUG_IP_ENDPOINT,
    ENABLE_QUEUE_DASHBOARD,
    NODE_ENV,
    QUEUE_DASHBOARD_PASSWORD,
    QUEUE_DASHBOARD_USER,
} from "./constants/env";
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
import { orgRouter } from "./routes/org.route";
import { publicInviteRouter } from "./routes/invite.route";
import { modelRouter } from "./routes/model.route";
import { adminRouter } from "./routes/admin.route";
import { gmailRoutes } from "./routes/gmail.route";
import { setupBullBoard } from "./jobs/dashboard/bull-board";

/**
 * Basic auth for the queue dashboard. Compared with a timing-safe digest comparison so the
 * credentials can't be recovered a character at a time.
 */
const queueDashboardAuth: express.RequestHandler = (req, res, next) => {
    const header = req.headers.authorization ?? "";
    const [scheme, encoded] = header.split(" ");

    if (scheme === "Basic" && encoded) {
        const [user, password] = Buffer.from(encoded, "base64").toString().split(":");
        if (matchesSecret(user, QUEUE_DASHBOARD_USER) && matchesSecret(password, QUEUE_DASHBOARD_PASSWORD)) {
            return next();
        }
    }

    res.setHeader("WWW-Authenticate", 'Basic realm="Queues"');
    res.status(401).send("Authentication required");
};

// Hashing first keeps the comparison length-independent, since timingSafeEqual throws on a
// length mismatch — which would itself leak the length.
const matchesSecret = (candidate: string | undefined, expected: string): boolean => {
    const a = crypto.createHash("sha256").update(candidate ?? "").digest();
    const b = crypto.createHash("sha256").update(expected).digest();
    return crypto.timingSafeEqual(a, b);
};

/*
  Builds the Express app with no side effects: no listen, no DB connection. index.ts runs it;
  the integration tests (Phase 28) call it directly with Supertest.
 */
export const createApp = () => {
    const app = express();

    const queueDashboardEnabled = ENABLE_QUEUE_DASHBOARD === "true";
    const queueDashboardConfigured =
        Boolean(QUEUE_DASHBOARD_USER) && Boolean(QUEUE_DASHBOARD_PASSWORD);

    if (queueDashboardEnabled && !queueDashboardConfigured) {
        throw new Error(
            "ENABLE_QUEUE_DASHBOARD is true but QUEUE_DASHBOARD_USER/QUEUE_DASHBOARD_PASSWORD are not set"
        );
    }

    // Mounted before requestId, the JSON parser and globalLimiter, as in PaperTrail.
    if (queueDashboardEnabled && queueDashboardConfigured) {
        app.use("/admin/queues", queueDashboardAuth, setupBullBoard());
    }

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
            // X-Org-Id: the web client's selected workspace (Phase 10). Phase 23 adds X-Provider-Key.
            allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id", "X-Lab-Visitor", "X-Org-Id"],
        })
    );

    // 256 kB covers every JSON request this API takes. The test-set import route (Phase 12)
    // mounts its own larger parser for JSONL/CSV files, so only that route accepts big bodies.
    // The test-set import takes files up to 3 MB; its parser is mounted FIRST, because the global one
    // would answer 413 before the route ever ran.
    app.use("/orgs/:orgId/tasks/:taskId/examples/import", express.json({ limit: "3mb" }));
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
    app.use("/orgs", orgRouter);
    app.use("/invites", publicInviteRouter);
    app.use("/models", modelRouter);
    app.use("/admin", adminRouter);

    // The path is fixed by the redirect URI registered with Google (/api/auth/gmail/callback).
    app.use("/api/auth/gmail", gmailRoutes);

    app.use(notFound);
    app.use(errorHandler);
    return app;
};
