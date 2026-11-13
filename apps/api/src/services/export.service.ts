import { once } from "node:events";
import type { Response } from "express";
import { exportMarkdown, type MarkdownMeta, type MarkdownRow } from "@repo/scoring";
import { fieldRulesSchema } from "@repo/types";
import { prisma } from "../db/prisma";
import { appAssert } from "../utils/errors";
import { NOT_FOUND } from "../constants/https";
import { csvLine, csvNumber, csvText, UTF8_BOM } from "../utils/csv";
import { toResultLine } from "../runner/resultLine";
import { getRunSummary, type SummaryResponse } from "./results.service";

const PAGE = 500;

const loadRun = async (runId: string) => {
    const run = await prisma.run.findUnique({ where: { id: runId }, include: { task: true, variants: { include: { promptVersion: true, model: true } } } });
    appAssert(run, NOT_FOUND, "Run not found");
    return run;
};
type LoadedRun = Awaited<ReturnType<typeof loadRun>>;

/* Every result of the run, one keyset page of 500 at a time: a 3,150-cell run never sits in memory as one array. */
async function* resultPages(runId: string) {
    let after: string | undefined;
    for (;;) {
        const page = await prisma.result.findMany({
            where: { runId, ...(after ? { id: { gt: after } } : {}) },
            orderBy: { id: "asc" },
            take: PAGE,
            include: { example: { select: { ref: true, tags: true, input: true } } },
        });
        if (page.length === 0) return;
        yield page;
        after = page[page.length - 1]!.id;
    }
}

/** Writes with backpressure: waits for "drain" whenever the socket buffer is full. */
const write = async (res: Response, chunk: string) => {
    if (!res.write(chunk)) await once(res, "drain");
};

const attachment = (res: Response, type: string, filename: string) => {
    res.setHeader("Content-Type", type);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
};

/** results.jsonl: one Playbook-contract line per cell (playbook-contract.md §1), each validated before it is written. */
export const streamResultLines = async (runId: string, res: Response) => {
    const run = await loadRun(runId);
    const variants = new Map(run.variants.map((v) => [v.id, v]));
    attachment(res, "application/x-ndjson; charset=utf-8", `run-${run.id}.jsonl`);
    for await (const page of resultPages(runId)) {
        for (const r of page) {
            const v = variants.get(r.variantId)!;
            const line = toResultLine({
                runId: run.id, split: run.split, promptKey: v.promptVersion.key, promptVersion: v.promptVersion.version, modelKey: v.model.key,
                exampleRef: r.example.ref, exampleTags: r.example.tags.filter((t) => t !== "_unsplit"), repeatIndex: r.repeatIndex, status: r.status,
                rawOutput: r.rawOutput, validJson: r.validJson, schemaValid: r.schemaValid, exactMatch: r.exactMatch, overallScore: r.overallScore,
                fieldScores: r.fieldScores as { key: string; score: number }[] | null, fieldDetails: r.fieldDetails, inputTokens: r.inputTokens,
                outputTokens: r.outputTokens, costUsdMicros: r.costUsdMicros, latencyMs: r.latencyMs, error: r.error, testReused: run.testReused,
                completedAt: r.completedAt,
            });
            await write(res, JSON.stringify(line) + "\n");
        }
    }
    res.end();
};

/** results.csv: one row per result; inputs and raw outputs only with includeText (they may be third-party postings). */
export const streamResultsCsv = async (runId: string, res: Response, includeText: boolean) => {
    const run = await loadRun(runId);
    const fields = fieldRulesSchema.parse(run.task.fields).map((f) => f.key);
    const variants = new Map(run.variants.map((v) => [v.id, v]));
    attachment(res, "text/csv; charset=utf-8", `run-${run.id}.results.csv`);
    await write(res, UTF8_BOM + csvLine([
        "result_id", "prompt_version", "model_key", "example_id", "tags", "repeat", "status", "valid_json", "schema_valid", "exact_match", "overall",
        ...fields.map((k) => `score_${k}`), "input_tokens", "output_tokens", "cost_usd_micros", "latency_ms", "error", ...(includeText ? ["input", "raw_output"] : []),
    ]));
    const bool = (b: boolean | null) => (b == null ? "" : String(b));
    for await (const page of resultPages(runId)) {
        for (const r of page) {
            const v = variants.get(r.variantId)!;
            const scores = new Map(((r.fieldScores as { key: string; score: number }[] | null) ?? []).map((f) => [f.key, f.score]));
            await write(res, csvLine([
                r.id, csvText(`${v.promptVersion.key}@${v.promptVersion.version}`), csvText(v.model.key), csvText(r.example.ref),
                csvText(r.example.tags.filter((t) => t !== "_unsplit").join(" ")), csvNumber(r.repeatIndex), r.status,
                bool(r.validJson), bool(r.schemaValid), bool(r.exactMatch), csvNumber(r.overallScore),
                ...fields.map((k) => csvNumber(scores.get(k))), csvNumber(r.inputTokens), csvNumber(r.outputTokens), csvNumber(r.costUsdMicros),
                csvNumber(r.latencyMs), csvText(r.error), ...(includeText ? [csvText(r.example.input), csvText(r.rawOutput)] : []),
            ]));
        }
    }
    res.end();
};

