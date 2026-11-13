import { z } from "zod";

// Phase 22. The contract line schemas (resultLineSchema, caseLineSchema) live in run.ts / caseLine.ts and
// mirror the Playbook's importer field by field; this file holds the publish options.

/** POST /orgs/:orgId/runs/:runId/publish */
export const publishSchema = z.object({
    title: z.string().trim().min(1).max(120).optional(),
    includeNotes: z.boolean().default(false),
});
export type PublishBody = z.infer<typeof publishSchema>;

/** r_ + 10 base62 characters (≈ 8 × 10^17 values). Anything else is a 404 without touching the database. */
export const publishedSlugSchema = z.string().regex(/^r_[0-9A-Za-z]{10}$/);
