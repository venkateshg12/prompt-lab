import { aggregateVariant, scoreOutput, type ResultLite, type VariantSummary } from "@repo/scoring";
import { fieldRulesSchema, type FieldRule } from "@repo/types";
import { prisma, Prisma } from "../db/prisma";
import { cache } from "../utils/cache";
import { appAssert } from "../utils/errors";
import { CONFLICT, NOT_FOUND } from "../constants/https";
import { datasetHashOf } from "../runner/dataset";
import { withTransaction } from "../utils/db/transaction";
import { toRunDto } from "./run.service";
import { publishProgress } from "../utils/events/pubsub";
import { judgeStats } from "./judge.service";
import type { Result } from "../generated/prisma/client";

/* The columns aggregation needs: NOT rawOutput / extractedText, the big ones. */
const LITE_SELECT = {
    variantId: true, exampleId: true, repeatIndex: true, status: true, overallScore: true, validJson: true, schemaValid: true,
    exactMatch: true, fieldScores: true, fieldDetails: true, parsedJson: true, outputTokens: true, costUsdMicros: true, latencyMs: true,
} satisfies Prisma.ResultSelect;
type LiteRow = Prisma.ResultGetPayload<{ select: typeof LITE_SELECT }>;

export const toLite = (r: LiteRow): ResultLite => ({
    exampleId: r.exampleId,
    repeat: r.repeatIndex,
    status: r.status,
    overallScore: r.overallScore,
    validJson: r.validJson,
    schemaValid: r.schemaValid,
    exactMatch: r.exactMatch,
    fieldScores: r.fieldScores as ResultLite["fieldScores"],
    fieldDetails: r.fieldDetails as ResultLite["fieldDetails"],
    parsedJson: r.parsedJson as ResultLite["parsedJson"],
    outputTokens: r.outputTokens,
    costUsdMicros: r.costUsdMicros,
    latencyMs: r.latencyMs,
});

const byVariant = (rows: LiteRow[]) => {
    const m = new Map<string, ResultLite[]>();
    for (const r of rows) m.set(r.variantId, [...(m.get(r.variantId) ?? []), toLite(r)]);
    return m;
};

/** Writes RunVariant.summary for every variant of the run (called by finalize and by rescore). */
export const writeVariantSummaries = async (runId: string, fields: FieldRule[]) => {
    const variants = await prisma.runVariant.findMany({ where: { runId }, select: { id: true } });
    const rows = byVariant(await prisma.result.findMany({ where: { runId }, select: LITE_SELECT }));
    for (const v of variants) {
        await prisma.runVariant.update({ where: { id: v.id }, data: { summary: aggregateVariant(rows.get(v.id) ?? [], fields) as unknown as Prisma.InputJsonValue } });
    }
};

export type SummaryResponse = Awaited<ReturnType<typeof computeSummary>> & { stale: { rules: boolean; labels: boolean }; judge: Awaited<ReturnType<typeof judgeStats>> };

const computeSummary = async (runId: string, tag?: string) => {
    const run = await prisma.run.findUnique({
        where: { id: runId },
        include: {
            task: true,
            variants: { include: { promptVersion: { select: { key: true, version: true, technique: true } }, model: { select: { key: true, label: true, structured: true, structuredProbedAt: true } } } },
        },
    });
    appAssert(run, NOT_FOUND, "Run not found");
    const fields = fieldRulesSchema.parse(run.task.fields);

    // A completed run's stored summaries are the answer for the whole set; a tag subset (or a running
    // run) is aggregated on the fly from the same rows. Subsets are computed, never stored: tags can change.
    const stored = !tag && run.status === "completed" && run.variants.every((v) => v.summary);
    const rows = stored ? null : byVariant(await prisma.result.findMany({ where: { runId, ...(tag ? { example: { tags: { has: tag } } } : {}) }, select: LITE_SELECT }));

    // The run's tags, for the subset picker: every tag on the run's split, the internal "_unsplit" excluded.
    const tagRows = await prisma.example.findMany({ where: { taskId: run.taskId, split: run.split }, select: { tags: true } });
    const tags = [...new Set(tagRows.flatMap((e) => e.tags))].filter((t) => t !== "_unsplit").sort();

    return {
        run: toRunDto(run),
        tag: tag ?? null,
        tags,
        variants: run.variants.map((v) => ({
            variantId: v.id,
            promptVersion: `${v.promptVersion.key}@${v.promptVersion.version}`,
            technique: v.promptVersion.technique,
            modelKey: v.model.key,
            modelLabel: v.model.label,
            structured: v.model.structured,
            structuredProbedAt: v.model.structuredProbedAt,
            price: (run.pricesSnapshot as Record<string, unknown>)[v.model.key] ?? null,
            summary: (stored ? (v.summary as unknown as VariantSummary) : aggregateVariant(rows!.get(v.id) ?? [], fields)),
        })),
    };
};