const METRIC_ORDER = (fields: string[]) => ["overall", ...fields, "valid_json", "schema_valid", "exact_match", "consistency"];

/** summary.csv: one row per variant, every metric with ci_low / ci_high. */
export const summaryCsv = (s: SummaryResponse, fields: string[]): string => {
    const metrics = METRIC_ORDER(fields);
    const header = ["prompt_version", "technique", "model_key", "n", "repeats", "scored", "errors", "skipped", ...metrics.flatMap((m) => [m, `${m}_ci_low`, `${m}_ci_high`]), "cost_usd_per_100", "p50_ms", "p95_ms"];
    const rows = s.variants.map((v) => {
        const m = v.summary.metrics;
        return csvLine([
            csvText(v.promptVersion), csvText(v.technique), csvText(v.modelKey), csvNumber(v.summary.n), csvNumber(v.summary.repeats), csvNumber(v.summary.scored),
            csvNumber(v.summary.errors), csvNumber(v.summary.skipped),
            ...metrics.flatMap((k) => [csvNumber(m[k]?.value), csvNumber(m[k]?.ci[0]), csvNumber(m[k]?.ci[1])]),
            csvNumber(v.summary.costUsdPer100), csvNumber(v.summary.p50Ms), csvNumber(v.summary.p95Ms),
        ]);
    });
    return UTF8_BOM + csvLine(header) + rows.join("");
};

/* The structured "n/a" reason the table shows, so the Markdown explains the same rows. */
const naReasonOf = (v: SummaryResponse["variants"][number]) =>
    v.technique === "structured" && v.structured !== "supported" ? `${v.modelLabel} has no verified structured output (${v.structured})` : undefined;

type MarkdownRun = Pick<LoadedRun, "id" | "split" | "repeats" | "testReused" | "notes" | "createdAt" | "pricesSnapshot">;

/** exportMarkdown's exact input for a stored run (also the README snapshot, Phase 30). */
export const markdownInput = (s: SummaryResponse, run: MarkdownRun, examples: number): { rows: MarkdownRow[]; meta: MarkdownMeta } => {
    const prices = Object.values(run.pricesSnapshot as Record<string, { priceCheckedOn?: string; priceNote?: string | null }>);
    return {
        rows: s.variants.map((v) => ({ prompt: v.promptVersion, model: v.modelKey, summary: v.summary, naReason: naReasonOf(v) })),
        meta: {
            runId: run.id, split: run.split, examples, repeats: run.repeats, date: run.createdAt.toISOString().slice(0, 10),
            pricesCheckedOn: prices.map((p) => p.priceCheckedOn ?? "").filter(Boolean),
            priceNotes: prices.map((p) => p.priceNote ?? "").filter(Boolean),
            testReused: run.testReused, notes: run.notes,
        },
    };
};

export const markdownOf = (s: SummaryResponse, run: MarkdownRun, examples: number) => {
    const { rows, meta } = markdownInput(s, run, examples);
    return exportMarkdown(rows, meta);
};

export const loadRunForExport = loadRun;

/** The README table for a stored run: the web's "Copy Markdown", `bench --run <id> --markdown` and export-run print this string. */
export const runMarkdown = async (orgId: string, runId: string) => {
    const run = await loadRun(runId);
    const s = await getRunSummary(orgId, runId);
    const examples = await prisma.result.findMany({ where: { runId }, distinct: ["exampleId"], select: { exampleId: true } });
    return markdownOf(s, run, examples.length);
};

export const runSummaryCsv = async (orgId: string, runId: string) => {
    const run = await loadRun(runId);
    return summaryCsv(await getRunSummary(orgId, runId), fieldRulesSchema.parse(run.task.fields).map((f) => f.key));
};
