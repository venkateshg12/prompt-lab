# Phase 17 — Aggregation: the results table numbers

## 1. Goal

Turn a run's results into the spec's results table, one row per prompt × model:
- overall score, per-field accuracy, skills F1, salary accuracy;
- valid JSON %, schema-valid %, exact match %;
- **consistency** across repeats;
- **$ per 100 inputs**, **p50 / p95 latency**;
- error and skipped counts.

It's a **pure** aggregation (`@repo/scoring/aggregate.ts`) shared by the API and the CLI, cached by
run status, plus a **re-score** job that recomputes every result from its stored raw output when rules
or labels change. Re-scoring makes no model calls.

## 2. What I will understand after this phase

1. How each metric is defined, precisely enough to defend.
2. Why error cells are excluded from accuracy but reported.
3. How consistency is computed, and why it needs canonical answers.
4. Nearest-rank percentiles, and why p95 needs enough samples.
5. Why storing raw output makes re-scoring free.

## 3. Prerequisites

Phase 16 done (a completed run).

## 4. Files

```
packages/scoring/src/
├── stats.ts              NEW   (mean, percentile)
├── aggregate.ts          NEW   (results → rows)
apps/api/src/
├── services/results.service.ts      NEW   (load projection, aggregate, cache; staleness)
├── jobs/processors/rescore.processor.ts   NEW
├── routes/run.route.ts              ADAPT (+ GET /runs/:id/summary, POST /runs/:id/rescore)
└── scripts/bench.ts                 ADAPT (prints the same table)
```

## 5. Concepts

**Definitions** (per prompt × model; "scored" = results with `status: "scored"`):

| Metric | Formula |
| --- | --- |
| overall | mean `overallScore` over scored results (every example × repeat) |
| field accuracy (per key) | mean of that key's `score` over scored results |
| skills F1 / salary accuracy | the field accuracy of `skills` / `stipend_or_salary` (named columns for the case study) |
| valid JSON % | scored results with `validJson` ÷ scored |
| schema valid % | `schemaValid` ÷ scored |
| exact match % | `exactMatch` ÷ scored |
| consistency | among examples with ≥ 2 scored repeats: the share whose repeats all share one `canonicalAnswer` (an invalid-JSON repeat counts as its own distinct answer) |
| $ / 100 inputs | Σ `costUsdMicros` ÷ scored × 100, displayed in dollars |
| p50 / p95 latency | nearest-rank percentiles of `latencyMs` over scored results |
| errors / skipped | counts, never mixed into the above |
| n | scored results, shown in the table so small samples are visible |

**Excluding errors, visibly.** If model B had 40 % of its calls fail with 429 and those counted as
0, B would look bad at extraction when it was really rate-limited. Excluding them silently would
inflate B instead. So they're excluded **and** shown in their own column, and a row with > 5 % errors
gets a warning badge.

**Consistency needs canonical answers.** Two repeats that differ only in title case or skill order
are the *same* answer for every scorer. Comparing raw text would call them inconsistent. Phase 15's
`canonicalAnswer` normalises exactly as the scorers do, so "consistent" means "would score
identically". With `repeats: 1`, consistency is "n/a", not 100 %.

**Percentiles.** Nearest-rank: sort, take the value at `ceil(p × n) − 1`. p95 of 30 samples is
roughly "the second-worst". Show `n` next to it, and the README states sample sizes.

**Re-scoring.** Change a synonym (task rules → `fieldsVersion` 2) or fix a label (`labelVersion`
2), and every affected result is stale. Since `rawOutput` is stored, `POST /runs/:id/rescore`
enqueues a job that streams the run's results, re-runs `scoreOutput` with the current rules and
labels, updates each result, then bumps the `results` cache. Thousands of results take seconds, with
no model calls. The summary flags staleness: "212 results scored with rules v1 (current v2)".

**Cache by status.** `cache.getOrSet(versionedKey(["results"], \`run:${id}:summary\`), …, (v) => v.status === "completed" ? 3600 : 10)`.
Every result write and re-score bumps `results`.

## 6. Steps

### 6.1 `stats.ts`

```ts
export const mean = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
export const percentile = (xs: number[], p: number) => {
    if (xs.length === 0) return null;
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
};
export const share = (flags: boolean[]) => (flags.length === 0 ? null : flags.filter(Boolean).length / flags.length);
```

### 6.2 `aggregate.ts`

