import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { runWithRequestContext } from "../utils/requestContext";
import { logger } from "../utils/logger";

const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
    const incoming = req.get("x-request-id");
    const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    const startedAt = process.hrtime.bigint();

    res.setHeader("X-Request-Id", id);

    runWithRequestContext({ requestId: id }, () => {
        // One access-log line per request, written when the response has actually been sent.
        res.on("finish", () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
            logger.info(
                {
                    method: req.method,
                    path: req.originalUrl.split("?")[0],
                    status: res.statusCode,
                    durationMs: Math.round(durationMs),
                },
                "request completed"
            );
        });
        next();
    });
};
