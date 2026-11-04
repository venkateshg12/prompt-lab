import { formatValue } from "./stats";
import type { Interval, VariantSummary } from "./aggregate";

export type SummaryRow = { prompt: string; model: string; summary: VariantSummary };

const cell = (m: Interval | null | undefined, n: number): string => {
    if (!m) return "n/a";
    const [lo, hi] = m.ci;
    return `${formatValue(m.value, "pct", n)} (${formatValue(lo, "pct", n)}–${formatValue(hi, "pct", n)})`;
};

/*
  The results table as Markdown: sorted by overall descending, one row per variant. Used by the CLI after a
  run and by Phase 22's export, so the README table and the terminal can never disagree.
 */
export const summaryMarkdown = (rows: SummaryRow[], skillsKey = "skills", salaryKey = "stipend_or_salary"): string => {
    const header = [
        "| Prompt | Model | n | Overall | Skills F1 (P / R) | Salary | Valid JSON | Consistency | $/100 | p95 | Errors |",
        "| --- | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: |",
    ];
    const sorted = [...rows].sort((a, b) => (b.summary.metrics.overall?.value ?? -1) - (a.summary.metrics.overall?.value ?? -1));
    const body = sorted.map(({ prompt, model, summary: s }) => {
        const m = s.metrics;
        const pr = m[`${skillsKey}_precision`];
        const rc = m[`${skillsKey}_recall`];
        const skills = m[skillsKey] ? `${formatValue(m[skillsKey]!.value, "pct", s.n)} (${pr ? formatValue(pr.value, "pct", s.n) : "n/a"} / ${rc ? formatValue(rc.value, "pct", s.n) : "n/a"})` : "n/a";
        const errs = s.errors + s.skipped === 0 ? "0" : `${s.errors}${s.skipped ? ` (+${s.skipped} skipped)` : ""}`;
        return `| ${prompt} | ${model} | ${s.n} | ${cell(m.overall, s.n)} | ${skills} | ${cell(m[salaryKey], s.n)} | ${cell(m.valid_json, s.n)} | ${m.consistency ? cell(m.consistency, s.n) : "n/a"} | ${s.costUsdPer100 == null ? "n/a" : formatValue(s.costUsdPer100, "usd")} | ${s.p95Ms == null ? "n/a" : formatValue(s.p95Ms, "ms")} | ${errs} |`;
    });
    return [...header, ...body].join("\n");
};
