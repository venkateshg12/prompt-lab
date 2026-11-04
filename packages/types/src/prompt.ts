import { z } from "zod";
import { idSchema } from "./id";

export const TECHNIQUES = ["zero_shot", "few_shot", "cot", "structured", "custom"] as const;
export type Technique = (typeof TECHNIQUES)[number];
export const PLACEHOLDERS = ["input", "instructions", "fields", "examples"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];

/*
  Output length follows the technique (Run has no per-prompt options). A CoT answer cut off at 800
  tokens would be measured as "invalid JSON", which is a budget bug, not a technique result.
 */
export const MAX_TOKENS_BY_TECHNIQUE: Record<Technique, number> = {
    zero_shot: 800,
    few_shot: 800,
    structured: 800,
    cot: 2000,
    custom: 1200,
};
export const PLACEHOLDER_RE = /{{\s*([a-zA-Z_]+)\s*}}/g;

const templateText = z
    .string()
    .min(1)
    .max(20_000)
    .superRefine((text, ctx) => {
        for (const m of text.matchAll(PLACEHOLDER_RE)) {
            if (!(PLACEHOLDERS as readonly string[]).includes(m[1]!)) {
                ctx.addIssue({ code: "custom", message: `Unknown placeholder {{${m[1]}}}` });
            }
        }
    });

export const promptKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/); // "v2-few-shot"

export const promptBodySchema = z
    .object({
        key: promptKeySchema,
        technique: z.enum(TECHNIQUES),
        system: templateText,
        template: templateText.refine((t) => /{{\s*input\s*}}/.test(t), "The template must contain {{input}}"),
        fewShotExampleIds: z.array(idSchema("example id")).max(8).default([]),
        notes: z.string().max(4000).nullable().optional(),
    })
    .refine((p) => p.technique !== "few_shot" || p.fewShotExampleIds.length > 0, "few_shot needs examples")
    .refine(
        (p) => p.fewShotExampleIds.length === 0 || /{{\s*examples\s*}}/.test(p.system + p.template),
        "Examples are attached but {{examples}} is not used"
    );
export type PromptBody = z.infer<typeof promptBodySchema>;

export const newVersionSchema = z.object({
    technique: z.enum(TECHNIQUES).optional(),
    system: z.string().optional(),
    template: z.string().optional(),
    fewShotExampleIds: z.array(idSchema("example id")).max(8).optional(),
    notes: z.string().max(4000).nullable().optional(),
});
export type NewVersionBody = z.infer<typeof newVersionSchema>;
export const duplicatePromptSchema = z.object({ key: promptKeySchema });

/** The id every export and every Playbook lesson uses: "v2-few-shot@1". */
export const versionId = (p: { key: string; version: number }) => `${p.key}@${p.version}`;
