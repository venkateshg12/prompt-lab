# Phase 21 — Web: results table, error browser, side-by-side

## 1. Goal

The three views that turn numbers into understanding:

1. **Results table**: the spec's columns, one row per prompt × model: Overall · per-field accuracy
   (skills F1, salary) · Valid JSON · Schema valid · Exact · Consistency · $/100 inputs · p50 · p95,
   plus **n, errors, skipped** and the **95 % interval** of every rate. Sortable, best values marked,
   a **tag filter** (`salary_lpa` …) that recomputes the table on that subset.
2. **Error browser**: click any cell (variant × field) to list its failing results, worst first: input,
   expected vs actual per field with score and **reason**, normalised values, the verbatim raw output
   and the extracted text. Facets by reason and by tag. **Keyboard**: `j`/`k` move, `o` expands raw
   output, `c` opens compare.
3. **Side-by-side**: one example answered by two variants (two prompts on one model, or one prompt on
   two models), field by field, for every repeat.

Plus a **stale banner** with **Re-score**: when a label or the task's rules changed after the run, the
stored outputs are scored again (no model calls).

## 2. What I will understand after this phase

1. Why every percentage needs its `n`, errors and interval next to it.
2. How per-field **reasons** turn "73 % salary" into "18 of the misses read LPA as monthly".
3. Why the raw output is always shown next to the parsed one.
4. Why re-scoring is safe (pure scorer, stored raw text) and why it never calls a model.
5. Keyset pagination ordered by score.

## 3. Prerequisites

- Phase 20 done; at least one completed run.
- Phase 18: `GET /orgs/:orgId/runs/:id/summary?tag=` returning, per variant,
  `{ promptVersion, modelKey, n, repeats, errors, skipped, overall, fields: { [key]: Metric },
  validJson, schemaValid, exactMatch, consistency, costPer100UsdMicros, p50Ms, p95Ms }` where
  `Interval = { value, ci: [low, high] }` (Phase 18's shape, the Playbook stats' shape) (Wilson for rates, bootstrap for means, from `@repo/scoring/stats`).
- Phase 16: each item of `Result.fieldScores` is `{ key, score, reason }` (`reason`: `match`,
  `normalised_match`, `mismatch`, `null_expected`, `null_actual`, `out_of_tolerance`,
  `currency_mismatch`, `wrong_type`, `missing`, `partial_set`), plus `fieldDetails`
  (`skills: { precision, recall }`) and `normalised: { expected, actual }` per field.

## 4. Files

```
apps/api/src/
├── services/results.service.ts        NEW    (listResults with facets, compareResults, rescoreRun)
├── controllers/results.controller.ts  NEW
├── routes/run.route.ts                ADAPT  (+ GET /:id/results, GET /:id/compare, POST /:id/rescore)
├── utils/db/cursor.ts                 ADAPT  @pt-api/src/utils/db/cursor.ts (+ a score-ordered keyset variant)
packages/types/src/results.ts          NEW    (listResultsQuerySchema, compareQuerySchema)
apps/web/src/
├── api/results.ts · hooks/results/{useRunSummary,useResults,useCompare,useRescore}.ts   NEW
├── app/(app)/runs/[runId]/page.tsx              ADAPT  (progress → results when terminal)
├── app/(app)/runs/[runId]/errors/page.tsx       NEW    (?variant=&field=&reason=&tag=&failedOnly=)
├── app/(app)/runs/[runId]/compare/page.tsx      NEW    (?example=&a=<variantId>&b=<variantId>)
├── components/results/{ResultsTable,MetricCell,TagFilter,StaleBanner,RunMeta}.tsx      NEW
├── components/errors/{ErrorFilters,ErrorList,ResultCard,FieldScoreRow,RawOutput}.tsx    NEW
├── components/compare/{CompareView,FieldDiffRow,RepeatTabs}.tsx                          NEW
└── hooks/useKeyboardNav.ts                      NEW    (pattern from @pt-web/src/app/(app)/documents/[id]/page.tsx keydown handler)
```

## 5. Concepts

**The table.** Columns: Prompt (`key@version`, technique badge) · Model (label, provider) · Overall ·
one column per field (collapsible group) · Valid JSON · Schema · Exact · Consistency · $/100 · p50 ·
p95 · n · errors · skipped.

- Rates show one decimal, with the interval on hover (`62.4 % (56.9–67.6, n=210)`), via `MetricCell`.
- The best value per column is bold. If the best and second-best intervals overlap, the bold is
  dimmed with a tooltip, "not clearly better". That teaches the reader what Lesson 7 of the Playbook
  is about.
- `n < 20` → a "small sample" dot. Structured × unsupported → "n/a" with the reason. Never 0.
- `consistency` is "n/a" when `repeats < 2`.
- The table has ≤ ~20 rows, so it sorts client-side: TanStack Table v9 with
  `tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns })`.

