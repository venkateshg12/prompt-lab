import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTaskSchema } from "@repo/types";
import { aggregateVariant, interval, type ResultLite } from "../aggregate";
import { summaryMarkdown } from "../summaryTable";
import { bootstrapMean, formatValue, mean, percentile, seededRandom, wilson } from "../stats";

const task = createTaskSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8")));
const fs = (score: number) => task.fields.map((f) => ({ key: f.key, score }));
const row = (over: Partial<ResultLite> & { exampleId: string }): ResultLite => ({
    repeat: 0, status: "scored", overallScore: 1, validJson: true, schemaValid: true, exactMatch: true, fieldScores: fs(1),
    fieldDetails: { skills: { precision: 1, recall: 1 } }, parsedJson: { title: "x" }, outputTokens: 100, costUsdMicros: 1000, latencyMs: 1000, ...over,
});

describe("stats (copied from the Playbook)", () => {
    it("wilson, mean, percentile (nearest rank), seeded bootstrap", () => {
        expect(wilson(0, 0)).toEqual([0, 0]);
        const [lo, hi] = wilson(5, 10);
        expect(lo).toBeCloseTo(0.2366, 3);
        expect(hi).toBeCloseTo(0.7634, 3);
        expect(mean([])).toBe(0);
        expect(percentile([], 0.5)).toBeUndefined();
        expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
        expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
        expect(bootstrapMean([])).toEqual([0, 0]);
        expect(bootstrapMean([0.2, 0.4, 0.6])).toEqual(bootstrapMean([0.2, 0.4, 0.6])); // seeded: identical every time
        const r = seededRandom(1);
        expect(r()).toBe(seededRandom(1)());
        expect(formatValue(0.456, "pct", 30)).toBe("46%");
        expect(formatValue(0.456, "pct", 100)).toBe("45.6%");
        expect(formatValue(0.0325, "usd")).toBe("$0.0325");
        expect(formatValue(1790, "ms")).toBe("1.8 s");
        expect(formatValue(1234.4, "count")).toMatch(/1,234/);
        expect(formatValue(7, "raw")).toBe("7");
    });
});

describe("interval", () => {
    it("Wilson for a 0/1 series, bootstrap otherwise, null when empty", () => {
        expect(interval([])).toBeNull();
        expect(interval([1, 0, 1, 1])!.ci).toEqual(wilson(3, 4));
        const mixed = interval([0.5, 1, 0.25])!;
        expect(mixed.ci).toEqual(bootstrapMean([0.5, 1, 0.25]));
    });
    it("looks at the values, not the metric: an 'overall' that happens to be all 0/1 gets Wilson", () => {
        expect(interval([1, 1, 0])!.ci).toEqual(wilson(2, 3));
    });
});

describe("aggregateVariant", () => {
    it("half perfect, half invalid JSON → overall 0.5, valid_json 0.5, exact 0.5, hand-computed cost per 100", () => {
        const rows: ResultLite[] = [
            ...[1, 2].map((i) => row({ exampleId: `e${i}` })),
            ...[3, 4].map((i) => row({ exampleId: `e${i}`, overallScore: 0, validJson: false, schemaValid: false, exactMatch: false, fieldScores: fs(0), fieldDetails: null, parsedJson: null, outputTokens: 50 })),
        ];
        const s = aggregateVariant(rows, task.fields);
        expect(s).toMatchObject({ n: 4, repeats: 1, scored: 4, errors: 0, skipped: 0 });
        expect(s.metrics.overall!.value).toBe(0.5);
        expect(s.metrics.valid_json!.value).toBe(0.5);
        expect(s.metrics.exact_match!.value).toBe(0.5);
        expect(s.metrics.tokens_out_mean!.value).toBe(75);
        expect(s.metrics.title!.value).toBe(0.5);
        expect(s.costUsdPer100).toBeCloseTo((4000 / 4 / 1_000_000) * 100, 10); // $0.1 per 100
        expect(s.p50Ms).toBe(1000);
        expect(s.consistency).toBeUndefined();
        expect(s.metrics.consistency).toBeNull(); // one repeat
        expect(s.repeatSpread).toBeNull();
    });
    it("skills precision and recall are reported next to F1 (only results that have them)", () => {
        const s = aggregateVariant(
            [row({ exampleId: "a", fieldDetails: { skills: { precision: 0.5, recall: 1 } } }), row({ exampleId: "b", fieldDetails: { skills: { precision: 1, recall: 0.5 } } }), row({ exampleId: "c", fieldDetails: null })],
            task.fields
        );
        expect(s.metrics.skills_precision!.value).toBeCloseTo(0.75);
        expect(s.metrics.skills_recall!.value).toBeCloseTo(0.75);
    });
    it("errors and skips are counted but excluded from accuracy; an all-error variant is n/a", () => {
        const s = aggregateVariant([row({ exampleId: "a" }), { exampleId: "b", repeat: 0, status: "error" }, { exampleId: "c", repeat: 0, status: "skipped" }], task.fields);
        expect(s).toMatchObject({ n: 1, scored: 1, errors: 1, skipped: 1 });
        expect(s.metrics.overall!.value).toBe(1);
        expect(s.errorRate).toBeCloseTo(1 / 3);
        const none = aggregateVariant([{ exampleId: "a", repeat: 0, status: "skipped" }], task.fields);
        expect(none).toMatchObject({ n: 0, scored: 0, costUsdPer100: null, p50Ms: null, p95Ms: null });
        expect(none.metrics.overall).toBeNull();
        expect(aggregateVariant([], task.fields)).toMatchObject({ repeats: 0, errorRate: 0 });
    });
    it("a scored row with every optional field absent counts as 0 / false everywhere", () => {
        const s = aggregateVariant([{ exampleId: "a", repeat: 0, status: "scored" }], task.fields);
        for (const k of ["overall", "valid_json", "schema_valid", "exact_match", "tokens_out_mean", "title"]) expect(s.metrics[k]!.value).toBe(0);
        expect(s.metrics.skills_precision).toBeNull(); // no result carried a precision: not a fake 0
        expect(s.costUsdPer100).toBe(0);
    });
    it("a missing field score counts as 0; missing tokens count as 0; missing latency is left out", () => {
        const s = aggregateVariant([row({ exampleId: "a", fieldScores: null, outputTokens: null, latencyMs: null })], task.fields);
        expect(s.metrics.title!.value).toBe(0);
        expect(s.metrics.tokens_out_mean!.value).toBe(0);
        expect(s.p95Ms).toBeNull();
    });
    it("consistency: same canonical answer across repeats = consistent; a different salary = inconsistent; broken JSON = its own answer", () => {
        const a = { title: "Dev", skills: ["react", "css"] };
        const reps = (id: string, answers: (Record<string, unknown> | null)[]) =>
            answers.map((parsedJson, repeat) => row({ exampleId: id, repeat, parsedJson, overallScore: parsedJson ? 1 : 0, validJson: parsedJson !== null }));
        const s = aggregateVariant(
            [
                ...reps("same-but-reordered", [a, { title: "dev.", skills: ["CSS", "react"] }, a]), // normalises equal
                ...reps("different-title", [a, { ...a, title: "Other" }, a]),
                ...reps("one-broken", [a, null, a]),
                ...reps("both-broken", [null, null, null]), // invalid repeats are distinct answers
            ],
            task.fields
        );
        expect(s.metrics.consistency!.value).toBe(0.25);
        expect(s.repeats).toBe(3);
        expect(s.repeatSpread).not.toBeNull();
        expect(s.repeatSpread!.min).toBeLessThanOrEqual(s.repeatSpread!.max);
    });
});

