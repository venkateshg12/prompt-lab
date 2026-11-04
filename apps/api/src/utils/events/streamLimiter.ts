import { redisConnection } from "../../jobs/redis/connection";
import { appAssert } from "../errors";
import { TOO_MANY_REQUESTS } from "../../constants/https";

export const MAX_OPEN_STREAMS = 5;

/**
 * Ensures an actor (user ID or API key ID) has not exceeded the maximum concurrent open streams.
 */
export const assertStreamSlot = async (entityId: string | undefined): Promise<void> => {
    if (!entityId) return;
    const key = `pl:sse:slots:${entityId}`;
    const count = await redisConnection.incr(key);
    await redisConnection.expire(key, 3600);

    if (count > MAX_OPEN_STREAMS) {
        await redisConnection.decr(key).catch(() => 0);
        appAssert(
            false,
            TOO_MANY_REQUESTS,
            `Maximum open stream connections reached (${MAX_OPEN_STREAMS}). Close another tab to connect.`
        );
    }
};

/**
 * Decrements the active stream counter on disconnect.
 */
export const releaseStreamSlot = async (entityId: string | undefined): Promise<void> => {
    if (!entityId) return;
    const key = `pl:sse:slots:${entityId}`;
    try {
        const val = await redisConnection.decr(key);
        if (val <= 0) {
            await redisConnection.del(key);
        }
    } catch {
        // Suppress Redis cleanup errors on client disconnect
    }
};
