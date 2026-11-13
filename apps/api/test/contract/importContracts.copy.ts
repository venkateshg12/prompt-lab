// COPY of the Prompt Lab part of @pb-root/packages/types/src/importContracts.ts (copied 13 Nov 2026).
// The Playbook (the reader) owns this contract. drift.test.ts fails when the two drift apart: update the
// copy, re-run the contract test, and note it in tasks/lessons.md. Everything below the marker is verbatim.
// --- copied from here ---
import { z } from "zod";

/**
 * What the Playbook's importers read (apps/site/scripts/import-*.ts, Phase 06). The source projects
 * export these shapes; the importers parse them with these schemas before touching anything.
 */

/** One line of Prompt Lab's `bench --out <file>.jsonl`: a result document plus the run's labels. */
export const promptLabResultLineSchema = z.object({
    runId: z.string().min(1),
    split: z.enum(["dev", "test"]),
    promptVersion: z.string().min(1), // the frozen version id, e.g. "v2-few-shot@1"
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
export type PromptLabResultLine = z.infer<typeof promptLabResultLineSchema>;

/** One line of a Prompt Lab test set (`cases/<task>/data/*.jsonl`, Prompt Lab Phase 11). */
export const promptLabCaseLineSchema = z.object({
    id: z.string().min(1),
    split: z.enum(["dev", "test"]),
    tags: z.array(z.string()).default([]),
    input: z.string(),
    expected: z.unknown().optional(),
});
export type PromptLabCaseLine = z.infer<typeof promptLabCaseLineSchema>;
