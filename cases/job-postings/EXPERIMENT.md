# Experiment notebook: job postings

👤 Filled in during Phase 25, from real runs only. `check-notebook.ts` checks it: every run id below
must exist, every change block needs Hypothesis / Change / Delta / Decision (keep | revert), and
Lesson 7's picks must be timestamped before v1-thorough's first run.

```bash
pnpm --filter api exec tsx src/scripts/check-notebook.ts ../../cases/job-postings/EXPERIMENT.md
```

## Setup

- Models (3 families), probed on: _(date; paste `runs/structured-probe.csv` results)_
- Prompt versions: v1-zero-shot, v2-few-shot, v3-cot, v4-structured (+ v5-best, v0-vague, v2b-one-shot, v1-thorough)
- Temperature 0, 3 repeats, scoring rules fixed in `docs/reference/scoring-rules.md`.

## Dev run A (v1–v4 × 3 models × 30 × 3)

Run: _(run id)_

_(paste the Markdown export here, then the error buckets per prompt × model)_

## Changes toward v5

Copy this block per change. Changes that didn't help stay in, with Decision: revert.

### C1: _(short title)_
- Hypothesis: _(the mistake type, with its count from the error browser)_
- Change: _(one change)_
- Delta: _(per-field delta, run <id> vs run <id>)_
- Decision: _(keep | revert)_

## Playbook variants (dev)

Lesson 7 picks — _(ISO time, e.g. 2026-11-20T10:30:00+05:30)_ · _(5 dev refs, comma-separated)_

- v0-vague, v2b-one-shot, v1-thorough dev run: _(run id)_. Only checked that they parse.

## Final test runs (once)

- job-postings test run: _(run id)_ · published at `/r/…`
- reasoning-mini test run: _(run id)_

## What I learned

_(from the exported table: top 3 mistake types, what fixed them, what didn't, the recommendation with accuracy, valid JSON, cost and p95)_
