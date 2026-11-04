# Phase 20 — Web: results table, error browser, side-by-side

## 1. Goal

The three views that turn numbers into understanding:
1. **Results table**: the spec's columns, one row per prompt × model, sortable, with `n`, errors and
   skipped visible, best values highlighted, staleness banners (rules/labels changed → Re-score).
2. **Error browser**: click any cell (row × metric, e.g. "v2 × Llama × salary") to list its failing
   results, with input, expected, actual, and every field's score and **reason**. Grouped and
   filterable by reason and by example tag.
3. **Side-by-side**: one example answered by two prompts *or* two models, field by field.

## 2. What I will understand after this phase

1. Why a results table needs `n` and error columns next to every percentage.
2. How field reasons turn "73 % salary accuracy" into "18 of the misses were LPA read as monthly".
3. Why the raw output is always shown next to the parsed one.

## 3. Prerequisites

Phase 19 done; at least one completed run.

## 4. Files

```
apps/web/src/
├── app/(app)/runs/[id]/page.tsx                    ADAPT (progress → results when complete)
├── app/(app)/runs/[id]/errors/page.tsx             NEW   (?prompt=&model=&field=&reason=&tag=)
├── app/(app)/runs/[id]/compare/page.tsx            NEW   (?example=&a=<prompt|model>&b=…)
├── components/results/{ResultsTable,MetricCell,StaleBanner,RunMeta}.tsx       NEW
├── components/errors/{ErrorFilters,ErrorList,ResultCard,FieldScoreRow,RawOutput}.tsx   NEW
├── components/compare/{CompareView,FieldDiffRow}.tsx                          NEW
apps/api/src/
├── routes/run.route.ts                             ADAPT (+ GET /runs/:id/results, GET /runs/:id/compare)
└── services/results.service.ts                     ADAPT (filters, facets, compare)
```

## 5. Concepts

**The table.** Columns: Prompt (name + version + technique badge) · Model (label + provider) ·
Overall · one column per field (collapsible group) · Valid JSON · Schema valid · Exact · Consistency ·
$/100 · p50 · p95 · n · errors · skipped.
- Each column's **best** value is bold, and the overall best row has a subtle background.
- Percentages are shown to one decimal place; cost to 4 significant figures with "$".
- A cell with `n < 20` gets a "small sample" dot with a tooltip.
- Structured × unsupported shows "n/a" with a tooltip explaining why.

**The error browser is the point.** The spec's iteration loop is: run → open errors → group mistakes
→ write v5. The API endpoint
`GET /runs/:id/results?prompt&model&field&reason&tag&minScore&cursor` returns results (worst first,
using the `{ runId, promptId, modelKey, overallScore }` index) plus **facets**: counts by reason for
the chosen field, and counts by example tag. The UI shows the facets as chips: "out_of_tolerance 18 ·
null_expected 6 · wrong_type 2". Clicking a chip filters.

**Result card.** Each card shows:
- the input (collapsible, with the first 400 characters visible);
- **expected vs actual**, field by field, with the score, reason, and the normalised values when
  they differ from the raw ones (`"Acme Labs."` → `acme labs`);
- the **raw output**, verbatim in a monospace block, so the reader sees exactly what was scored
  (e.g. the prose before the JSON that made `validJson` false);
- tokens, latency, attempts and cost;
- for CoT, the extracted `<json>` block highlighted inside the raw text.

**Side-by-side.** Pick an example and two series (two prompts on one model, or one prompt on two
models). Rows are fields; each side shows its value with a score colour; differing fields are
highlighted. The repeat selector shows consistency issues directly ("repeat 2 said hybrid, repeat 3
said remote").

## 6. Steps

1. API:
   - `GET /runs/:id/summary` (Phase 17);
   - `GET /runs/:id/results` with the filters above, cursor pagination on `(overallScore asc, _id)`,
     and facets via one `$facet` aggregation (cached 60 s under `results`);
   - `GET /runs/:id/compare?example=…&series=prompt:<id>,model:<key>&series=…` → the results for both
     series, all repeats.
2. `ResultsTable` with TanStack Table (client-side sort; the data is ≤ ~20 rows). Clicking a field
   cell opens `/runs/:id/errors?prompt=…&model=…&field=…`.
3. `StaleBanner`: when the summary reports stale rules or labels, "212 results were scored with
   older rules — Re-score (no model calls)" → `POST /runs/:id/rescore` → progress via SSE → refresh.
4. The error page: `ErrorFilters` (field, reason chips with counts, tag chips, "only failures"
   toggle), `ErrorList` (infinite), `ResultCard`. Keyboard `j`/`k` to move between cards (PaperTrail's
   review screen pattern).
5. The compare page: two selectors and `CompareView`. Linked from each `ResultCard` ("Compare with…").
6. `RunMeta` at the top of the run page: task, split, prompts with versions (linking to the frozen
   text), models with **price and date**, repeats, notes, and the
   `splitChangedAfterTestRun` warning if any.

## 7. Verify

1. Completed run → the table matches `GET /runs/:id/summary`; the best values are bold; small-sample
   dots appear on cells with `n < 20`.
2. Click "salary" on the worst row → the errors page lists failing results, worst first; reason chips
   show counts; clicking `out_of_tolerance` filters; tag chips filter to `salary_lpa`.
3. A result whose raw output starts with "Sure! Here's the JSON:" shows it verbatim, with
   `validJson: false`.
4. Compare v1 vs v2 on one example → differing fields highlighted.
5. Change a synonym → the stale banner → re-score → banner gone, numbers updated.

## 8. Definition of done

- [ ] The results table has every spec column, plus n, errors and skipped.
- [ ] The error browser has reason/tag facets, raw output and field-level detail.
- [ ] Side-by-side by prompt or model, with repeats; re-score from the UI.
- [ ] Commit: `feat(web): results, error browser, side-by-side`.

## 9. Interview angle

*"How did you find what to fix in your prompts?"* The error browser groups every miss by field and
reason. For salary the biggest bucket was <your finding, e.g. "LPA treated as monthly">, so v5 added
an explicit conversion rule and an example. The numbers are in my README, and every percentage shows
its sample size and error count next to it.
