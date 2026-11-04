# Phase 20 — Web: run launcher and live progress

## 1. Goal

- A **run launcher**: pick prompt versions × models × split × repeats, see the **grid size**, a
  **dated cost estimate** computed by the server from the rendered prompts and the models' prices, the
  workspace's **budget** left this month, and a **test-reuse warning** before anything is spent.
- **Runs lists** per task and per workspace: status, grid, progress, cost so far, split, created.
- **Live progress** on the run page over SSE: overall bar, done / error / skipped counters, cost
  ticking up, per-model progress, with polling as a fallback.
- **Cancel** with confirmation.

## 2. What I will understand after this phase

1. How to estimate a run's cost before spending it, and why the estimate lives on the server.
2. How SSE messages patch the TanStack Query cache without refetching per cell.
3. Why the test split needs a deliberate "final run" confirmation, and how test reuse is detected.
4. Why progress counters come from the database, not from counting SSE messages.

## 3. Prerequisites

- Phase 19 done.
- Phase 17's runner API (adjust the names here to what you built):
  - `POST /orgs/:orgId/runs` `{ taskId, split, repeats, promptVersionIds, modelKeys, notes, confirmFinal }`
    → creates `Run` + `RunVariant`s, freezes the prompts, snapshots prices, enqueues cells, and sets
    `testReused`;
  - `GET /orgs/:orgId/runs?taskId&cursor`, `GET /orgs/:orgId/runs/:id`;
  - `POST /orgs/:orgId/runs/:id/cancel`;
  - `GET /orgs/:orgId/runs/:id/events` (SSE, `@pt-api/src/utils/events/sse.ts` + pub/sub channel per run)
    sending `progress` events `{ doneCells, errorCells, skippedCells, costUsdMicros, status }`.
- Phase 14's `GET /models` (`key`, `label`, `provider`, `enabled`, prices, `priceCheckedOn`,
  `structured`).

## 4. Files

```
apps/api/src/
├── services/run.service.ts                ADAPT  (Phase 17's: + estimateRun, + detectTestReuse shared with createRun, + progressByModel)
├── controllers/run.controller.ts          ADAPT  (+ estimateRunHandler)
└── routes/run.route.ts                    ADAPT  (+ POST /orgs/:orgId/runs/estimate)
packages/types/src/run.ts                  ADAPT  (+ runEstimateRequestSchema = createRunSchema minus notes/confirmFinal)
apps/web/src/
├── api/run.ts                             NEW
├── hooks/runs/{useRuns,useRun,useEstimateRun,useCreateRun,useCancelRun,useRunEvents}.ts   NEW
├── app/(app)/runs/page.tsx                NEW    (all runs in the workspace)
├── app/(app)/runs/[runId]/page.tsx        NEW    (progress now; results in Phase 21)
├── app/(app)/tasks/[taskId]/page.tsx      ADAPT  (Runs tab: list + "New run")
└── components/runs/{RunLauncher,GridSummary,CostEstimate,BudgetBar,TestRunCallout,RunProgress,RunStatusBadge,RunsTable}.tsx NEW
```

`useRunEvents` follows `@pt-web/src/hooks/documents/useOrgEvents.ts`: an `EventSource` with
`withCredentials`, `setQueryData` patches, a 10 s grace period, then polling.

## 5. Concepts

**Estimate on the server.** The client would need the rendered length of every prompt, the few-shot
examples and the average input length per split. The server already has `renderPrompt` (Phase 13) and
the examples, so `POST …/runs/estimate` computes, per variant:

- input tokens ≈ `(rendered system + few-shot + template without input) ÷ 4 + mean(input.length) ÷ 4`;
- output tokens ≈ the prompt's `maxTokens × 0.4` (`× 0.8` for `cot`, whose reasoning is long);
- cost = tokens × the model's current price, in integer micro-dollars;
- cells = `examples(split) × repeats`, minus cells that will be **skipped** (`structured` prompt ×
  model with `structured: "unsupported"`).

The response carries `priceCheckedOn` per model, and the UI says **"≈ $0.84 (estimate; prices
checked 24 Oct 2026)"**. The run page shows the actual cost live, from `Result.costUsdMicros`. Never
present the estimate as a cost.

**Budget.** `Org.monthlyBudgetUsdMicros` minus this month's spend
(`SUM(results.cost_usd_micros)` for runs created this UTC month) gives "remaining". `BudgetBar` shows
spent / estimate / remaining. If the estimate exceeds the remaining budget, **Start** is disabled with
the reason. Phase 17's `createRun` refuses the same case server-side; the UI only explains it.

