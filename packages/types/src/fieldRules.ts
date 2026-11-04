import { z } from "zod";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, "snake_case field name");
const description = z.string().max(500).optional();

export const PERIODS = ["hour", "day", "week", "month", "year"] as const;
export type Period = (typeof PERIODS)[number];
// scoring-rules.md §2: everything is compared as a per-year amount in the same currency.
export const PERIOD_TO_YEAR: Record<Period, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };

export const fieldRuleSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), key, description, nullable: z.boolean().default(true) }),
    z.object({ kind: z.literal("enum"), key, description, values: z.array(z.string().min(1)).min(2).max(30) }),
    z.object({
        kind: z.literal("integer"), key, description,
        nullable: z.boolean().default(true),
        min: z.number().int().optional(),
        max: z.number().int().optional(),
        // scoring-rules.md "Other field kinds": optional absolute tolerance, default 0 (exact).
        tolerance: z.number().int().min(0).default(0),
    }),
    z.object({ kind: z.literal("boolean"), key, description, nullable: z.boolean().default(true) }),
    z.object({
        kind: z.literal("set_f1"), key, description,
        synonyms: z.record(z.string(), z.string()).default({}), // "js" → "javascript", applied to both sides
        maxItems: z.number().int().positive().default(50),
    }),
    z.object({
        kind: z.literal("money"), key, description,
        tolerance: z.number().min(0).max(0.5).default(0.05),
        currencies: z.array(z.string().length(3)).default(["INR", "USD", "EUR", "GBP"]),
    }),
]);
export type FieldRule = z.infer<typeof fieldRuleSchema>;

export const fieldRulesSchema = z
    .array(fieldRuleSchema)
    .min(1)
    .max(40)
    .refine((rules) => new Set(rules.map((r) => r.key)).size === rules.length, "Field keys must be unique");

export const moneySchema = z
    .object({
        min: z.number().nonnegative().nullable(),
        max: z.number().nonnegative().nullable(),
        currency: z.string().length(3),
        period: z.enum(PERIODS),
    })
    .strict()
    .refine((m) => m.min !== null || m.max !== null, "At least one of min/max");
export type Money = z.infer<typeof moneySchema>;

export const valueSchemaFor = (rule: FieldRule): z.ZodType => {
    switch (rule.kind) {
        case "text":
            return rule.nullable ? z.string().nullable() : z.string();
        case "enum":
            return z.enum(rule.values as [string, ...string[]]);
        case "integer": {
            let n = z.number().int();
            if (rule.min !== undefined) n = n.min(rule.min);
            if (rule.max !== undefined) n = n.max(rule.max);
            return rule.nullable ? n.nullable() : n;
        }
        case "boolean":
            return rule.nullable ? z.boolean().nullable() : z.boolean();
        case "set_f1":
            return z.array(z.string()).max(rule.maxItems);
        case "money":
            return moneySchema.nullable();
    }
};

/** The answer's shape: every field present (null where allowed), nothing extra. */
export const answerSchemaFor = (rules: FieldRule[]) =>
    z.object(Object.fromEntries(rules.map((r) => [r.key, valueSchemaFor(r)]))).strict();

const nullNote = (nullable: boolean) => (nullable ? " or null if not stated" : "");

/** The {{fields}} placeholder: one line per field with its type, allowed values, null rule and description. */
export const fieldsList = (rules: FieldRule[]): string =>
    rules
        .map((r) => {
            const d = r.description ? `: ${r.description}` : "";
            switch (r.kind) {
                case "text":
                    return `- ${r.key}: string${nullNote(r.nullable)}${d}`;
                case "enum":
                    return `- ${r.key}: one of ${r.values.map((v) => `"${v}"`).join(", ")}${d}`;
                case "integer":
                    return `- ${r.key}: integer${nullNote(r.nullable)}${d}`;
                case "boolean":
                    return `- ${r.key}: true or false${nullNote(r.nullable)}${d}`;
                case "set_f1":
                    return `- ${r.key}: array of lower-case strings${d}`;
                case "money":
                    return `- ${r.key}: {"min": number|null, "max": number|null, "currency": ISO 4217 code, "period": "hour"|"day"|"week"|"month"|"year"} or null if not stated${d}`;
            }
        })
        .join("\n");

/** JSON Schema of the answer. Phase 15 derives provider-specific variants (strict, Gemini subset). */
export const jsonSchemaFor = (rules: FieldRule[]): Record<string, unknown> => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(answerSchemaFor(rules)) as Record<string, unknown>;
    return schema;
};
