import { describe, expect, it } from "vitest";
import { exportMarkdown, humanDate } from "../exportMarkdown";
import type { VariantSummary } from "../aggregate";

const iv = (value: number, lo: number, hi: number) => ({ value, ci: [lo, hi] as const });
const summary = (over: Partial<VariantSummary> = {}): VariantSummary => ({
    n: 30, repeats: 3, scored: 90, errors: 0, skipped: 0, errorRate: 0, repeatSpread: null,
    costUsdPer100: 0.031, p50Ms: 900, p95Ms: 2100,
    metrics: { overall: iv(0.712, 0.684, 0.739), valid_json: iv(0.971, 0.9, 1), consistency: iv(0.886, 0.8, 0.95), skills: iv(0.78, 0.7, 0.85), skills_precision: iv(0.8, 0.7, 0.9), skills_recall: iv(0.76, 0.7, 0.8), stipend_or_salary: iv(0.543, 0.4, 0.6) },
    ...over,
});
const meta = { runId: "r_1", split: "test" as const, examples: 30, repeats: 3, date: "2026-11-03", pricesCheckedOn: ["2026-10-24", "2026-10-24"], testReused: false };

describe("exportMarkdown", () => {
    it("is the summary table + a caption with run, split, n, date and price dates", () => {
        const md = exportMarkdown([{ prompt: "v1-zero-shot@1", model: "nvidia:openai/gpt-oss-20b", summary: summary() }], meta);
        const lines = md.split("\n");
        expect(lines[0]).toBe("| Prompt | Model | n | Overall | Skills F1 (P / R) | Salary | Valid JSON | Consistency | $/100 | p95 | Errors |");
        expect(lines[2]).toBe("| v1-zero-shot@1 | nvidia:openai/gpt-oss-20b | 30 | 71% (68%–74%) | 78% (80% / 76%) | 54% (40%–60%) | 97% (90%–100%) | 89% (80%–95%) | $0.0310 | 2.1 s | 0 |");
        expect(md).toContain("*Run r_1 · test split, 30 examples × 3 repeats (n = 90 per row) · 3 Nov 2026 · prices checked 24 Oct 2026*");
        expect(md.endsWith("\n")).toBe(true);
        expect(md).not.toMatch(/^- /m); // no note lines when there is nothing to say
    });

    it("adds every note: test reused, re-scored lines only, n/a rows with their reason, errors", () => {
        const md = exportMarkdown(
            [
                { prompt: "v1@1", model: "m", summary: summary({ errors: 2 }) },
                { prompt: "v4-structured@1", model: "m2", summary: summary({ metrics: { overall: null } }), naReason: "no structured output" },
            ],
            { ...meta, testReused: true, notes: "my private note\nre-scored 2026-11-05 with task v2; changed: jp_017", priceNotes: ["reference host price"] }
        );
        expect(md).toContain("· reference host price*");
        expect(md).toContain("- **Test reused:**");
        expect(md).toContain("- Re-scored from stored outputs (no model calls): 2026-11-05 with task v2; changed: jp_017.");
        expect(md).not.toContain("my private note");
        expect(md).toContain("- v4-structured@1 × m2: n/a (no structured output).");
        expect(md).toContain("- 2 calls failed");
    });

    it("handles one repeat, no price dates, one error and an n/a row without a reason", () => {
        const md = exportMarkdown(
            [{ prompt: "v1@1", model: "m", summary: summary({ errors: 1, metrics: { overall: null } }) }],
            { ...meta, examples: 1, repeats: 1, pricesCheckedOn: [], notes: undefined }
        );
        expect(md).toContain("1 example × 1 repeat (n = 1 per row)");
        expect(md).toContain("prices checked n/a*");
        expect(md).toContain("- v1@1 × m: n/a (nothing scored).");
        expect(md).toContain("- 1 call failed");
    });

    it("formats dates without the clock or a locale", () => {
        expect(humanDate("2026-01-09")).toBe("9 Jan 2026");
        expect(humanDate("2026-12-31T10:00:00Z")).toBe("31 Dec 2026");
        expect(humanDate("garbage")).toBe("garbage");
    });
});
