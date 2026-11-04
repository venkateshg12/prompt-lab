# Phase 18 — Aggregation: the results table, intervals, subsets

## 1. Goal

Turn a run's results into the spec's results table, one row per variant (prompt version × model):
- overall score, per-field accuracy, skills F1 **with precision and recall**, salary accuracy;
- valid-JSON %, schema-valid %, exact-match %;
- **consistency** across repeats, and the per-repeat spread;
- **$ per 100 inputs**, **p50/p95 latency**, output tokens;
- error and skipped counts, never mixed into accuracy;
- a 95 % interval on every rate and mean;
- the same table for any **tag subset** (`?tag=salary_lpa`).

The aggregation is pure (`packages/scoring/src/{stats,aggregate}.ts`), written into
`RunVariant.summary` by `run-finalize`, served by `GET …/runs/:id/summary`, cached in the `runs`
domain, and **numerically identical** to what the Playbook's importer computes from the same result
lines. Re-scoring recomputes everything from stored raw outputs, with no model calls.

## 2. What I will understand after this phase

1. How each metric is defined, precisely enough to defend in an interview.
2. Why errors and skips are excluded from accuracy, but always shown.
3. How consistency is computed, and why it needs canonical answers.
4. Wilson intervals for proportions, a seeded bootstrap for means, and nearest-rank percentiles.
5. Why two codebases computing "the same number" must share definitions, and how a parity test
   enforces it.
6. Why storing raw output makes re-scoring free.

## 3. Prerequisites

Phase 17 done (a completed run with results). Read the Playbook's built importer once:
`@pb-root/apps/site/scripts/import/prompt-lab.ts` and `@pb-root/apps/site/src/lib/data/stats.ts`.

## 4. Files

```
packages/scoring/src/
├── stats.ts                         COPY  @pb-root/apps/site/src/lib/data/stats.ts (wilson, seededRandom, mean, percentile, bootstrapMean, formatValue)
├── aggregate.ts                     NEW   (results → VariantSummary)
└── __tests__/{stats,aggregate,parity}.test.ts   NEW   (parity uses a copy of @pb-root/apps/site/scripts/fixtures/import/run.jsonl)
apps/api/src/
├── services/results.service.ts      NEW   (summary, per-tag summary, results list, staleness)
├── jobs/processors/runFinalize.processor.ts   ADAPT (Phase 17: + write RunVariant.summary, bump runs)
├── jobs/processors/rescore.processor.ts       NEW   (maintenance queue)
├── controllers/results.controller.ts · routes/run.route.ts   NEW / ADAPT
│     GET  /orgs/:orgId/runs/:id/summary?tag=
│     GET  /orgs/:orgId/runs/:id/results?variant=&field=&reason=&failedOnly=&cursor=
│     POST /orgs/:orgId/runs/:id/rescore
├── utils/cache/cache.ts             (Phase 07; uses the `runs` domain)
└── scripts/bench.ts                 ADAPT (prints the same table after a run)
```

`stats.ts` is a COPY from the **built Playbook**, not from PaperTrail: the Playbook importer is the
consumer of these numbers, so its definitions are the ones to match. PaperTrail's
`@pt-api/evals/variance.ts` computes field agreement across repeated runs. It's a useful read for
consistency, but its definitions are invoice-specific and aren't copied.

## 5. Concepts

**Definitions** (per variant; *scored* = results with `status: "scored"`). They match
`@pb-root/apps/site/scripts/import/prompt-lab.ts` exactly:

| Metric (key) | Formula |
| --- | --- |
| `n` | **distinct examples** with at least one scored result |
| `repeats` | max `repeatIndex` + 1 over the variant's results |
| `overall` | mean `overallScore` over **all scored results** (examples × repeats) |
| `<field key>` | mean of that field's score; a missing field score counts as 0 |
| `skills_precision` / `skills_recall` | mean of `fieldDetails.skills.precision` / `.recall` |
| `valid_json` · `schema_valid` · `exact_match` | share of scored results with the flag true |
| `tokens_out_mean` | mean `outputTokens` (missing → 0) |
| `consistency` | among examples with ≥ 2 scored repeats: share whose repeats all have the same `canonicalAnswer` (an invalid-JSON repeat is its own distinct answer). `null` with 1 repeat, shown "n/a" |
| `repeat_spread` | min and max over repeats of that repeat's mean `overall` (`null` with 1 repeat) |
| `costUsdPer100` | Σ `costUsdMicros` ÷ scored count ÷ 1,000,000 × 100 |
| `p50Ms`, `p95Ms` | nearest-rank percentiles of `latencyMs` over scored results with a latency |
| `errors`, `skipped` | counts, never part of the above |

