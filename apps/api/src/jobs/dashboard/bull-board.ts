import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "../queues/email.queue";
import { deadLetterQueue } from "../queues/deadLetter.queue";
import { maintenanceQueue } from "../queues/maintenance.queue";
import { runCellQueue } from "../queues/runCell.queue";
import { runFinalizeQueue } from "../queues/runFinalize.queue";

export function setupBullBoard() {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  createBullBoard({
    queues: [
      new BullMQAdapter(emailQueue),
      new BullMQAdapter(deadLetterQueue),
      new BullMQAdapter(maintenanceQueue),
      new BullMQAdapter(runCellQueue),
      new BullMQAdapter(runFinalizeQueue),
    ],
    serverAdapter,
  });

  return serverAdapter.getRouter();
}
