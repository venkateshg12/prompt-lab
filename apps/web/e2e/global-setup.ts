import { createRequire } from "node:module";
import path from "node:path";

/*
  Clears the rate-limiter counters (`rl:*`) before every run. They live in Redis for up to 30 minutes,
  so repeated local runs, which all sign up from 127.0.0.1, would otherwise hit "Too many attempts"
  on the third attempt. The limiter itself stays on: only its history is reset, never its rules.
  ioredis is borrowed from the api workspace so the web package needs no extra dependency.
 */
// The few ioredis calls used here; the real types live in the api workspace.
interface RedisClient {
  connect(): Promise<void>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  del(...keys: string[]): Promise<number>;
  disconnect(): void;
}
type RedisConstructor = new (options: Record<string, unknown>) => RedisClient;

export default async function globalSetup() {
  const apiRequire = createRequire(path.resolve(__dirname, "../../api/package.json"));
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
