import { prisma } from "../db/prisma";
import { logger } from "../utils/logger";

/*
  Opens the pool eagerly so a wrong DATABASE_URL fails at boot, not on the first request. Prisma
  connects lazily otherwise. Schema changes are applied by `prisma migrate deploy` before start,
  never by the app.
 */
export async function connectDB() {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
    logger.info("PostgreSQL connected successfully!");
}

export async function disconnectDB() {
    await prisma.$disconnect();
}

/** For health checks: is the database answering right now? Never throws. */
export async function isDbHealthy(): Promise<boolean> {
    try {
        await prisma.$queryRaw`SELECT 1`;
        return true;
    } catch {
        return false;
    }
}