/*
  The stored scores were computed with these rules and labels; say so when they've moved on. NEVER cached:
  a label edit or a task edit doesn't bump the `runs` domain, so a cached flag would stay false for an hour.
 */
const staleness = async (runId: string) => {
    const run = await prisma.run.findUnique({ where: { id: runId }, include: { task: { select: { version: true } } } });
    appAssert(run, NOT_FOUND, "Run not found");
    const examples = await prisma.example.findMany({ where: { taskId: run.taskId, split: run.split }, select: { ref: true, revision: true } });
    return { rules: run.task.version !== run.taskVersion, labels: datasetHashOf(examples) !== run.datasetHash };
};

/** Cached by run status: an hour once completed, 10 s while it is still moving. Finalize and rescore bump `runs`. */
export const getRunSummary = async (orgId: string, runId: string, tag?: string): Promise<SummaryResponse> => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true } });
    appAssert(run, NOT_FOUND, "Run not found");
    const key = await cache.versionedKey(["runs"], `org:${orgId}:run:${runId}:summary:${tag ?? "*"}`);
    const summary = await cache.getOrSet(key, () => computeSummary(runId, tag), run.status === "completed" ? 3600 : 10);
    // The judge is read live and kept apart from the scores (Phase 26): never part of `overall`.
    return { ...summary, stale: await staleness(runId), judge: await judgeStats(runId) };
};

/* ── The error browser's feed ─────────────────────────────────────────────────────────────────── */

export type ResultsQuery = { variant?: string; field?: string; reason?: string; tag?: string; failedOnly?: boolean; cursor?: string; limit: number };

/*
  Facets for the error browser's chips: failing results of one variant, counted by reason (for the chosen
  field) and by example tag. Raw SQL, so it filters on org_id ITSELF (the tenant extension can't see it).
  Cached 60 s under the `runs` domain; rescore and finalize bump it.
 */
export const resultFacets = async (orgId: string, runId: string, variant: string, field?: string) => {
    const key = await cache.versionedKey(["runs"], `org:${orgId}:run:${runId}:facets:${variant}:${field ?? "*"}`);
    return cache.getOrSet(key, async () => {
        const reasons = field
            ? await prisma.$queryRaw<{ reason: string; n: number }[]>(Prisma.sql`
                SELECT f->>'reason' AS reason, count(*)::int AS n
                FROM results r, jsonb_array_elements(r.field_scores) f
                WHERE r.run_id = ${runId}::uuid AND r.org_id = ${orgId}::uuid AND r.variant_id = ${variant}::uuid
                  AND f->>'key' = ${field} AND (f->>'score')::float < 1
                GROUP BY 1 ORDER BY n DESC, reason`)
            : [];
        const failing = field
            ? Prisma.sql`EXISTS (SELECT 1 FROM jsonb_array_elements(r.field_scores) f WHERE f->>'key' = ${field} AND (f->>'score')::float < 1)`
            : Prisma.sql`(r.status = 'error' OR (r.status = 'scored' AND r.exact_match = false))`;
        const tags = await prisma.$queryRaw<{ tag: string; n: number }[]>(Prisma.sql`
            SELECT t AS tag, count(*)::int AS n
            FROM results r JOIN examples e ON e.id = r.example_id AND e.org_id = ${orgId}::uuid, unnest(e.tags) t
            WHERE r.run_id = ${runId}::uuid AND r.org_id = ${orgId}::uuid AND r.variant_id = ${variant}::uuid
              AND t <> '_unsplit' AND ${failing}
            GROUP BY 1 ORDER BY n DESC, tag`);
        return { reasons, tags };
    }, 60);
};

const encodeCursor = (r: { overallScore: number | null; id: string }) => Buffer.from(JSON.stringify({ s: r.overallScore, id: r.id })).toString("base64url");
const decodeCursor = (raw?: string): { s: number | null; id: string } | null => {
    if (!raw) return null;
    try {
        const v = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
        return typeof v.id === "string" && (v.s === null || typeof v.s === "number") ? v : null;
    } catch {
        return null;
    }
};

