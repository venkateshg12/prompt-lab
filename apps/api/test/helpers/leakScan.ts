import { Writable } from "node:stream";
import { prisma } from "../../src/db/prisma";
import IORedis from "ioredis";
import { getCacheRedisConfig } from "../../src/config/redis";
import { redisConnection } from "../../src/jobs/redis/connection";
import { setLogDestination } from "../../src/utils/logger";

/** Every (table, column) of a text-like type in the public schema. */
const textColumns = () =>
    prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`;

/** Sends every log line into `lines` (Phase 02's swappable destination). Returns the array. */
export const captureLogs = () => {
    const lines: string[] = [];
    setLogDestination(new Writable({ write(chunk, _enc, cb) { lines.push(String(chunk)); cb(); } }) as never);
    return lines;
};

const scanRedis = async (redis: typeof redisConnection, label: string, needle: string, hits: string[]) => {
    for await (const keys of redis.scanStream({ count: 500 })) {
        for (const key of keys as string[]) {
            if (key.includes(needle)) hits.push(`${label} key ${key}`);
            const type = await redis.type(key);
            const dump =
                type === "string" ? await redis.get(key)
                : type === "hash" ? JSON.stringify(await redis.hgetall(key))
                : type === "list" ? JSON.stringify(await redis.lrange(key, 0, -1))
                : type === "set" ? JSON.stringify(await redis.smembers(key))
                : type === "zset" ? JSON.stringify(await redis.zrange(key, 0, -1))
                : type === "stream" ? JSON.stringify(await redis.xrange(key, "-", "+"))
                : "";
            if (dump?.includes(needle)) hits.push(`${label} value ${key}`);
        }
    }
};

/** Proving a negative: every text/jsonb column, every key and value of BOTH Redis instances, every captured log line. */
export async function leakScan(needle: string, logLines: string[]) {
    const hits: string[] = [];
    for (const { table_name, column_name } of await textColumns()) {
        // Identifiers come from information_schema, not user input; the needle is a bound parameter.
        const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
            `SELECT COUNT(*)::bigint AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE '%' || $1 || '%'`,
            needle
        );
        if (rows[0]!.n > 0n) hits.push(`postgres ${table_name}.${column_name}`);
    }
    await scanRedis(redisConnection, "redis", needle, hits);
    // Its own connection: the app's cache client fails fast (no offline queue) until it has connected.
    const cache = new IORedis({ ...getCacheRedisConfig(), enableOfflineQueue: true, lazyConnect: false });
    try {
        await scanRedis(cache, "cache-redis", needle, hits);
    } finally {
        cache.disconnect();
    }
    logLines.forEach((line, i) => line.includes(needle) && hits.push(`log line ${i}`));
    return hits;
}