**Intervals, one rule.** A series made only of 0s and 1s gets a **Wilson** interval
(`wilson(k, n)`), anything else a **seeded percentile bootstrap** of the mean (1,000 resamples,
seed 1). The rule looks at the **values**, not the metric name, exactly like the importer's
`interval()`. So if every `overall` in a cell happens to be 0 or 1, both sides switch to Wilson. The
interval is computed over scored *results* (examples × repeats), as the importer does. With repeats,
that understates uncertainty a little, because repeats of one example aren't independent. The README
says so.

**Excluding errors, visibly.** If model B had 40 % of its calls fail with 429 and those counted as
0, B would look bad at extraction when it was really rate-limited. Excluding them silently would hide
that B was unreliable. So they're excluded **and** shown, and a variant with more than 5 % errors gets
a warning badge (`errorRate > 0.05`).

**Consistency needs canonical answers.** Two repeats that differ only in title case or skill order
score identically, so they're the same answer. `canonicalAnswer` (Phase 16) normalises exactly as the
scorers do, computed from `Result.parsedJson`. "Consistent" means "would score identically".

**Subsets.** `?tag=salary_lpa` filters to results whose example carries the tag, then runs the same
`aggregate`. Smaller `n` means a wider interval, and the UI shows both. Subsets are computed, never
stored: they're cheap, and a stored subset would go stale when tags change.

**Parity, enforced.** `parity.test.ts` aggregates the Playbook's own importer fixture
(`run.jsonl`, copied into `__tests__/fixtures/`) and asserts the values and intervals the Playbook's
importer produces for it (hard-coded from one run of its `--dry-run`). If either side changes a
definition, this test or the Playbook's goes red.

**Re-scoring.** Change a synonym (task `version` 2) or fix a label (`Example.revision` +1, which changes
`datasetHash`), and the stored scores are stale. The summary says so (`stale: { rules, labels }`):
`rules` when `task.version !== run.taskVersion`, `labels` when the current dataset hash differs from
`run.datasetHash`. `POST …/rescore` enqueues `rescore-<runId>-<taskVersion>-<hash8>`, which streams
the run's scored results in batches of 500, re-runs `scoreOutput` with the current rules and labels,
updates each row, then sets `run.taskVersion`/`datasetHash` and recomputes the summaries. Thousands of
results take seconds, with zero model calls. `run.taskVersion` therefore always means "the rules these
stored scores were computed with".

**Caching.** `cache.getOrSet(versionedKey(["runs"], \`run-${id}-summary-${tag ?? "all"}\`), fn, ttl)`,
with TTL 3,600 s for a completed run and 10 s while running. Finalize and rescore bump `runs`.
Individual cell writes don't bump: they'd flush the cache thousands of times a minute.

## 6. Steps

### 6.1 `aggregate.ts`