describe("summaryMarkdown", () => {
    const s = aggregateVariant([row({ exampleId: "a" }), row({ exampleId: "b", overallScore: 0.5, exactMatch: false })], task.fields);
    const worse = aggregateVariant([row({ exampleId: "a", overallScore: 0.1 }), { exampleId: "b", repeat: 0, status: "error" }, { exampleId: "c", repeat: 0, status: "skipped" }], task.fields);
    it("sorts by overall, shows intervals, cost, p95 and error counts", () => {
        const md = summaryMarkdown([{ prompt: "v-worse@1", model: "m2", summary: worse }, { prompt: "v-better@1", model: "m1", summary: s }]);
        const lines = md.split("\n");
        expect(lines[0]).toContain("| Prompt | Model |");
        expect(lines[2]).toContain("v-better@1");
        expect(lines[3]).toContain("v-worse@1");
        expect(lines[3]).toContain("1 (+1 skipped)");
        expect(lines[2]).toMatch(/\(\d+%–\d+%\)/);
        expect(lines[2]).toContain("1.0 s");
    });
    it("renders n/a for absent metrics, and a plain 0 when nothing went wrong", () => {
        const bare = { n: 1, repeats: 1, scored: 1, errors: 0, skipped: 0, metrics: { overall: { value: 1, ci: [1, 1] as const } }, repeatSpread: null, costUsdPer100: null, p50Ms: null, p95Ms: null, errorRate: 0 };
        const line = summaryMarkdown([{ prompt: "v@1", model: "m", summary: bare }]).split("\n")[2]!;
        expect(line).toContain("| n/a | n/a | n/a | n/a | n/a | n/a | 0 |");
        const noPr = { ...bare, metrics: { ...bare.metrics, skills: { value: 0.5, ci: [0.4, 0.6] as const } } };
        expect(summaryMarkdown([{ prompt: "v@1", model: "m", summary: noPr }]).split("\n")[2]).toContain("50% (n/a / n/a)");
        const noOverall = { ...bare, metrics: {} };
        expect(summaryMarkdown([{ prompt: "a", model: "m", summary: noOverall }, { prompt: "b", model: "m", summary: bare }]).split("\n")[2]).toContain("| b |");
    });
    it("shows consistency when there are repeats, errors without skips, and sorts empty variants last", () => {
        const rep = (id: string, repeat: number) => row({ exampleId: id, repeat, parsedJson: { title: "x" } });
        const withRepeats = aggregateVariant([rep("a", 0), rep("a", 1), { exampleId: "b", repeat: 0, status: "error" }], task.fields);
        const empty = { ...withRepeats, metrics: {} };
        const md = summaryMarkdown([{ prompt: "empty1", model: "m", summary: empty }, { prompt: "full", model: "m", summary: withRepeats }, { prompt: "empty2", model: "m", summary: empty }]).split("\n");
        expect(md[2]).toContain("| full |");
        expect(md[2]).toMatch(/\| 1 \|$/); // one error, no skips
        expect(md[2]).not.toContain("| n/a | $"); // consistency is shown, not n/a
        expect(md[3]).toContain("empty");
    });
    it("renders n/a for a variant with nothing scored", () => {
        const none = aggregateVariant([{ exampleId: "a", repeat: 0, status: "skipped" }], task.fields);
        const md = summaryMarkdown([{ prompt: "v@1", model: "m", summary: none }]);
        expect(md.split("\n")[2]).toContain("n/a");
    });
});
