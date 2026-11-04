import { createHash } from "node:crypto";

/*
  cell-<runId>-<first 16 hex of sha1(variantId|exampleId|repeat)>. Deterministic, so adding the same cell
  twice is a no-op while the job exists. Dashes only: BullMQ rejects custom ids containing ":".
 */
export const cellJobId = (runId: string, variantId: string, exampleId: string, repeat: number): string =>
    `cell-${runId}-${createHash("sha1").update(`${variantId}|${exampleId}|${repeat}`).digest("hex").slice(0, 16)}`;