```ts
import { bootstrapMean, mean, percentile, wilson } from "./stats";
import { canonicalAnswer } from "./canonical";

export type Interval = { value: number; ci: readonly [number, number] };
export const interval = (xs: number[]): Interval | null => {
    if (xs.length === 0) return null;
    const binary = xs.every((x) => x === 0 || x === 1);
    return { value: mean(xs), ci: binary ? wilson(xs.filter((x) => x === 1).length, xs.length) : bootstrapMean(xs) };
};

export type ResultLite = {
    exampleId: string; repeat: number; status: "scored" | "error" | "skipped";
    overallScore?: number | null; validJson?: boolean | null; schemaValid?: boolean | null; exactMatch?: boolean | null;
    fieldScores?: { key: string; score: number }[] | null; fieldDetails?: Record<string, { precision?: number; recall?: number }> | null;
    parsedJson?: Record<string, unknown> | null; outputTokens?: number | null; costUsdMicros?: number | null; latencyMs?: number | null;
};

export const aggregateVariant = (rows: ResultLite[], fields: FieldRule[]): VariantSummary => {
    const scored = rows.filter((r) => r.status === "scored");
    const metric = (xs: number[]) => interval(xs);
    const field = (key: string) => scored.map((r) => r.fieldScores?.find((f) => f.key === key)?.score ?? 0);
    const detail = (key: string, part: "precision" | "recall") => scored.flatMap((r) => { const v = r.fieldDetails?.[key]?.[part]; return v == null ? [] : [v]; });

    const byExample = groupBy(scored, (r) => r.exampleId);
    const multi = [...byExample.values()].filter((reps) => reps.length >= 2);
    const consistentFlags = multi.map((reps) => (new Set(reps.map((r) => canonicalAnswer(fields, r.parsedJson ?? null) ?? `__invalid__${r.repeat}`)).size === 1 ? 1 : 0));
    const repeatMeans = [...groupBy(scored, (r) => String(r.repeat)).values()].map((g) => mean(g.map((r) => r.overallScore ?? 0)));
    const latencies = scored.flatMap((r) => (r.latencyMs == null ? [] : [r.latencyMs]));
    const cost = scored.reduce((s, r) => s + (r.costUsdMicros ?? 0), 0);

    return {
        n: byExample.size,
        repeats: rows.length ? Math.max(...rows.map((r) => r.repeat)) + 1 : 0,
        scored: scored.length,
        errors: rows.filter((r) => r.status === "error").length,
        skipped: rows.filter((r) => r.status === "skipped").length,
        metrics: {
            overall: metric(scored.map((r) => r.overallScore ?? 0)),
            valid_json: metric(scored.map((r) => (r.validJson ? 1 : 0))),
            schema_valid: metric(scored.map((r) => (r.schemaValid ? 1 : 0))),
            exact_match: metric(scored.map((r) => (r.exactMatch ? 1 : 0))),
            tokens_out_mean: metric(scored.map((r) => r.outputTokens ?? 0)),
            ...Object.fromEntries(fields.map((f) => [f.key, metric(field(f.key))])),
            ...Object.fromEntries(fields.filter((f) => f.kind === "set_f1").flatMap((f) => [
                [`${f.key}_precision`, metric(detail(f.key, "precision"))],
                [`${f.key}_recall`, metric(detail(f.key, "recall"))],
            ])),
            consistency: multi.length ? metric(consistentFlags) : null,
        },
        repeatSpread: repeatMeans.length >= 2 ? { min: Math.min(...repeatMeans), max: Math.max(...repeatMeans) } : null,
        costUsdPer100: scored.length ? (cost / scored.length / 1_000_000) * 100 : null,
        p50Ms: percentile(latencies, 0.5) ?? null,
        p95Ms: percentile(latencies, 0.95) ?? null,
        errorRate: rows.length ? rows.filter((r) => r.status === "error").length / rows.length : 0,
    };
};
```

A variant whose every cell was skipped (structured on an unsupported model) has `scored: 0` and
every metric `null`. The UI renders "n/a: structured mode unsupported (probed <date>)".

### 6.2 Finalize writes the summaries

```ts
// runFinalize.processor.ts (ADAPT of Phase 17's)
const variants = await prisma.runVariant.findMany({ where: { runId }, include: { promptVersion: true, model: true } });
for (const v of variants) {
    const rows = await prisma.result.findMany({ where: { runId, variantId: v.id }, select: RESULT_LITE_SELECT });
    await prisma.runVariant.update({ where: { id: v.id }, data: { summary: aggregateVariant(rows.map(toLite), task.fields) } });
}
await prisma.run.updateMany({ where: { id: runId, status: "running" }, data: { status: "completed", finishedAt: new Date() } });
await cache.bump("runs");
```

`RESULT_LITE_SELECT` leaves out `rawOutput` and `extractedText`, the large columns. `parsedJson` is
needed for consistency. 3,150 rows of it is a few MB, fine for a finalize job. If runs grow past
~20k cells, switch to a keyset-paged loop over `id`.

### 6.3 The service and endpoints

