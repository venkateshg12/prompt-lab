import type { FieldRule } from "@repo/types";
import { canonicalAnswer } from "./canonical";
import { bootstrapMean, mean, percentile, wilson } from "./stats";

export type Interval = { value: number; ci: readonly [number, number] };

/*
  One rule for every interval, looking at the VALUES (not the metric name), exactly like the Playbook
  importer's interval(): a series made only of 0s and 1s gets a Wilson interval, anything else a seeded
  percentile bootstrap of the mean. Computed over scored RESULTS (examples × repeats); repeats of one
  example are not independent, so with repeats the interval is slightly optimistic (the README says so).
 */
export const interval = (xs: number[]): Interval | null => {
    if (xs.length === 0) return null;
    const binary = xs.every((x) => x === 0 || x === 1);
    return { value: mean(xs), ci: binary ? wilson(xs.filter((x) => x === 1).length, xs.length) : bootstrapMean(xs) };
};

export type ResultLite = {
    exampleId: string;
    repeat: number;
    status: "scored" | "error" | "skipped";
    overallScore?: number | null;
    validJson?: boolean | null;
    schemaValid?: boolean | null;
    exactMatch?: boolean | null;
    fieldScores?: { key: string; score: number }[] | null;
    fieldDetails?: Record<string, { precision?: number; recall?: number }> | null;
    parsedJson?: Record<string, unknown> | null;
    outputTokens?: number | null;
    costUsdMicros?: number | null;
    latencyMs?: number | null;
};

export type VariantSummary = {
    /** distinct examples with at least one scored result */
    n: number;
    repeats: number;
    scored: number;
    errors: number;
    skipped: number;
    /** overall, valid_json, schema_valid, exact_match, tokens_out_mean, <field key>, <skills>_precision/_recall, consistency */
    metrics: Record<string, Interval | null>;
    repeatSpread: { min: number; max: number } | null;
    costUsdPer100: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    errorRate: number;
};

const groupBy = <T>(xs: T[], key: (x: T) => string): Map<string, T[]> => {
    const m = new Map<string, T[]>();
    for (const x of xs) {
        const k = key(x);
        m.set(k, [...(m.get(k) ?? []), x]);
    }
    return m;
};

/*
  Definitions (scoring-rules.md §3), matching the Playbook importer's, per variant. Accuracy is over
  SCORED results only: errors and skips are counted and shown, never mixed into it (a rate-limited model
  must not look like a bad prompt). A variant with no scored result has every metric null ("n/a").
 */
export const aggregateVariant = (rows: ResultLite[], fields: FieldRule[]): VariantSummary => {
    const scored = rows.filter((r) => r.status === "scored");
    const field = (key: string) => scored.map((r) => r.fieldScores?.find((f) => f.key === key)?.score ?? 0);
    const detail = (key: string, part: "precision" | "recall") =>
        scored.flatMap((r) => {
            const v = r.fieldDetails?.[key]?.[part];
            return v == null ? [] : [v];
        });

    const byExample = groupBy(scored, (r) => r.exampleId);
    const multi = [...byExample.values()].filter((reps) => reps.length >= 2);
    // An invalid-JSON repeat is its own distinct answer, so a model that sometimes breaks JSON is inconsistent.
    const consistentFlags = multi.map((reps) =>
        new Set(reps.map((r) => canonicalAnswer(fields, r.parsedJson ?? null) ?? `__invalid__${r.repeat}`)).size === 1 ? 1 : 0
    );
    const repeatMeans = [...groupBy(scored, (r) => String(r.repeat)).values()].map((g) => mean(g.map((r) => r.overallScore ?? 0)));
    const latencies = scored.flatMap((r) => (r.latencyMs == null ? [] : [r.latencyMs]));
    const cost = scored.reduce((s, r) => s + (r.costUsdMicros ?? 0), 0);
    const errors = rows.filter((r) => r.status === "error").length;

    return {
        n: byExample.size,
        repeats: rows.length ? Math.max(...rows.map((r) => r.repeat)) + 1 : 0,
        scored: scored.length,
        errors,
        skipped: rows.filter((r) => r.status === "skipped").length,
        metrics: {
            overall: interval(scored.map((r) => r.overallScore ?? 0)),
            valid_json: interval(scored.map((r) => (r.validJson ? 1 : 0))),
            schema_valid: interval(scored.map((r) => (r.schemaValid ? 1 : 0))),
            exact_match: interval(scored.map((r) => (r.exactMatch ? 1 : 0))),
            tokens_out_mean: interval(scored.map((r) => r.outputTokens ?? 0)),
            ...Object.fromEntries(fields.map((f) => [f.key, interval(field(f.key))])),
            ...Object.fromEntries(
                fields
                    .filter((f) => f.kind === "set_f1")
                    .flatMap((f) => [
                        [`${f.key}_precision`, interval(detail(f.key, "precision"))],
                        [`${f.key}_recall`, interval(detail(f.key, "recall"))],
                    ])
            ),
            consistency: multi.length ? interval(consistentFlags) : null,
        },
        repeatSpread: repeatMeans.length >= 2 ? { min: Math.min(...repeatMeans), max: Math.max(...repeatMeans) } : null,
        costUsdPer100: scored.length ? (cost / scored.length / 1_000_000) * 100 : null,
        p50Ms: percentile(latencies, 0.5) ?? null,
        p95Ms: percentile(latencies, 0.95) ?? null,
        errorRate: rows.length ? errors / rows.length : 0,
    };
};

/** More than 5 % errored calls earns a warning badge. */
export const HIGH_ERROR_RATE = 0.05;