**Tag filter.** `?tag=salary_lpa` calls the summary with `tag`, and every number in the table becomes
the subset's number, with its own `n`. That's how "few-shot fixed LPA" becomes a measured claim
(Playbook Lesson 2).

**The error browser is the point.** The spec's loop is run → open errors → group mistakes → write v5.
`GET …/runs/:id/results?variant&field&reason&tag&failedOnly&cursor` returns results **worst first**
(by that field's score, else `overallScore`), plus **facets**: counts by reason for the chosen field,
and by example tag. Chips like "out_of_tolerance 18 · null_actual 6 · wrong_type 2" filter on click.

Facets are one SQL query over `jsonb`:

```sql
SELECT fs->>'reason' AS reason, count(*)::int AS n
FROM results r, jsonb_array_elements(r.field_scores) fs
WHERE r.run_id = $1 AND r.org_id = $2 AND r.variant_id = $3 AND fs->>'key' = $4 AND (fs->>'score')::float < 1
GROUP BY 1 ORDER BY n DESC;
```

It's raw SQL, so it filters on `org_id` itself (the tenant extension doesn't see `$queryRaw`;
data-model.md's rule).

**Keyset by score.** Order by `(overall_score ASC NULLS FIRST, id ASC)`; the cursor encodes both. It
isn't `cursor.ts`'s `(createdAt desc, id desc)` order, so add a sibling helper `afterScoreCursor`
rather than bending the copied one. Errors (`overall_score IS NULL`) come first, since they're the worst.

**Result card.**
- Input: first 400 characters, expandable; hidden with "[input hidden]" when `publicInput = false`
  and the viewer is on a published page (Phase 22). Inside the workspace it's always shown.
- `FieldScoreRow` per field: expected, actual, score, reason, and the normalised values when they
  differ from the raw ones (`"Acme Labs."` → `acme labs`; `25k/month` → `300000 INR/year`).
- `RawOutput`: verbatim, monospace, with the extracted span highlighted (for CoT, the last
  `<json>…</json>` block). The reader sees exactly why `validJson` was false ("Sure! Here's the JSON:").
- Tokens, latency, attempts, cost, finish reason (`length` is a common hidden cause of broken JSON).

**Side-by-side.** Pick an example and two variants; rows are fields; each side shows its value coloured
by score; differing fields highlighted. `RepeatTabs` shows every repeat, so consistency failures are
visible ("repeat 2: hybrid · repeat 3: remote").

**Stale results and re-scoring.** A run is stale when its `taskVersion` < `Task.version`, or when the
hash of its examples' current `(ref, revision)` list no longer equals the `datasetHash` it recorded
(Phase 17 computes the hash; this phase recomputes it for the banner and lists the changed refs). `POST …/runs/:id/rescore`
re-runs `@repo/scoring` on the stored `rawOutput` with the current rules and labels, in batches of 500
inside `withTransaction`, then re-runs Phase 18's finalize. **No model call is ever made**, so
re-scoring is free and deterministic (the scorer is pure). The run records `rescoredAt` and the new
`taskVersion` in `notes`. The summary and every export say "re-scored on <date> with task v4".

## 6. Steps

1. **API: list with facets.**

   ```ts
   // services/results.service.ts
   export const listResults = async (orgId: string, runId: string, q: ListResultsQuery) => {
     const run = await prisma.run.findUnique({ where: { id: runId }, select: { id: true } });
     appAssert(run, NOT_FOUND, "Run not found");
     const where: Prisma.ResultWhereInput = {
       runId,
       ...(q.variant && { variantId: q.variant }),
       ...(q.tag && { example: { tags: { has: q.tag } } }),
       ...(q.failedOnly && { OR: [{ status: "error" }, { overallScore: { lt: 1 } }] }),
       ...(q.field && q.reason && { fieldScores: { array_contains: [{ key: q.field, reason: q.reason }] } }),
       ...afterScoreCursor(decodeScoreCursor(q.cursor)),
     };
     const rows = await prisma.result.findMany({
       where,
       orderBy: [{ overallScore: { sort: "asc", nulls: "first" } }, { id: "asc" }],
       take: q.limit + 1,
       include: { example: { select: { ref: true, input: true, expected: true, tags: true } } },
     });
     const page = scorePageOf(rows, q.limit);
     const facets = q.variant && q.field ? await reasonFacets(orgId, runId, q.variant, q.field) : [];
     const tagFacets = q.variant ? await tagFacetsFor(orgId, runId, q.variant) : [];
     return { ...page, facets: { reasons: facets, tags: tagFacets } };
   };
   ```

   `array_contains` on a `jsonb` array works in Prisma 7 for PostgreSQL. Check it with Context7 and
   fall back to `$queryRaw` with `@>` if your version differs. Facets are cached 60 s under the `runs`
   domain, keyed by `(runId, variant, field)`, and bumped by `rescoreRun`.
2. **API: compare.** `GET …/runs/:id/compare?example=<ref>&a=<variantId>&b=<variantId>` → both
   variants' results for that example, all repeats, with their field scores.
3. **API: rescore.** `POST …/runs/:id/rescore` (`admin`) → batches of 500 → `finalizeRun(runId)`
   (Phase 18) → update the run's `taskVersion` and `datasetHash` to the current ones and append
   "re-scored <date> with task v<N>; changed: jp_017, …" to `notes` → `cache.bump("runs")` → a
   `progress` SSE message `{ status: "rescored" }`. A published run's slug stays the same, and its page
   shows the note.
4. **Web: run page.** When the run is terminal, show `RunMeta` (task + version, split, repeats, prompts
   linking to their frozen text, models with price and `priceCheckedOn`, notes, a `test reused`
   warning) above `StaleBanner`, `TagFilter` and `ResultsTable`. A field cell links to
   `/runs/:runId/errors?variant=…&field=…&failedOnly=true`.
5. **Web: error page.** `ErrorFilters` (field select, reason chips with counts, tag chips, failed-only
   toggle), `ErrorList` (infinite query), `ResultCard`s. All filter state in the URL.
6. **Keyboard.**

   ```ts
   // hooks/useKeyboardNav.ts
   export const useKeyboardNav = (count: number, handlers: { open: (i: number) => void; compare: (i: number) => void }) => {
     const [index, setIndex] = useState(0);
     useEffect(() => {
       const onKey = (e: KeyboardEvent) => {
         const t = e.target as HTMLElement;
         if (t.closest("input, textarea, select, [contenteditable=true]")) return;   // never steal typing
         if (e.key === "j") setIndex((i) => Math.min(i + 1, count - 1));
         else if (e.key === "k") setIndex((i) => Math.max(i - 1, 0));
         else if (e.key === "o") handlers.open(index);
         else if (e.key === "c") handlers.compare(index);
         else return;
         e.preventDefault();
       };
       window.addEventListener("keydown", onKey);
       return () => window.removeEventListener("keydown", onKey);
     }, [count, index, handlers]);
     return index;
   };
   ```

   The focused card gets `aria-current="true"` and scrolls into view (`scrollIntoView({ block:
   "nearest" })`). A `?` key shows a small shortcuts dialog.
7. **Web: compare page.** Two variant selectors, an example selector (prefilled from the card), and
   `CompareView` with `RepeatTabs`. Each `ResultCard` links "Compare with…".

## 7. Verify

1. Completed run → every number in the table equals `curl …/runs/<id>/summary` (spot-check three
   cells); hover shows the interval and `n`; the best-value bold is dimmed where intervals overlap.
2. `?tag=salary_lpa` → `n` drops to the subset size and the salary column changes; remove the tag →
   back to the full table.
3. Click "salary" on the worst row → failing results, worst first; reason chips show counts that sum
   to the failure count; `out_of_tolerance` filters; the URL holds the filters across a reload.
4. A result whose raw output starts with "Sure! Here's the JSON:" shows it verbatim, `validJson: false`,
   with the extracted span (or none) highlighted.
5. `j j k o c` works on the error page and does nothing while typing in a filter input.
6. Compare `v1@1` vs `v2@1` on `jp_017` → differing fields highlighted; with 3 repeats, `RepeatTabs`
   shows an inconsistent field.
7. Edit one example's expected salary (Phase 19) → the run page shows the stale banner → **Re-score** →
   no outbound provider calls (fake provider call count unchanged / no new `ModelCall`-style log lines),
   the banner is gone, salary accuracy updates, and `notes` records the re-score.
8. `EXPLAIN` the list query → it uses `results_run_id_variant_id_overall_score_idx`.

## 8. Definition of done

- [ ] The results table has every spec column plus n, errors, skipped and intervals; a tag filter
      recomputes it on a subset.
- [ ] The error browser has reason and tag facets, normalised values, raw output and extracted span,
      with keyset paging worst first.
- [ ] Keyboard navigation that never fires while typing.
- [ ] Side-by-side by variant, with repeats.
- [ ] Re-score from the UI: pure, batched, no model calls, recorded in the run.
- [ ] Raw SQL filters on `org_id` itself.
- [ ] Commit: `feat(web): results, error browser, side-by-side, re-score`.

## 9. Interview angle

*"How did you find what to fix in your prompts?"* The error browser groups every miss by field and
reason. For salary, the biggest bucket was <your finding, e.g. "LPA read as monthly">, so v5 added an
explicit conversion rule and an example, and the `salary_lpa` subset shows the change with its own
sample size. *"What if a label was wrong?"* I fix it and re-score: the stored raw outputs go through
the same pure scorer, no model calls, and the run says it was re-scored.
