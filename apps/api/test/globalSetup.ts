import "./setupEnv";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { needsDockerRelay, startDockerRelay } from "./helpers/dockerRelay";

let postgresContainer: StartedPostgreSqlContainer | null = null;
let redisContainer: StartedRedisContainer | null = null;

const API_ROOT = path.resolve(import.meta.dirname, "..");

export default async function setup() {
  console.log("\n[globalSetup] Starting Testcontainers for Integration Suite...");
  // WSL2 + Docker Desktop without a /var/run/docker.sock: relay through `docker system dial-stdio` (the
  // Playbook's fix, test/helpers/dockerRelay.ts). CI and a normal Linux/Mac never start it.
  const stopRelay = needsDockerRelay() ? await startDockerRelay() : async () => {};

  try {
    // 1. PostgreSQL, with the committed migrations applied exactly as a deploy applies them. This
    //    also proves the migrations themselves are valid.
    console.log("  - Starting PostgreSQL container...");
    postgresContainer = await new PostgreSqlContainer("postgres:17-alpine")
      .withDatabase("promptlab_test")
      .start();
    process.env.DATABASE_URL = postgresContainer.getConnectionUri();
    console.log("  ✓ PostgreSQL container ready");

    console.log("  - Applying migrations (prisma migrate deploy)...");
    execFileSync(path.join(API_ROOT, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
      cwd: API_ROOT,
      env: process.env,
      stdio: "pipe",
    });
    console.log("  ✓ Migrations applied");

    // 2. Redis (queues, rate limiter and the response cache share it in tests)
    console.log("  - Starting Redis container...");
    redisContainer = await new RedisContainer("redis:7-alpine").start();
    const redisHost = redisContainer.getHost();
    const redisPort = String(redisContainer.getPort());
    process.env.REDIS_HOST = redisHost;
    process.env.REDIS_PORT = redisPort;
    process.env.CACHE_REDIS_HOST = redisHost;
    process.env.CACHE_REDIS_PORT = redisPort;
    console.log(`  ✓ Redis container ready at ${redisHost}:${redisPort}`);
  } catch (error) {
    console.error("[globalSetup] Failed to start testcontainers:", error);
    throw error;
  }

  // Teardown function called once after all integration test files finish
  return async function teardown() {
    console.log("\n[globalSetup] Stopping Testcontainers...");
    if (postgresContainer) {
      await postgresContainer.stop();
      console.log("  ✓ PostgreSQL container stopped");
    }
    if (redisContainer) {
      await redisContainer.stop();
      console.log("  ✓ Redis container stopped");
    }
    await stopRelay();
  };
}