/*
  Worst first: error cells (no score), then lowest overall, then by id. Keyset pagination on
  (overallScore asc nulls first, id asc). `field` + `reason` filter on the JSON array with a raw jsonb
  predicate, which must filter on org_id ITSELF (raw SQL bypasses the tenant extension).
 */
export const listResults = async (orgId: string, runId: string, q: ResultsQuery, opts: { publicView?: boolean } = {}) => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { id: true } });
    appAssert(run, NOT_FOUND, "Run not found");

    let idFilter: { id: { in: string[] } } | undefined;
    if (q.field) {
        const ids = q.reason
            ? await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
                SELECT r.id FROM results r
                WHERE r.run_id = ${runId}::uuid AND r.org_id = ${orgId}::uuid
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.field_scores) f WHERE f->>'key' = ${q.field} AND f->>'reason' = ${q.reason})`)
            : await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
                SELECT r.id FROM results r
                WHERE r.run_id = ${runId}::uuid AND r.org_id = ${orgId}::uuid
                  AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.field_scores) f WHERE f->>'key' = ${q.field} AND (f->>'score')::float < 1)`);
        idFilter = { id: { in: ids.map((r) => r.id) } };
    }
    const cursor = decodeCursor(q.cursor);
    const after: Prisma.ResultWhereInput = cursor
        ? cursor.s === null
            ? { OR: [{ overallScore: null, id: { gt: cursor.id } }, { overallScore: { not: null } }] }
            : { OR: [{ overallScore: { gt: cursor.s } }, { overallScore: cursor.s, id: { gt: cursor.id } }] }
        : {};
    const rows = await prisma.result.findMany({
        where: {
            runId,
            ...(q.variant ? { variantId: q.variant } : {}),
            ...(q.tag ? { example: { tags: { has: q.tag } } } : {}),
            ...(q.failedOnly ? { OR: [{ status: "error" }, { status: "scored", exactMatch: false }] } : {}),
            ...idFilter,
            ...(cursor ? { AND: [after] } : {}),
        },
        orderBy: [{ overallScore: { sort: "asc", nulls: "first" } }, { id: "asc" }],
        take: q.limit + 1,
        include: { example: { select: { ref: true, tags: true, input: true, expected: true, publicInput: true } }, variant: { include: { promptVersion: { select: { key: true, version: true } }, model: { select: { key: true } } } } },
    });
    const hasMore = rows.length > q.limit;
    const items = (hasMore ? rows.slice(0, q.limit) : rows).map((r) => {
      /*
        A published page never shows anything derived from an input its owner marked private: not the
        input, not the raw/extracted/parsed output, not the per-field values (a model can echo the posting,
        found by publish.int.test), not the label. Scores and reasons stay: they reveal no text.
       */
      const hidden = Boolean(opts.publicView && !r.example.publicInput);
      return {
        id: r.id,
        variantId: r.variantId,
        promptVersion: `${r.variant.promptVersion.key}@${r.variant.promptVersion.version}`,
        modelKey: r.variant.model.key,
        exampleRef: r.example.ref,
        tags: r.example.tags.filter((t) => t !== "_unsplit"),
        input: hidden ? null : r.example.input,
        inputHidden: hidden,
        expected: hidden ? null : r.example.expected,
        repeat: r.repeatIndex,
        status: r.status,
        rawOutput: hidden ? null : r.rawOutput,
        extractedText: hidden ? null : r.extractedText,
        parsedJson: hidden ? null : r.parsedJson,
        validJson: r.validJson,
        schemaValid: r.schemaValid,
        exactMatch: r.exactMatch,
        overallScore: r.overallScore,
        fieldScores: r.fieldScores,
        fieldDetails: hidden ? null : r.fieldDetails,
        latencyMs: r.latencyMs,
        costUsdMicros: r.costUsdMicros,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        finishReason: r.finishReason,
        attempts: r.attempts,
        error: r.error,
      };
    });
    const last = items[items.length - 1];
    return { items, meta: { hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null } };
};

/* ── Side-by-side: one example, two variants, every repeat ───────────────────────────────────── */