**Test reuse is detected, not trusted.** `detectTestReuse(tx, taskId, promptVersionIds)` is true when a
**completed test run** already exists for the task **and** any selected prompt version was created
after it, or an example moved from test to dev after it. That is the moment the test set starts acting
as a dev set. It's extracted from Phase 17's `createRun` so the estimate and the real run use one
function. The launcher shows `TestRunCallout`:

> *The test set is for final numbers. You changed prompts after a previous test run, so this run will be
> marked **test reused** in every export and published page.*

Choosing **test** always requires ticking "This is a final run" (`confirmFinal: true`; the API returns
400 without it).

**SSE patches, the database counts.** Each `progress` message carries the run's **current counters
from the database** (Phase 17 publishes after the `UPDATE runs SET done_cells = done_cells + 1 …
RETURNING`). The hook writes them into `["run", runId]` with `setQueryData`. It never adds up messages:
a dropped or duplicated message can't corrupt the numbers, and a reconnect just shows the latest. On
`status` becoming `completed`, `failed` or `cancelled`, it invalidates `["run", runId, "summary"]` once
so Phase 21's table loads.

**Per-model progress.** `GET …/runs/:id` adds `progressByModel`, one SQL aggregate:

```ts
// run.service.ts (ADAPT)
const byModel = await prisma.result.groupBy({
  by: ["variantId", "status"],
  where: { runId },
  _count: { _all: true },
  _sum: { costUsdMicros: true },
});
```

Map `variantId → model.key` with the run's variants (already loaded). Cache it for 5 s under the `runs`
cache domain, since many tabs may poll it during fallback.

## 6. Steps

