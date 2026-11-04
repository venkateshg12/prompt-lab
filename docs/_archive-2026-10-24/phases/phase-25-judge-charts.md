# Phase 25 — LLM judge and cost-vs-accuracy chart (optional)

## 1. Goal

Two "nice to have" features from the spec, both small:
1. an **LLM judge** for subjective checks: a binary pass/fail on one question per result (e.g. *"Is
   `title` a reasonable job title for this posting, even if it isn't the labelled one?"*), stored
   separately from the deterministic scores and never mixed into "overall";
2. a **cost-vs-accuracy scatter chart** of the results table (plus latency), the picture that makes
   the "which would you ship" answer obvious.

## 2. What I will understand after this phase

1. When an LLM judge is appropriate (subjective fields) and when it isn't (anything with a right answer).
2. How to keep a judge honest: binary questions, a different model from the judged one, calibration
   against your own judgement, and results reported separately.
3. How to chart a trade-off without misleading (axes, labels, Pareto front).

## 3. Prerequisites

Phase 24 done (or at least one completed run).

## 4. Files

```
packages/types/src/judge.ts                 NEW   (judge config on the task: question, model, pass/fail)
apps/api/src/
├── services/judge.service.ts               NEW   (judge a run's results; stores judge verdicts)
├── jobs/processors/judge.processor.ts      NEW   (fan-out like cells; jobId judge:<runId>:<resultId>)
└── routes/run.route.ts                     ADAPT (+ POST /runs/:id/judge, judge summary)
apps/web/src/components/results/{CostAccuracyChart,JudgeColumn}.tsx   NEW
```

```bash
pnpm --filter web add recharts
```

## 5. Concepts

**Judge only what has no right answer.** Every field in the job-posting task has a checkable answer,
so the deterministic scorer is better than any judge for them. A judge earns its place for a
**subjective** field you add later (e.g. a `summary` field: "Is this one-line summary faithful to the
posting and under 20 words?"). If you add none, implement the judge on a demonstration question
(*"Does the extracted title describe the same role as the posting?"*) and report it as exploratory.

**Keep it honest.**
- **Binary** (pass/fail plus a one-sentence reason). Rating scales drift.
- **A different model** from the one being judged. Prefer a strong one; record its key and price.
- **Same rules as cells**: deterministic job ids, raw judge output stored, a strict tiny schema
  (`{ "pass": boolean, "reason": string }`), parsing without repair (an unparseable verdict is
  recorded as `judge_error`).
- **Calibrate**: judge 20 results you've also judged by hand; report agreement next to the judge
  column. Below ~85 %, the judge column carries a warning.
- **Never in "overall"**: a separate `judgePassRate` column.

**Chart.** X = cost per 100 inputs (log scale if the spread is wide), Y = overall accuracy, one point
per prompt × model, colour by model and shape by technique, labelled. Draw the **Pareto front** (points
no other point beats on both cost and accuracy). A tooltip shows p95 and n. That's one picture of the
recommendation in Phase 24.

## 6. Steps

1. Task-level `judge: { question, modelKey, enabled }` (optional), validated so `modelKey` isn't in the
   run's `modelKeys` (or warn).
2. `POST /runs/:id/judge` → fan out judge jobs over scored results (≤ 2,000), paced by the same leases.
   Each job: render the judge prompt (question + posting + the result's parsed JSON) → `complete()` →
   parse `{pass, reason}` with Zod → store `result.judge = { pass, reason, raw, modelKey, costUsdMicros }`
   → `$inc` the judge counters.
3. Summary adds `judgePassRate` per row (separate from overall) and a calibration figure from
   `judgeHumanLabel` on up to 20 results (set in the error browser with a ✓/✗ toggle).
4. `CostAccuracyChart` (Recharts `ScatterChart`) on the run page; Pareto points computed client-side
   (sort by cost; keep the points whose accuracy is above the running maximum).
5. Chart colours, labels and the dark-mode palette: follow your usual chart conventions (one hue per
   model, consistent with the table's model labels).

## 7. Verify

1. Judge a 30-result run with the fake provider scripted to pass/fail → pass rate correct; a garbage
   verdict → `judge_error`, not a crash.
2. The judge column never changes "overall".
3. Hand-label 20 → agreement shown; under 85 % → warning badge.
4. The chart plots one point per row; the Pareto front matches a hand check; the tooltip shows p95 and n.

## 8. Definition of done

- [ ] Optional binary judge, reported separately, calibrated against your judgement.
- [ ] Cost-vs-accuracy chart with a Pareto front.
- [ ] Commit: `feat: optional LLM judge and cost-accuracy chart`.

## 9. Interview angle

*"Do you use LLM-as-judge?"* Only for subjective checks, as a binary question, with a different model
from the one being judged, calibrated against my own labels, and never mixed into the deterministic
score. For fields with a right answer, code is cheaper and more reliable than any judge.