export const compareResults = async (runId: string, exampleRef: string, a: string, b: string) => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { id: true, taskId: true } });
    appAssert(run, NOT_FOUND, "Run not found");
    const example = await prisma.example.findUnique({ where: { taskId_ref: { taskId: run.taskId, ref: exampleRef } }, select: { id: true, ref: true, input: true, expected: true, tags: true } });
    appAssert(example, NOT_FOUND, "Example not found");
    const side = async (variantId: string) => {
        const v = await prisma.runVariant.findFirst({ where: { id: variantId, runId }, include: { promptVersion: { select: { key: true, version: true } }, model: { select: { key: true, label: true } } } });
        appAssert(v, NOT_FOUND, "Variant not found");
        const results = await prisma.result.findMany({
            where: { runId, variantId, exampleId: example.id },
            orderBy: { repeatIndex: "asc" },
            select: { id: true, repeatIndex: true, status: true, rawOutput: true, extractedText: true, parsedJson: true, validJson: true, schemaValid: true, overallScore: true, fieldScores: true, fieldDetails: true, error: true },
        });
        return { variantId, promptVersion: `${v.promptVersion.key}@${v.promptVersion.version}`, modelKey: v.model.key, modelLabel: v.model.label, results };
    };
    return { example: { ...example, tags: example.tags.filter((t) => t !== "_unsplit") }, a: await side(a), b: await side(b) };
};

/* ── Re-scoring: stored raw output + current rules and labels, no model call ─────────────────── */

export const assertRescorable = async (runId: string) => {
    const run = await prisma.run.findUnique({ where: { id: runId }, select: { status: true, taskVersion: true, task: { select: { version: true } } } });
    appAssert(run, NOT_FOUND, "Run not found");
    appAssert(run.status !== "running" && run.status !== "queued", CONFLICT, "Wait for the run to finish before re-scoring it");
    return run;
};

/** Re-runs scoreOutput over every scored result of the run in batches of 500; returns how many rows changed. */
export const rescoreRun = async (runId: string): Promise<{ rescored: number; changed: number }> => {
    const run = await prisma.run.findUnique({ where: { id: runId }, include: { task: true, variants: { include: { promptVersion: { select: { technique: true } } } } } });
    appAssert(run, NOT_FOUND, "Run not found");
    const fields = fieldRulesSchema.parse(run.task.fields);
    const technique = new Map(run.variants.map((v) => [v.id, v.promptVersion.technique]));
    let rescored = 0;
    let changed = 0;
    const changedRefs = new Set<string>();
    let after: string | undefined;
    for (;;) {
        const batch: (Pick<Result, "id" | "variantId" | "rawOutput" | "overallScore"> & { example: { expected: unknown; ref: string } })[] = await prisma.result.findMany({
            where: { runId, status: "scored", rawOutput: { not: null }, ...(after ? { id: { gt: after } } : {}) },
            orderBy: { id: "asc" },
            take: 500,
            select: { id: true, variantId: true, rawOutput: true, overallScore: true, example: { select: { expected: true, ref: true } } },
        });
        if (batch.length === 0) break;
        // One transaction per batch: a crash leaves whole batches done or not, and the job can simply run again.
        await withTransaction(async (tx) => { for (const r of batch) {
            const s = scoreOutput({ rawText: r.rawOutput!, technique: technique.get(r.variantId)!, fields, expected: r.example.expected as Record<string, unknown> });
            await tx.result.update({
                where: { id: r.id },
                data: {
                    extractedText: s.extractedText,
                    parsedJson: (s.parsed ?? Prisma.DbNull) as Prisma.InputJsonValue,
                    validJson: s.validJson, schemaValid: s.schemaValid,
                    fieldScores: s.fieldScores as unknown as Prisma.InputJsonValue,
                    fieldDetails: s.fieldDetails as unknown as Prisma.InputJsonValue,
                    overallScore: s.overallScore, exactMatch: s.exactMatch,
                },
            });
            rescored++;
            if (r.overallScore !== s.overallScore) {
                changed++;
                changedRefs.add(r.example.ref);
            }
        } });
        after = batch[batch.length - 1]!.id;
    }
    // The stored scores now reflect the CURRENT rules and labels: say so on the run, with the refs that moved.
    const examples = await prisma.example.findMany({ where: { taskId: run.taskId, split: run.split }, select: { ref: true, revision: true } });
    const note = `re-scored ${new Date().toISOString().slice(0, 10)} with task v${run.task.version}; changed: ${changedRefs.size ? [...changedRefs].sort().join(", ") : "none"}`;
    await prisma.run.update({
        where: { id: runId },
        data: { taskVersion: run.task.version, datasetHash: datasetHashOf(examples), notes: run.notes ? `${run.notes}\n${note}` : note },
    });
    await writeVariantSummaries(runId, fields);
    await cache.bump("runs", "published");
    const fresh = await prisma.run.findUnique({ where: { id: runId }, select: { status: true, doneCells: true, errorCells: true, totalCells: true } });
    if (fresh) await publishProgress({ runId, ...fresh, rescored: true });
    return { rescored, changed };
};
