import { exportMarkdown, type MarkdownMeta, type MarkdownRow } from "@repo/scoring";

/*
  Phase 30: the README's results block is GENERATED from the published test run, never typed. The
  snapshot (docs/results/<runId>.summary.json) holds exactly the input of exportMarkdown, so CI can
  re-render the block without the production database and fail when the README drifts.
 */
export const START = "<!-- results:start -->";
export const END = "<!-- results:end -->";
export const PLACEHOLDER = "_No published test run yet: `pnpm --filter api readme:update -- --run <id>` fills this from the database._";

export type Snapshot = { runId: string; slug: string | null; publicUrl: string | null; rows: MarkdownRow[]; meta: MarkdownMeta };

export const replaceBetweenMarkers = (readme: string, block: string): string => {
    const a = readme.indexOf(START);
    const b = readme.indexOf(END);
    if (a < 0 || b < a) throw new Error("README results markers missing");
    return `${readme.slice(0, a + START.length)}\n${block}\n${readme.slice(b)}`;
};

export const currentBlock = (readme: string): string => {
    const a = readme.indexOf(START);
    const b = readme.indexOf(END);
    if (a < 0 || b < a) throw new Error("README results markers missing");
    return readme.slice(a + START.length, b).trim();
};

export const renderBlock = (s: Snapshot): string =>
    exportMarkdown(s.rows, s.meta).trimEnd() + (s.publicUrl ? `\n\nEvery mistake behind these numbers: [the published run](${s.publicUrl}).` : "");

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (x: number) => `$${x.toFixed(2)}`;
const overall = (r: MarkdownRow) => r.summary.metrics.overall?.value ?? -1;

/** The numbers the bullet and the post quote, from the snapshot only (one decimal for %, two for $). */
export const headline = (s: Snapshot) => {
    const scored = s.rows.filter((r) => r.summary.metrics.overall);
    if (scored.length === 0) throw new Error("No scored rows in this run");
    const best = [...scored].sort((a, b) => overall(b) - overall(a))[0]!;
    const baseline = scored.find((r) => r.prompt.startsWith("v1-zero-shot@") && r.model === best.model);
    return {
        best,
        baseline: baseline ?? null,
        X: baseline ? pct(overall(baseline)) : null,
        Y: pct(overall(best)),
        Z: best.summary.metrics.valid_json ? pct(best.summary.metrics.valid_json.value) : "n/a",
        C: best.summary.costUsdPer100 == null ? "n/a" : usd(best.summary.costUsdPer100),
        models: [...new Set(scored.map((r) => r.model))],
        examples: s.meta.examples,
    };
};

/** Spec §12's bullet, brackets filled; it never names a provider that wasn't actually run. */
export const resumeBullet = (s: Snapshot): string => {
    const h = headline(s);
    const change = h.X ? `raised field accuracy from ${h.X} to ${h.Y}` : `reached ${h.Y} field accuracy`;
    return `Built Prompt Lab, a TypeScript app (Express, PostgreSQL/Prisma, BullMQ, Next.js) that benchmarks prompts across models on hand-labelled test sets; on a ${h.examples}-example job-posting extraction task, comparing zero-shot, few-shot, chain-of-thought and structured-output prompting ${change} and valid-JSON rate to ${h.Z} at ${h.C} per 100 inputs.`;
};

/** The post's numbers block; the findings are written by hand from "What I learned". */
export const postNumbers = (s: Snapshot): string => {
    const h = headline(s);
    return [
        `Run ${s.runId} (${s.meta.split} split, ${s.meta.examples} examples × ${s.meta.repeats} repeats), models: ${h.models.join(", ")}`,
        `Best row: ${h.best.prompt} on ${h.best.model}: overall ${h.Y}, valid JSON ${h.Z}, ${h.C} per 100 inputs`,
        h.baseline ? `Baseline on the same model: ${h.baseline.prompt}: overall ${h.X}` : "Baseline v1-zero-shot: not in this run",
        s.publicUrl ? `Published run: ${s.publicUrl}` : "Published run: (not published)",
    ].join("\n");
};