1. **API: estimate.**

   ```ts
   // services/run.service.ts (ADAPT)
   export const estimateRun = async (orgId: string, input: RunEstimateRequest) => {
     const task = await prisma.task.findUnique({ where: { id: input.taskId } });
     appAssert(task, NOT_FOUND, "Task not found");
     const examples = await prisma.example.findMany({ where: { taskId: task.id, split: input.split }, select: { input: true } });
     appAssert(examples.length > 0, BAD_REQUEST, `No ${input.split} examples`);
     const meanInputChars = examples.reduce((s, e) => s + e.input.length, 0) / examples.length;
     const [prompts, models] = await Promise.all([
       prisma.promptVersion.findMany({ where: { id: { in: input.promptVersionIds }, taskId: task.id } }),
       prisma.model.findMany({ where: { key: { in: input.modelKeys }, active: true } }),
     ]);
     appAssert(prompts.length === input.promptVersionIds.length && models.length === input.modelKeys.length, BAD_REQUEST, "Unknown prompt or model");

     const variants = [];
     for (const p of prompts) {
       const fixed = await renderedFixedChars(task, p);            // renderPrompt with an empty input (Phase 13)
       for (const m of models) {
         const skipped = p.technique === "structured" && m.structured === "unsupported";
         const cells = skipped ? 0 : examples.length * input.repeats;
         const tokensIn = Math.ceil((fixed + meanInputChars) / 4);
         const tokensOut = Math.ceil(maxTokensOf(p) * (p.technique === "cot" ? 0.8 : 0.4));
         const perCell = callCostMicros(m, tokensIn, tokensOut);  // utils/cost.ts (Phase 14)
         variants.push({ promptVersion: `${p.key}@${p.version}`, modelKey: m.key, cells, skipped,
           estimateUsdMicros: perCell * cells, priceCheckedOn: m.priceCheckedOn });
       }
     }
     const totalUsdMicros = variants.reduce((s, v) => s + v.estimateUsdMicros, 0);
     return {
       cells: variants.reduce((s, v) => s + v.cells, 0),
       variants,
       totalUsdMicros,
       budget: await budgetFor(orgId),                            // { limit, spent, remaining } as numbers
       testReused: input.split === "test" ? await detectTestReuse(prisma, task.id, input.promptVersionIds) : false,
     };
   };
   ```

   Route: `runRoutes.post("/estimate", requireOrgRole("admin"), estimateRunHandler)`, behind the same
   `authenticate` + `resolveOrg` as the rest. `BigInt` budget values are converted to `Number` in the
   service (ADR 0010's rule) before they reach `res.json`.
2. **`RunLauncher`** (a sheet from the task's Runs tab):
   - prompt multi-select grouped by key (latest frozen-or-draft version by default, version dropdown);
   - model multi-select grouped by provider; disabled when `enabled: false` ("add OPENAI_API_KEY");
     each shows price, `priceCheckedOn` and a structured badge;
   - split radio (dev default), repeats 1–5 ("3 measures consistency"), notes;
   - `GridSummary`: "3 prompts × 3 models × 30 examples × 3 repeats = 810 calls (90 skipped: v4 ×
     a model without structured mode)";
   - `CostEstimate` + `BudgetBar` from `useEstimateRun` (debounced 300 ms on selection changes);
   - `TestRunCallout` + the "final run" checkbox when split = test;
   - **Start** → `useCreateRun` → `router.push(/runs/<id>)`.
3. **`useRunEvents(runId)`**:

   ```ts
   export const useRunEvents = (orgId: string, runId: string) => {
     const qc = useQueryClient();
     const [fallback, setFallback] = useState(false);
     useEffect(() => {
       const source = new EventSource(`${API_URL}/orgs/${orgId}/runs/${runId}/events`, { withCredentials: true });
       let grace: ReturnType<typeof setTimeout> | null = null;
       source.onopen = () => { setFallback(false); if (grace) clearTimeout(grace); grace = null; void qc.invalidateQueries({ queryKey: ["run", runId] }); };
       source.onerror = () => { grace ??= setTimeout(() => setFallback(true), 10_000); };
       source.addEventListener("progress", (e) => {
         const p = JSON.parse((e as MessageEvent).data) as RunProgress;
         qc.setQueryData<RunDetail>(["run", runId], (old) => (old ? { ...old, ...p } : old));
         if (p.status !== "queued" && p.status !== "running") void qc.invalidateQueries({ queryKey: ["run", runId, "summary"] });
       });
       return () => { source.close(); if (grace) clearTimeout(grace); };
     }, [orgId, runId, qc]);
     return { fallback };
   };
   ```

   `useRun(runId, { fallback })` sets `refetchInterval: fallback && active ? 3000 : false`. Add
   `runs`, `run` to `USER_SCOPED_KEYS`.
4. **`RunProgress`**: overall bar (`(done + error + skipped) / total`), counters, elapsed time, cost so
   far (from the counters' `costUsdMicros`, formatted as dollars), per-model mini bars from
   `progressByModel`, `RunStatusBadge`, and **Cancel** (an `alert-popup` confirm) → `useCancelRun`.
   A cancelled run keeps its finished cells; the rest show as skipped.
5. **Runs lists**: `RunsTable` (TanStack Table v9, rows from a cursor list): status, task, grid
   (`prompts × models × examples × repeats`), split (with a `test reused` badge), progress %, cost,
   created. Rows link to `/runs/:runId`.

## 7. Verify

```bash
docker compose up -d && pnpm --filter api dev & pnpm --filter web dev
# fast and free: point the models at the fake provider (Phase 14) for steps 1–4
```

1. Launch 2 prompts × 2 models × 30 dev × 1 → `GridSummary` says **120 calls**; the estimate shows
   "prices checked <date>"; `curl -X POST …/runs/estimate` returns the same `cells` and `totalUsdMicros`.
2. Start → the run page bar moves live. DevTools Network: one `events` request (type
   `eventsource`), **no** repeated `GET /runs/:id` polling while it's connected.
3. Stop the API mid-run → after ~10 s polling starts (3 s interval); restart → the stream reconnects,
   polling stops, counters equal `SELECT done_cells, error_cells FROM runs WHERE id = …`.
4. Pair `v4-structured` with a model marked `unsupported` → the launcher says "N skipped" before start;
   after the run the skipped counter equals N.
5. Set `monthly_budget_usd_micros` low (`UPDATE orgs …`) → Start disabled with "Estimate exceeds the
   $X left this month"; `curl POST /runs` with the same body → the API refuses too.
6. Choose **test** without ticking "final run" → Start disabled; with `curl` and `confirmFinal: false` →
   400. Run test once; create `v2-few-shot@2`; select it with test → the reuse callout appears, and the
   created run has `test_reused = true`.
7. Cancel → status `cancelled`, counters settle, the rest counted as skipped; no new `Result` rows
   appear afterwards (`SELECT count(*) …` twice, 10 s apart).

## 8. Definition of done

- [ ] The launcher shows grid size, skipped cells, a dated server-side estimate and the remaining
      budget; over-budget starts are blocked in the UI and the API.
- [ ] Test runs need explicit intent; test reuse is detected by one shared function and shown before
      start.
- [ ] Live progress via SSE patches the cache from database counters; 10 s fallback to polling.
- [ ] Per-model progress from one `groupBy`; cancel works.
- [ ] Commit: `feat(web): run launcher, estimates and live progress`.

## 9. Interview angle

*"Do you know what a benchmark costs before you run it?"* Yes, roughly: the server renders each prompt,
estimates tokens and multiplies by the dated prices. It's labelled as an estimate, it's checked
against the monthly budget, and the real cost streams in from stored results. *"What stops you from
quietly re-running the test set?"* The app detects it: if any prompt changed after a test run, the new
run is marked "test reused", and that mark travels to every export and published page.
