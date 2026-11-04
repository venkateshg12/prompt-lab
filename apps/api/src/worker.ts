import "dotenv/config";
import { logger } from "./utils/logger";

/*
  The queue workers' entry point. Phase 08 adds the email and maintenance workers, Phase 17 the
  run-cell and run-finalize workers. index.ts imports initSchedulers/closeWorkers when it runs
  them in-process (RUN_WORKERS_IN_API=true).
 */
export const initSchedulers = async () => {};
export const closeWorkers = async () => {};

if (require.main === module) {
    logger.info("worker started (no workers until Phase 08)");
}
