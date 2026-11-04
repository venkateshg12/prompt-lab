import { randomUUID } from "node:crypto";
import { redisConnection } from "../jobs/redis/connection";
import { DEFAULT_MODEL_LIMIT, LEASE_TTL_MS, LEASE_WAIT_MS, MODEL_LIMITS } from "../constants/llm";
import { ProviderBusy } from "./errors";
import { getDefaultStore } from "../middleware/rateLimiter";
import { logger } from "../utils/logger";

const ACQUIRE_LUA = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
if redis.call("ZCARD", KEYS[1]) < tonumber(ARGV[2]) then
  redis.call("ZADD", KEYS[1], ARGV[3], ARGV[4])
  redis.call("PEXPIRE", KEYS[1], ARGV[5])
  return 1
end
return 0`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let customRedisClient: any = null;

export const setLeaseRedis = (client: any): void => {
  customRedisClient = client;
};

const getRedis = () => customRedisClient || redisConnection;

export const withLease = async <T>(model: string, fn: () => Promise<T>): Promise<T> => {
  const { concurrency } = MODEL_LIMITS[model] ?? DEFAULT_MODEL_LIMIT;
  const key = `llm:leases:${model}`;
  const lease = randomUUID();
  const deadline = Date.now() + LEASE_WAIT_MS;
  const redis = getRedis();

  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    let granted: number | undefined;

    try {
      granted = (await redis.eval(
        ACQUIRE_LUA,
        1,
        key,
        now,
        concurrency,
        now + LEASE_TTL_MS,
        lease,
        LEASE_TTL_MS
      )) as number;
    } catch (err) {
      // Redis unavailable: availability of product beats perfect pacing
      logger.warn({ err, model }, "redis lease eval failed, proceeding without lease");
      return await fn();
    }

    if (granted === 1) {
      break;
    }

    if (Date.now() >= deadline) {
      throw new ProviderBusy(model);
    }

    // Jittered exponential wait capped at 1000ms
    await sleep(Math.random() * Math.min(1000, 100 * 2 ** attempt));
  }

  try {
    return await fn();
  } finally {
    await redis.zrem(key, lease).catch(() => 0);
  }
};

export const assertRpmBudget = async (model: string): Promise<void> => {
  const { rpm } = MODEL_LIMITS[model] ?? DEFAULT_MODEL_LIMIT;
  const store = getDefaultStore();
  try {
    const res = await store.increment(`rl:llm:${model}`, 60_000, rpm);
    if (!res.allowed) {
      throw new ProviderBusy(model);
    }
  } catch (err) {
    if (err instanceof ProviderBusy) throw err;
    // Store failure: fail-open to preserve availability
    logger.warn({ err, model }, "rpm budget check failed, proceeding fail-open");
  }
};

export const getLeasesInUse = async (model: string): Promise<number> => {
  try {
    const redis = getRedis();
    const now = Date.now();
    await redis.zremrangebyscore(`llm:leases:${model}`, "-inf", now);
    return await redis.zcard(`llm:leases:${model}`);
  } catch {
    return 0;
  }
};