```ts
export type ResultLite = {
    promptId: string; modelKey: string; exampleId: string; repeat: number;
    status: "scored" | "error" | "skipped";
    overallScore?: number; validJson?: boolean; schemaValid?: boolean; exactMatch?: boolean;
    fieldScores?: { key: string; score: number }[]; canonicalAnswer?: string | null;
    costUsdMicros?: number; latencyMs?: number;
};

export const aggregate = (results: ResultLite[], fieldKeys: string[]) => {
    const groups = groupBy(results, (r) => `${r.promptId}|${r.modelKey}`);
    return [...groups.entries()].map(([key, rows]) => {
        const [promptId, modelKey] = key.split("|");
        const scored = rows.filter((r) => r.status === "scored");
        const field = Object.fromEntries(fieldKeys.map((k) =>
            [k, mean(scored.map((r) => r.fieldScores!.find((f) => f.key === k)?.score ?? 0))]));
        const byExample = groupBy(scored, (r) => r.exampleId);
        const multi = [...byExample.values()].filter((reps) => reps.length >= 2);
        const consistency = multi.length === 0 ? null
            : multi.filter((reps) => new Set(reps.map((r) => r.canonicalAnswer ?? `__invalid__${r.repeat}`)).size === 1).length / multi.length;
        const costMicros = scored.reduce((s, r) => s + (r.costUsdMicros ?? 0), 0);
        return {
            promptId, modelKey, n: scored.length,
            errors: rows.filter((r) => r.status === "error").length,
            skipped: rows.filter((r) => r.status === "skipped").length,
            overall: mean(scored.map((r) => r.overallScore!)),
            field,
            validJson: share(scored.map((r) => !!r.validJson)),
            schemaValid: share(scored.map((r) => !!r.schemaValid)),
            exactMatch: share(scored.map((r) => !!r.exactMatch)),
            consistency,
            usdPer100: scored.length === 0 ? null : (costMicros / scored.length) * 100 / 1_000_000,
            p50: percentile(scored.map((r) => r.latencyMs!), 0.5),
            p95: percentile(scored.map((r) => r.latencyMs!), 0.95),
        };
    });
};
```

When a technique is `structured` and every cell is skipped, the row has `n: 0` and every metric
`null`. The UI renders "n/a — structured mode unsupported".

### 6.3 Service

`getRunSummary(ownerId, runId)`:
1. Load the run (owner check).
2. Stream results with a projection (no `rawOutput` / `parsed`; they're big) through
   `.lean().cursor()`.
3. `aggregate`, plus labels (prompt names and versions, model labels and prices with
   `priceCheckedOn`).
4. Staleness counts:
   - `countDocuments({ runId, fieldsVersion: { $ne: task.fieldsVersion } })`;
   - per-example label versions compared with the examples' current `labelVersion` (a `$lookup`, or a
     map from one examples query).
5. Cache by status as above.

Response:
`{ run, rows, fields: [...keys], stale: { rules, labels }, splitWarnings: examples with splitChangedAfterTestRun }`.

`rescore` job (queue `maintenance`, or reuse `run` with job name `rescore`, jobId `rescore:<runId>:<fieldsVersion>`):
stream the scored results, then `scoreOutput` with the current task fields and each example's current
`expected`; `updateOne` the score fields plus `fieldsVersion`/`labelVersion`; bump `results`; publish
progress.

### 6.4 CLI

`bench.ts` prints the same rows as a Markdown table (the Phase 21 exporter's function, shared),
sorted by overall descending, with n, errors and price dates in a footer.

## 7. Verify

1. On a fake-provider run whose scripted outputs have known scores (half perfect, half invalid JSON),
   the summary gives overall 0.5, valid JSON 50 %, exact match 50 %, and the hand-computed cost.
2. 3 repeats where repeat 2 differs only in skill order → consistency 100 %; where repeat 3 has a
   different salary → that example is inconsistent.
3. Rows with error cells show the count, and their accuracy uses only scored cells.
4. Add a synonym that turns a partial skills score into a full one → the summary flags rules stale →
   rescore → the number changes; no model calls in the logs.
5. Summary twice → the second call is a cache hit; a new result write invalidates it.
6. CLI `--replay` prints the same numbers as the API summary for the same run (`--save` it and compare).

## 8. Definition of done

- [ ] Every metric matches its definition (unit tests on `aggregate` with hand-computed fixtures).
- [ ] Errors and skips are separated and visible; small samples show `n`.
- [ ] Re-scoring works from stored raw outputs, with staleness flags.
- [ ] Cached by run status; the CLI uses the same functions.
- [ ] Commit: `feat: results aggregation and re-scoring`.

## 9. Interview angle

*"How do you measure consistency?"* Run each input three times and compare canonical answers,
normalised exactly as the scorer normalises, so "different" means "would score differently".
*"What if you change a scoring rule after the runs?"* Raw outputs are stored, so a re-score recomputes
every number in seconds without calling a model, and stale results are flagged until then.