- `getRunSummary(runId, tag?)`: `tag` absent and run completed → read `RunVariant.summary`. Otherwise
  aggregate on the fly from the (tag-filtered) results. Attach labels (`promptVersion: "key@v"`,
  model label, price and `priceCheckedOn` from `run.pricesSnapshot`), `testReused`, and `stale`.
  Cache as in §5.
- `listResults(runId, { variant, field, reason, failedOnly, cursor })`: the error browser's feed,
  worst first. Order `overallScore asc, id asc`. The cursor is `base64url({ s, id })`, with `where:
  { OR: [{ overallScore: { gt: s } }, { overallScore: s, id: { gt: id } }] }`. `failedOnly` = scored
  with `exactMatch: false`, or `status: error`. `field` + `reason` filter on the JSON array with a
  raw `jsonb` predicate, which must filter on `org_id` itself (raw SQL bypasses the tenant extension):
  ```sql
  … AND r.org_id = $orgId AND EXISTS (SELECT 1 FROM jsonb_array_elements(r.field_scores) f
        WHERE f->>'key' = $field AND f->>'reason' = $reason)
  ```
  Return 50 per page with `meta: { hasMore, nextCursor }`. Never return `parsedJson` for a published
  run whose example has `publicInput: false` (Phase 22 reuses this function with `publicView`).
- `rescore`: admin only; refuses while the run is `running`.

### 6.4 CLI table

`bench.ts` prints, after a run, a Markdown table sorted by overall descending: prompt, model, n,
overall (with interval), skills F1 (P/R), salary, valid JSON, consistency, $/100, p95, errors. The
footer gives price dates and `testReused` when true. The same row formatter is reused by Phase 22's
Markdown export.

## 7. Verify

```bash
pnpm --filter @repo/scoring test -- aggregate parity
# ✓ aggregate: half perfect / half invalid → overall 0.5, valid_json 0.5, exact 0.5, costUsdPer100 hand-computed
# ✓ parity: matches the Playbook importer's numbers for its fixture run
curl -s -b c.txt localhost:5000/orgs/$ORG/runs/$RUN/summary | jq '.data.variants[0] | {n, repeats, overall: .metrics.overall, consistency: .metrics.consistency, p95Ms, errors}'
curl -s -b c.txt "localhost:5000/orgs/$ORG/runs/$RUN/summary?tag=salary_lpa" | jq '.data.variants[0].n'   # smaller n, wider ci
```

1. Fake-provider run scripted half perfect / half invalid JSON → overall 0.5, valid JSON 0.5,
   exact match 0.5, the hand-computed cost per 100.
2. 3 repeats where repeat 2 differs only in skill order → consistency 1; a different salary in
   repeat 3 → that example counts as inconsistent.
3. A variant with error cells shows the count, and its accuracy uses scored cells only.
4. Add a synonym that turns a partial skills score into a full one → `stale.rules: true` → rescore →
   the number changes, `stale` clears, and the logs show zero model calls.
5. Summary twice → the second is a cache hit (debug log); rescore → miss.
6. `bench --out x.jsonl` then the Playbook importer `--dry-run --metrics overall,valid_json,skills`
   on it → its values and intervals equal this summary's, to the last digit.

## 8. Definition of done

- [ ] Every metric matches its definition, and the definitions match the Playbook importer (the parity test).
- [ ] Wilson for 0/1 series, seeded bootstrap otherwise, nearest-rank percentiles: all from the copied `stats.ts`.
- [ ] Errors and skips are separate and visible; `n` and intervals are shown; subsets by tag work.
- [ ] Skills precision and recall are reported next to F1.
- [ ] Re-scoring works from stored raw outputs, with staleness flags; summaries are cached by run status.
- [ ] Commit: `feat: results aggregation, intervals, subsets and re-scoring`.

## 9. Interview angle

*"How do you know prompt B is really better than A?"* The same test set, the same scorer, n and a 95 %
interval next to every number: Wilson for rates, a seeded bootstrap for means. If the intervals
overlap heavily, I say "suggestive, not conclusive". *"And consistency?"* Three repeats per input,
compared as canonical answers, normalised exactly like the scorer, so "different" means "would score
differently". The definitions are shared with my teaching site's importer, and a parity test fails if
either side drifts.
