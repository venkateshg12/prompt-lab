import { createRequire } from "node:module";
import path from "node:path";

// The few ioredis calls used here; the real types live in the api workspace.
interface RedisClient {
  connect(): Promise<void>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
  disconnect(): void;
}
type RedisConstructor = new (options: Record<string, unknown>) => RedisClient;

/*
  Clears the rate limiter's COUNTERS (`rl:*`), never its rules. Every spec signs up from 127.0.0.1,
  and the verify-link limiter allows five per five minutes, so a suite of more than five sign-ups would
  lock itself out. A spec that tests the limiter itself simply doesn't call this between its requests.
 */
export async function resetRateLimits(): Promise<void> {
  const apiRequire = createRequire(path.resolve(__dirname, "../../../api/package.json"));
  const Redis = apiRequire("ioredis") as RedisConstructor;
  const redis = new Redis({ host: "127.0.0.1", port: 6379, lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "MATCH", "rl:*", "COUNT", 500);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
  }
}
