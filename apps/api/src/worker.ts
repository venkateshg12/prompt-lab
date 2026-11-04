import "dotenv/config";
import http from "node:http";
import { connectDB, disconnectDB, isDbHealthy } from "./config/db";
import { emailWorker } from "./jobs/workers/email.worker";
import { maintenanceWorker } from "./jobs/workers/maintenance.worker";
import { runCellWorker } from "./jobs/workers/runCell.worker";
import { runFinalizeWorker } from "./jobs/workers/runFinalize.worker";
import { closePubSub } from "./utils/events/pubsub";
import { maintenanceQueue } from "./jobs/queues/maintenance.queue";
import { JOB_NAMES } from "./constants/queue";
import { WORKER_PORT } from "./constants/env";
import { logger } from "./utils/logger";
import { redisConnection } from "./jobs/redis/connection";

export const initSchedulers = async () => {
  try {
    // PostgreSQL has no TTL indexes: hourly removal of expired sessions, links, invites.
    await maintenanceQueue.upsertJobScheduler(
      "purge-expired",
      { pattern: "15 * * * *" },
      { name: JOB_NAMES.MAINTENANCE.PURGE_EXPIRED }
    );
    // Runs that stopped progressing (a crash between "run committed" and "cells enqueued"): every 5 minutes.
    await maintenanceQueue.upsertJobScheduler(
      "sweep-stale-runs",
      { every: 5 * 60_000 },
      { name: JOB_NAMES.MAINTENANCE.SWEEP_STALE_RUNS }
    );
    logger.info("Maintenance job schedulers initialized (purge-expired, sweep-stale-runs)");
  } catch (err) {
    logger.error({ err }, "Failed to initialize maintenance job scheduler");
  }
};

/** Stops queue workers from taking new jobs and waits for the ones in flight. */
export const closeWorkers = async () => {
  await Promise.all([emailWorker.close(), maintenanceWorker.close(), runCellWorker.close(), runFinalizeWorker.close()]);
  await closePubSub();
  // Phase 29: await flushObservability();
};

/** A small HTTP server for container health checks when the worker runs as its own process. */
export function createHealthServer(port: number = Number(WORKER_PORT) || 8080): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/health" || url.pathname === "/healthz" || url.pathname === "/") {
      try {
        const dbOk = await isDbHealthy();
        let redisOk = false;
        try {
          redisOk = (await redisConnection.ping()) === "PONG";
        } catch {
          redisOk = false;
        }

        const workersStatus = {
          email: emailWorker.isRunning(),
          maintenance: maintenanceWorker.isRunning(),
          runCell: runCellWorker.isRunning(),
          runFinalize: runFinalizeWorker.isRunning(),
        };
        const healthy = dbOk && redisOk && Object.values(workersStatus).every(Boolean);

        res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: healthy ? "ok" : "degraded",
            service: "promptlab-worker",
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            database: dbOk ? "connected" : "disconnected",
            redis: redisOk ? "connected" : "disconnected",
            workers: workersStatus,
          })
        );
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", error: err.message }));
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });

  server.listen(port, "0.0.0.0", () => {
    logger.info(`Worker health check server listening on 0.0.0.0:${port}`);
  });

  return server;
}

let healthServer: http.Server | null = null;

async function startWorker() {
  await connectDB();
  await initSchedulers();
  healthServer = createHealthServer();
  logger.info("Background worker process initialized (email, maintenance, run-cell, run-finalize)");
}

/*
  This module is imported by the API (index.ts) so one process can serve requests and run jobs, and
  is also started on its own via `pnpm worker`. Only the standalone process connects the database
  and owns the signal handlers: registering them here unconditionally meant that in the API process
  a SIGTERM exited as soon as the workers closed, killing in-flight HTTP requests — possibly
  mid-transaction. When imported, index.ts drives shutdown and calls closeWorkers() itself.
 */
if (require.main === module) {
  startWorker().catch((err) => {
    logger.error({ err }, "Failed to start worker process");
    process.exit(1);
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Closing background workers gracefully...`);
    if (healthServer) {
      healthServer.close();
    }
    const forceExit = setTimeout(() => {
      logger.error("Worker graceful shutdown timed out after 10s, forcing exit");
      process.exit(1);
    }, 10_000);
    forceExit.unref();

    try {
      await closeWorkers();
      await disconnectDB();
      logger.info("Background worker shutdown complete.");
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "Error during worker shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}
