# Phase 26 — LLM judge (validated) and charts

## 1. Goal

Two "later" features from the spec (§2 nice-to-haves, §5.1 optional judge), both small and both kept
honest:
1. an **LLM judge** for one subjective, **binary** question per result. It is stored apart from the
   deterministic scores, never mixed into `overall`, and **not trusted until validated** against your
   own labels (agreement + Cohen's kappa);
2. **charts** generated from the stored summaries: a cost-vs-accuracy scatter with the Pareto front,
   and per-field accuracy bars per prompt × model. They're the pictures behind the "which would you
   ship" answer.

## 2. What I will understand after this phase

1. When an LLM judge is appropriate (no right answer exists) and when it isn't (anything code can
   check).
2. How to keep a judge honest: a binary question, a different model family from the judged one, a raw
   verdict stored and parsed without repair, and validation against human labels before use.
3. Why raw agreement isn't enough, and what Cohen's kappa adds.
4. How to chart a trade-off without misleading: axes, labels, n, and the Pareto front.

## 3. Prerequisites

- Phase 25 done (at least one completed run with scored results).
- Phases 14, 17 and 21 (providers, the runner's cell pattern, the results page).

## 4. Files

```
packages/types/src/judge.ts                      NEW   judge config + verdict schemas
packages/scoring/src/agreement.ts (+ .test.ts)   NEW   agreement, Cohen's kappa, Pareto front (pure)
apps/api/prisma/schema.prisma                    ADAPT + Result.judge Json?   (migration `judge`)
apps/api/src/
├── services/judge.service.ts                    NEW   start a judge pass, validation report
├── jobs/queues/judge.queue.ts                   NEW   queue `run-judge`
├── jobs/workers/judge.worker.ts                 NEW
├── jobs/processors/judge.processor.ts           NEW   jobId judge-<runId>-<resultId>
├── controllers/judge.controller.ts · routes/judge.route.ts   NEW
apps/web/src/
├── components/results/CostAccuracyChart.tsx     NEW   ADAPT from @pt-web/src/app/(app)/quality/page.tsx (Recharts usage)
├── components/results/FieldBars.tsx             NEW
└── components/results/JudgePanel.tsx            NEW   human ✓/✗ labels, validation numbers, judge column
```

```bash
pnpm --filter web add recharts@^3.10.1     # PaperTrail's version (@pt-web/package.json)
```

## 5. Concepts

**Judge only what has no right answer.** Every field of the job-postings task has a checkable answer,
and the deterministic scorer beats any judge on those. A judge earns its place for a **subjective**
question. If the task has none, use a demonstration question and label it exploratory:
*"Does the extracted `title` describe the same role as the posting, even if worded differently from
the label?"* That's useful exactly where the `text` rule's exact match is too strict.

**Keep it honest.**
- **Binary**: `{ "pass": boolean, "reason": string }` (reason ≤ 200 chars). Rating scales drift.
- **A different family** from every model judged in the run. The service refuses a judge model whose
  provider + family appears in the run's variants, unless `--allow-same-family` is passed, which is
  then stamped on every verdict.
- **The cell pattern** (Phase 17): one job per result, `jobId = judge-<runId>-<resultId>` (dashes, no
  colons), the raw judge text stored, parsed with Zod **without repair**. An unparseable verdict is
  `{ status: "judge_error", raw }`, never a guess.
- **Stored apart**: `Result.judge = { model, promptVersion, pass, reason, raw, status, costUsdMicros,
  human?: { pass, by, at } }`. `overall` never reads it. The results table shows a separate
  `judge pass %` column.

**Validate before use.** Hand-label at least 30 judged results ✓/✗ in `JudgePanel` (stored as
`judge.human`), balanced across variants. Then:

- **agreement** = share where judge and human agree;
- **Cohen's kappa** κ = (pₒ − pₑ) / (1 − pₑ), where pₑ = p_human_yes·p_judge_yes +
  p_human_no·p_judge_no. Agreement alone flatters a judge that says "pass" to everything when 90 % of
  results pass. Kappa corrects for that chance agreement.

Rule (decided now, before seeing a number): the judge column is shown **without a warning** only if
agreement ≥ 0.85 **and** κ ≥ 0.6 on n ≥ 30. Otherwise it carries "not validated: agreement X, κ Y,
n Z" generated from the data, and it's left out of the README's results table.

```ts
// packages/scoring/src/agreement.ts (pure)
export const cohensKappa = (pairs: { human: boolean; judge: boolean }[]) => {
  const n = pairs.length;
  if (n === 0) return { n, agreement: null, kappa: null };
  const po = pairs.filter((p) => p.human === p.judge).length / n;
  const h = pairs.filter((p) => p.human).length / n;
  const j = pairs.filter((p) => p.judge).length / n;
  const pe = h * j + (1 - h) * (1 - j);
  return { n, agreement: po, kappa: pe === 1 ? null : (po - pe) / (1 - pe) };
};

export const paretoFront = <T extends { cost: number; accuracy: number }>(points: T[]) => {
  const sorted = [...points].sort((a, b) => a.cost - b.cost || b.accuracy - a.accuracy);
  const front: T[] = [];
  let best = -Infinity;
  for (const p of sorted) if (p.accuracy > best) { front.push(p); best = p.accuracy; }
  return front;
};
```

`kappa: null` (every label identical) is shown as "undefined (no variation)", never as 1.

**Charts from summaries only.** Both charts read `RunVariant.summary` (Phase 18), the same numbers as
the table. A chart is never computed from a separate query.
- **Cost vs accuracy**: X = $ per 100 inputs (log scale when the spread passes 10×), Y = overall, one
  point per prompt × model. Colour by model, shape by technique, every point labelled. The Pareto front
  is drawn as a line. The tooltip shows p95, valid JSON % and n. Rows with `n: 0` (skipped structured
  cells) aren't plotted and are listed under the chart.
- **Field bars**: per-field accuracy grouped by field, one bar per variant, the 95 % interval as an
  error bar (Wilson for proportions, bootstrap for skills F1, `scoring-rules.md` §4).
- Follow the dataviz conventions of your other projects: one hue per model, consistent with the
  table's labels, a readable dark mode, axis titles with units.

## 6. Steps

1. `judge.ts` schemas; the task config `judge?: { question, modelKey, enabled }` validated in Phase 11's
   task service.
2. Migration `judge` (`Result.judge Json?`): `pnpm --filter api db:migrate:dev --name judge < /dev/null`
   then `prisma generate`.
3. `POST /orgs/:orgId/runs/:id/judge { modelKey, limit? }` (admin): refuses same-family models,
   refuses a run that isn't completed, and enqueues one job per scored result (≤ 2,000). Per-provider
   concurrency comes from Phase 17's limiter.
4. Processor: render the judge prompt (question + posting + the result's `parsedJson`, posting wrapped
   in `<posting>…</posting>` as data) → `complete()` → Zod-parse → store `judge` → bump the run's
   judge counters → publish progress on the run's SSE channel.
5. `GET …/runs/:id/judge/validation` → `{ n, agreement, kappa, validated }` from `judge.human` labels.
6. `JudgePanel`: ✓/✗ buttons (reviewer+), the validation numbers, and the banner rule above.
7. `agreement.ts` + tests; `CostAccuracyChart` and `FieldBars` on the run page.

## 7. Verify

```bash
pnpm --filter @repo/scoring test agreement
# ✓ kappa = 1 for perfect agreement with variation · 0 for chance-level · null when all labels equal
# ✓ pareto front on a hand-made set of 6 points matches the hand answer
LLM_PROVIDER=fake FAKE_LLM_SCRIPT=judge-mixed pnpm --filter api test:int judge
# ✓ 30 judged: pass/fail counts match the script · a garbage verdict → judge_error, no crash
# ✓ re-posting POST …/judge creates no duplicate verdicts (deterministic job ids)
# ✓ a same-family judge model → 422 JUDGE_SAME_FAMILY
# ✓ overall for every RunVariant is byte-identical before and after judging
```

- In the UI: label 30 results, and the validation card shows n, agreement and κ from the API. Below
  the thresholds, the warning banner appears and the README export omits the judge column.
- The scatter has one point per non-skipped row, the front matches `paretoFront`'s output, and each
  tooltip's numbers equal that row in the table.

## 8. Definition of done

- [ ] Binary judge, different family, raw verdicts stored, parsed without repair, never in `overall`.
- [ ] Validation with ≥ 30 human labels: agreement and Cohen's kappa shown; the warning rule enforced.
- [ ] Cost-vs-accuracy scatter with a Pareto front and per-field bars with intervals, both from
      summaries.
- [ ] `tracker.md` updated. Commit: `feat: validated LLM judge and cost-accuracy charts`.

## 9. Interview angle

*"Do you use LLM-as-judge?"* Only for questions without a right answer, as a binary verdict from a
different model family, and never mixed into the deterministic score. I don't trust it until it's
validated: on 30+ results I labelled myself, I report raw agreement **and** Cohen's kappa, because a
judge that always says "pass" can score 90 % agreement and still be worthless. Below the threshold I
set in advance, the column stays out of the README.
