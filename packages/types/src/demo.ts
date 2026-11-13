import { z } from "zod";
import { publishedSlugSchema } from "./export";

/** POST /demo/run (Phase 23): one prompt × one model of a PUBLISHED run, on ≤ 10 of its public dev examples. */
export const demoRunRequestSchema = z.object({
    slug: publishedSlugSchema,
    promptVersion: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,60}@\d{1,6}$/),
    modelKey: z.string().min(3).max(200),
    exampleRefs: z.array(z.string().min(1).max(64)).min(1).max(10).refine((a) => new Set(a).size === a.length, "Each example once"),
});
export type DemoRunRequest = z.infer<typeof demoRunRequestSchema>;

/** Why a demo cell failed: each has its own fixed message (the provider's body never reaches anyone). */
export const demoOutcomes = ["invalid_key", "rate_limited", "timeout", "retired", "provider_error"] as const;
export type DemoOutcome = (typeof demoOutcomes)[number];
