import { z } from "zod";

export const SPLITS = ["dev", "test"] as const;
export type Split = (typeof SPLITS)[number];
export const exampleRefSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
export const tagSchema = z.string().regex(/^[a-z0-9_]{1,40}$/);

/** One line of a case file. EXACTLY the Playbook's promptLabCaseLineSchema, with `expected` required for import. */
export const caseLineSchema = z.object({
    id: exampleRefSchema,
    split: z.enum(SPLITS).optional(), // missing → unassigned until auto-split
    tags: z.array(tagSchema).max(20).default([]),
    input: z.string().min(1).max(20_000),
    expected: z.unknown(), // validated against the task's answer schema in the service
    publicInput: z.boolean().optional(), // extra key; the Playbook's schema strips unknown keys
    notes: z.string().max(2000).optional(),
});
export type CaseLine = z.infer<typeof caseLineSchema>;

export const importExamplesSchema = z.object({
    format: z.enum(["jsonl", "csv"]),
    content: z.string().max(3_000_000),
    dryRun: z.boolean().default(true),
});
export type ImportExamplesBody = z.infer<typeof importExamplesSchema>;

export const listExamplesQuerySchema = z.object({
    split: z.enum(SPLITS).optional(),
    tag: tagSchema.optional(),
    q: z.string().max(100).optional(), // ref or input substring
    cursor: z.string().max(200).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const updateExampleSchema = z.object({
    input: z.string().min(1).max(20_000).optional(),
    expected: z.unknown().optional(),
    split: z.enum(SPLITS).optional(),
    tags: z.array(tagSchema).max(20).optional(),
    publicInput: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
});
export type UpdateExampleBody = z.infer<typeof updateExampleSchema>;

export const autoSplitSchema = z.object({
    devShare: z.number().min(0.05).max(0.95).default(0.3),
    reassign: z.boolean().default(false),
});
export type AutoSplitBody = z.infer<typeof autoSplitSchema>;

export const secondLabelSchema = z.object({ label: z.unknown() });
