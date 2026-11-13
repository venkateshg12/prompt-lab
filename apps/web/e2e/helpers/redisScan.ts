import { createRequire } from "node:module";
import path from "node:path";

interface RedisClient {
  connect(): Promise<void>;
  scan(cursor: string, ...args: (string | number)[]): Promise<[string, string[]]>;
  type(key: string): Promise<string>;
  get(key: string): Promise<string | null>;
  hgetall(key: string): Promise<Record<string, string>>;
  lrange(key: string, a: number, b: number): Promise<string[]>;
  zrange(key: string, a: number, b: number): Promise<string[]>;
  smembers(key: string): Promise<string[]>;
  xrange(key: string, a: string, b: string): Promise<[string, string[]][]>;
  disconnect(): void;
}
type RedisConstructor = new (options: Record<string, unknown>) => RedisClient;

/** Every key and value in one Redis instance that contains `needle` (strings, hashes, lists, sets, sorted sets, streams). */
export async function redisFind(needle: string, port = 6379): Promise<string[]> {
  const apiRequire = createRequire(path.resolve(__dirname, "../../../api/package.json"));
  const Redis = apiRequire("ioredis") as RedisConstructor;
  const redis = new Redis({ host: "127.0.0.1", port, lazyConnect: true, maxRetriesPerRequest: 1 });
  const hits: string[] = [];
  try {
    await redis.connect();
    let cursor = "0";
    do {
      const [next, keys] = await redis.scan(cursor, "COUNT", 500);
      cursor = next;
      for (const key of keys) {
        if (key.includes(needle)) hits.push(key);
        const type = await redis.type(key);
        const values =
          type === "string" ? [await redis.get(key)]
          : type === "hash" ? Object.entries(await redis.hgetall(key)).flat()
          : type === "list" ? await redis.lrange(key, 0, -1)
          : type === "set" ? await redis.smembers(key)
          : type === "zset" ? await redis.zrange(key, 0, -1)
          : type === "stream" ? (await redis.xrange(key, "-", "+")).flatMap(([, f]) => f)
          : [];
        if (values.some((v) => v?.includes(needle))) hits.push(`${key} (value)`);
      }
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
  }
  return hits;
}
