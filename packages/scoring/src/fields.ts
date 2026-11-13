import { valueSchemaFor, type FieldRule, type Money } from "@repo/types";
import { normalizeSkill, normalizeText } from "./normalize";
import { scoreMoney } from "./money";

export type Reason =
    | "match"
    | "mismatch"
    | "partial"
    | "missing"
    | "wrong_type"
    | "null_expected"
    | "null_predicted"
    | "currency_mismatch"
    | "out_of_tolerance";
/** `{ key, score }` are binding for the Playbook's importer; `reason` is extra. */
export type FieldScore = { key: string; score: number; reason: Reason };
export type FieldDetail = {
    expected: unknown;
    predicted: unknown;
    normExpected?: unknown;
    normPredicted?: unknown;
    precision?: number;
    recall?: number;
};

export const setScores = (P: Set<string>, E: Set<string>): { precision: number; recall: number; f1: number } => {
    if (P.size === 0 && E.size === 0) return { precision: 1, recall: 1, f1: 1 };
    const hit = [...P].filter((x) => E.has(x)).length;
    const precision = P.size === 0 ? 0 : hit / P.size;
    const recall = E.size === 0 ? 0 : hit / E.size;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { precision, recall, f1 };
};

const done = (key: string, score: number, reason: Reason, detail: FieldDetail): [FieldScore, FieldDetail] => [{ key, score, reason }, detail];

// `null` only equals `null`: a value where null was expected is the "invented it" case.
const nullCase = (key: string, exp: unknown, pred: unknown, base: FieldDetail): [FieldScore, FieldDetail] =>
    exp === null && pred === null
        ? done(key, 1, "match", base)
        : done(key, 0, exp === null ? "null_expected" : "null_predicted", base);

/*
  One field of one answer against its label, by the rule's kind (scoring-rules.md §2).
  A missing key scores 0 even when the label is null: the model didn't follow the schema.
 */
export const scoreField = (
    rule: FieldRule,
    parsed: Record<string, unknown> | null,
    expected: Record<string, unknown>
): [FieldScore, FieldDetail] => {
    const exp = expected[rule.key] ?? null;
    if (!parsed || !(rule.key in parsed)) return done(rule.key, 0, "missing", { expected: exp, predicted: undefined });
    const pred = parsed[rule.key];
    const base: FieldDetail = { expected: exp, predicted: pred };
    if (!valueSchemaFor(rule).safeParse(pred).success) return done(rule.key, 0, "wrong_type", base);

    switch (rule.kind) {
        case "text": {
            if (exp === null || pred === null) return nullCase(rule.key, exp, pred, base);
            const a = normalizeText(pred as string);
            const b = normalizeText(exp as string);
            return done(rule.key, a === b ? 1 : 0, a === b ? "match" : "mismatch", { ...base, normExpected: b, normPredicted: a });
        }
        case "enum": {
            if (rule.nullable && (exp === null || pred === null)) return nullCase(rule.key, exp, pred, base);
            return done(rule.key, pred === exp ? 1 : 0, pred === exp ? "match" : "mismatch", base);
        }
        case "boolean": {
            if (exp === null || pred === null) return nullCase(rule.key, exp, pred, base);
            return done(rule.key, pred === exp ? 1 : 0, pred === exp ? "match" : "mismatch", base);
        }
        case "integer": {
            if (exp === null || pred === null) return nullCase(rule.key, exp, pred, base);
            const ok = Math.abs((pred as number) - (exp as number)) <= rule.tolerance;
            return done(rule.key, ok ? 1 : 0, ok ? "match" : "mismatch", base);
        }
        case "set_f1": {
            const norm = (xs: unknown) => new Set(((xs as string[] | null) ?? []).map((s) => normalizeSkill(s, rule.synonyms)).filter(Boolean));
            const P = norm(pred);
            const E = norm(exp);
            const { precision, recall, f1 } = setScores(P, E);
            const reason: Reason = f1 === 1 ? "match" : f1 === 0 ? "mismatch" : "partial";
            return done(rule.key, f1, reason, {
                ...base,
                normExpected: [...E].sort(),
                normPredicted: [...P].sort(),
                precision,
                recall,
            });
        }
        case "money": {
            const { score, reason } = scoreMoney(pred as Money | null, exp as Money | null, rule.tolerance);
            return done(rule.key, score, reason, base);
        }
    }
};
