import { z } from "zod";
import { idSchema } from "./id";
import { SPLITS } from "./caseLine";

export const MAX_CELLS_PER_RUN = 5000;

export const createRunSchema = z.object({
    taskId: idSchema("task id"),
    promptVersionIds: z.array(idSchema("prompt version id")).min(1).max(20),
    modelKeys: z.array(z.string().min(1).max(200)).min(1).max(10),
    split: z.enum(SPLITS),
    repeats: z.number().int().min(1).max(5).default(1),
    temperature: z.number().min(0).max(1).default(0),
    notes: z.string().max(2000).optional(),
});
export type CreateRun = z.infer<typeof createRunSchema>;

/** A cell job carries ids only: never a prompt, a posting, an output or a key. */
export const cellPayloadSchema = z.object({
    orgId: idSchema("org id"),
    runId: idSchema("run id"),
    variantId: idSchema("variant id"),
    exampleId: idSchema("example id"),
    repeat: z.number().int().min(0),
    traceId: z.string().max(100).optional(),
});
export type CellPayload = z.infer<typeof cellPayloadSchema>;

export const finalizePayloadSchema = z.object({ orgId: idSchema("org id"), runId: idSchema("run id") });
export type FinalizePayload = z.infer<typeof finalizePayloadSchema>;

/*
  One line of `bench --out` and `GET …/export/results.jsonl`: EXACTLY the Playbook's
  promptLabResultLineSchema (docs/reference/playbook-contract.md §1). Extra keys are allowed by the
  contract: Prompt Lab adds tags, fieldDetails, inputTokens, error, testReused. Never remove or rename
  a key of the contract.
 */
export const resultLineSchema = z.object({
    runId: z.string().min(1),
    split: z.enum(SPLITS),
    promptVersion: z.string().min(1),
    modelKey: z.string().min(1),
    exampleId: z.string().min(1),
    repeat: z.number().int().min(0),
    status: z.enum(["scored", "error", "skipped"]),
    rawOutput: z.string().nullish(),
    validJson: z.boolean().nullish(),
    schemaValid: z.boolean().nullish(),
    exactMatch: z.boolean().nullish(),
    overallScore: z.number().min(0).max(1).nullish(),
    fieldScores: z.array(z.object({ key: z.string().min(1), score: z.number().min(0).max(1) })).nullish(),
    outputTokens: z.number().int().min(0).nullish(),
    costUsdMicros: z.number().min(0).nullish(),
    latencyMs: z.number().min(0).nullish(),
    completedAt: z.iso.datetime().nullish(),
});
export type ResultLine = z.infer<typeof resultLineSchema>;

/** Live progress of a run, published over Redis pub/sub and streamed over SSE. */
export const runProgressSchema = z.object({
    runId: z.string(),
    status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    doneCells: z.number().int(),
    errorCells: z.number().int(),
    totalCells: z.number().int(),
    at: z.string(),
});
export type RunProgress = z.infer<typeof runProgressSchema>;
