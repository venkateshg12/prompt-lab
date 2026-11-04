# Phase 19 — Web: run launcher and live progress

## 1. Goal

- A **run launcher**: choose prompts (versions), models (with price and `priceCheckedOn` shown),
  split (dev by default), repeats, notes. See the **grid size** and an **estimated cost** before
  starting.
- **Runs list** per task and globally: status, grid, progress, cost so far, created time.
- **Live progress** on the run page over SSE: a bar, completed / errored / skipped counters, cost
  ticking up, and a per-model mini-progress, with polling as the fallback.
- Cancel with confirmation.

## 2. What I will understand after this phase

1. How to estimate cost before spending it, and why the estimate is labelled as one.
2. How SSE messages update the TanStack Query cache without refetching on every cell.
3. Why running the **test** split gets a deliberate confirmation step.

## 3. Prerequisites

Phase 18 done.

## 4. Files

```
apps/web/src/
├── api/run.ts · hooks/runs/{useRuns,useRun,useCreateRun,useCancelRun,useRunEvents}.ts   NEW
├── app/(app)/runs/page.tsx                    NEW   (all runs)
├── app/(app)/runs/[id]/page.tsx               NEW   (progress now; results in Phase 20)
├── components/runs/{RunLauncher,GridSummary,CostEstimate,RunProgress,RunStatusBadge}.tsx   NEW
└── hooks/runs/useRunEvents.ts                 NEW   (EventSource, PaperTrail's useOrgEvents shape)
```

## 5. Concepts

**Estimate before you spend.** Grid size =
`prompts × models × examples(split) × repeats`. Estimated cost per model:
- input tokens ≈ (rendered system + few-shot + average input length) ÷ 4;
- output tokens ≈ the prompt's `maxTokens × 0.4` (CoT: × 0.8);
- multiply by the model's prices.

Show **"≈ $0.84 (estimate; prices checked 24 Oct 2026)"**. It's rough on purpose, and the run page
shows the **actual** cost live. Over a threshold you set (e.g. $2), the Start button asks for
confirmation.

**Test runs are an event.** Choosing the **test** split shows a callout: *"The test set is for final
numbers. Running it after you've changed prompts based on test results makes it a second dev set."*
It requires ticking "This is a final run". The run stores `split: "test"`, and published pages show it.

**SSE → cache.** Each message carries the run's counters. The hook writes them into the cached
`["run", id]` object with `setQueryData` (no refetch). On `status: "completed"` it invalidates
`["run", id, "summary"]` once, and the results table (Phase 20) loads. While disconnected for more than
10 s it falls back to polling `GET /runs/:id` every 3 s. That's PaperTrail's Phase 30 pattern.

## 6. Steps

1. `RunLauncher` (a sheet from the task's Runs tab):
   - prompt multi-select (latest version by default, with a version dropdown per name);
   - model multi-select (grouped by provider, disabled if not enabled, each with its price, date and
     structured support badge);
   - split radio, repeats (1–5; suggest 3 when consistency matters), notes;
   - `GridSummary` ("3 prompts × 3 models × 30 examples × 3 repeats = 810 calls");
   - `CostEstimate`;
   - Start → `POST /runs` → navigate to `/runs/:id`.
2. A warning when a `structured` prompt is paired with a model whose structured mode is `unsupported`:
   "these cells will be skipped (n/a)".
3. `RunProgress`:
   - an overall bar and counters;
   - a per-model breakdown (the API adds `progressByModel`, computed with a cheap `$group` on results by
     `modelKey` and status, cached 5 s);
   - elapsed time;
   - cost so far;
   - Cancel (dialog) → `POST /runs/:id/cancel`.
4. The runs list: a TanStack Table with status badge, task, grid, split, progress %, cost and
   created time; links to the run page.

## 7. Verify

1. Launch 2 prompts × 2 models × 30 dev × 1 → the grid says 120; the estimate shows its date; the run
   page shows the bar moving live; the Network tab shows one `events` stream and no polling.
2. Stop the API mid-run → after 10 s polling starts; restart → the stream resumes; the counters are
   correct.
3. Choose **test** → the callout and checkbox are required.
4. Cancel → counters settle with skipped cells; status `cancelled`.
5. A run with an `unsupported` structured pairing shows the warning before start and the skipped count
   after.

## 8. Definition of done

- [ ] The launcher shows grid size and a dated cost estimate; test runs need explicit intent.
- [ ] Live progress via SSE with a polling fallback; cancel works.
- [ ] Commit: `feat(web): run launcher and live progress`.

## 9. Interview angle

*"What does a run cost, and do you know before you start?"* There's an estimate from rendered prompt
length and dated prices before starting, labelled as an estimate, and the actual cost streams in live.
Test-split runs need an explicit "final run" confirmation, because the discipline matters more than
the tooling.
