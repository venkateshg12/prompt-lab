import { prisma } from "../db/prisma";
import { cache } from "../utils/cache";
import { getQueueRedis } from "../config/redis";
import { getDefaultStore } from "../middleware/rateLimiter";

/*
  CLI scripts inherit the services' connections (Prisma, the cache, the queue Redis, the rate-limit
  store behind the RPM budget). Close them all or the process hangs after its work is done.
 */
export const closeAll = () =>
    Promise.allSettled([
        prisma.$disconnect(),
        cache.close(),
        getQueueRedis().quit(),
        (getDefaultStore() as { disconnect?: () => Promise<void> }).disconnect?.(),
    ]);
