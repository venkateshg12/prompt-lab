import Redis from "ioredis";
import { getRedisConfig } from "../../config/redis";
import { logger } from "../logger";
import type { RunProgress } from "@repo/types";

/*
  Live run progress. Channel `pl:events:<runId>`. Publishing never fails a job: if Redis can't announce
  progress the run still completes, and the page's polling fallback catches up.
 */
const publisher = new Redis(getRedisConfig());
let subscriber: Redis | null = null;
const listeners = new Map<string, Set<(message: RunProgress) => void>>();

const CHANNEL_PREFIX = "pl:events:";

export const publishProgress = (message: Omit<RunProgress, "at">) => {
    const payload: RunProgress = { ...message, at: new Date().toISOString() };
    return publisher.publish(`${CHANNEL_PREFIX}${message.runId}`, JSON.stringify(payload)).catch((err) => {
        logger.warn({ err: (err as Error).message, runId: message.runId }, "Failed to publish run progress");
        return 0;
    });
};

/**
 * Throttled to one message per run per 500 ms (`SET pl:progress:<runId> 1 NX PX 500`), except the final
 * message, which always goes out. 3,000 cells finishing in a minute is not 3,000 browser updates.
 */
export const publishRunProgress = async (message: Omit<RunProgress, "at">) => {
    const final = message.status !== "running" && message.status !== "queued" || message.doneCells >= message.totalCells;
    if (!final) {
        const acquired = await publisher.set(`pl:progress:${message.runId}`, "1", "PX", 500, "NX").catch(() => "OK");
        if (acquired !== "OK") return 0;
    }
    return publishProgress(message);
};

const ensureSubscriber = () => {
    if (subscriber) return;
    // A connection in subscribe mode cannot execute other commands
    subscriber = new Redis(getRedisConfig());
    subscriber.psubscribe(`${CHANNEL_PREFIX}*`, (err) => {
        if (err) logger.error({ err: err.message }, "Redis psubscribe error on pl:events:*");
    });
    subscriber.on("pmessage", (_pattern, channel, raw) => {
        const handlers = listeners.get(channel.slice(CHANNEL_PREFIX.length));
        if (!handlers || handlers.size === 0) return;
        try {
            const message = JSON.parse(raw) as RunProgress;
            for (const handler of handlers) {
                try {
                    handler(message);
                } catch (handlerErr) {
                    logger.warn({ err: (handlerErr as Error).message }, "Error in SSE progress listener");
                }
            }
        } catch (parseErr) {
            logger.warn({ err: (parseErr as Error).message }, "Failed to parse run progress JSON");
        }
    });
};

/** Subscribes an in-memory handler for one run's events. Returns an unregister function. */
export const listen = (runId: string, handler: (m: RunProgress) => void) => {
    ensureSubscriber();
    const set = listeners.get(runId) ?? new Set();
    set.add(handler);
    listeners.set(runId, set);
    return () => {
        set.delete(handler);
        if (set.size === 0) listeners.delete(runId);
    };
};

export const getListenerStats = () => ({
    runCount: listeners.size,
    totalListeners: Array.from(listeners.values()).reduce((sum, s) => sum + s.size, 0),
});

/** Graceful shutdown for pub/sub redis connections. */
export const closePubSub = async () => {
    try {
        if (subscriber) {
            await subscriber.quit();
            subscriber = null;
        }
        await publisher.quit();
    } catch (err) {
        logger.warn({ err: (err as Error).message }, "Error closing Redis pubsub connections");
    }
};
