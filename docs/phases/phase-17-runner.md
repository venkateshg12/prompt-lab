# Phase 17 — The runner: cells, limits, retries, progress, DLQ, CLI

## 1. Goal

Run an experiment grid reliably, on PostgreSQL:
- `POST /orgs/:orgId/runs { taskId, promptVersionIds, modelKeys, split, repeats, notes }` validates the
  grid, checks the budget, **freezes** the prompt versions, snapshots prices and rendered prompts, and
  creates the `Run` + its `RunVariant`s **in one transaction**; then enqueues one BullMQ job per
  **cell** (variant × example × repeat) with a deterministic id;
- a cell renders → `complete()` → `scoreOutput()` → inserts its `Result` (unique per cell) and bumps the
  run's counters **in one transaction** → publishes progress;
- the last cell to finish enqueues `run-finalize` (aggregation is Phase 18);
- cancel, a stale-run sweeper, the dead-letter queue with replay, live progress over SSE;
- `pnpm --filter api bench` runs **the same core** from the command line and writes result lines in the
  Playbook format ([../reference/playbook-contract.md](../reference/playbook-contract.md) §1).

## 2. What I will understand after this phase

1. Why the grid is one job per cell, not a loop (architecture.md §1).
2. How a deterministic job id plus a unique result row make every step idempotent.
3. How counters stay exact under retries: they move only in the transaction that inserted the row.
4. The difference between an **error** cell, a **skipped** cell and a **wrong answer**.
5. Why there's no outbox here, and what replaces it (the sweeper + deterministic ids).
6. Why the CLI and the worker share one function.

## 3. Prerequisites

- Phases 13–16 (prompt versions, models + `complete()`, `renderPrompt`, `scoreOutput`).
- Phase 08: BullMQ connection, `constants/queue.ts`, Bull Board, the `maintenance` queue, `worker.ts`
  loaded with `await import("./worker.js")` only when `RUN_WORKERS_IN_API=true` (a static import starts
  workers in the API regardless: a Playbook build lesson).
- Phase 14's `complete(model, price, request, { apiKey?, signal? })` applies the per-model lease
  (`@pt-api/src/ai/concurrency.ts`) and transport retries (`@pt-api/src/ai/reliability.ts`), and
  returns `{ text, usage, finishReason, latencyMs, costUsdMicros, attempts }`.

## 4. Files

```
apps/api/prisma/schema.prisma                     ADAPT (+ RunStatus, ResultStatus, Run, RunVariant, Result; data-model.md)
apps/api/prisma/migrations/<ts>_runs/             NEW   (prisma migrate dev --name runs)
packages/types/src/run.ts                         NEW   (createRunSchema, cellPayloadSchema, resultLineSchema)
apps/api/src/
├── runner/
│   ├── cellJobId.ts                              NEW   (cell-<runId>-<16-hex sha1 of variant|example|repeat>)
│   ├── snapshot.ts                               NEW   (render each variant's prompt once per run; maxTokens = MAX_TOKENS_BY_TECHNIQUE[technique], Phase 13)
│   ├── createRun.ts                              NEW
│   ├── executeCell.ts                            NEW   (the shared core: render → complete → score)
│   ├── persistCell.ts                            NEW   (insert Result + counters, one transaction)
│   └── resultLine.ts                             NEW   (Result → Playbook line; reused by Phase 22/27 exports)
├── jobs/queues/{runCell,runFinalize}.queue.ts    NEW   (shape of @pt-api/src/jobs/queues/extract.queue.ts)
├── jobs/workers/{runCell,runFinalize}.worker.ts  NEW   (shape of @pt-api/src/jobs/workers/extract.worker.ts)
├── jobs/processors/runCell.processor.ts          NEW
├── jobs/processors/runFinalize.processor.ts      NEW   (marks completed; Phase 18 fills in the aggregates)
├── jobs/processors/staleRuns.processor.ts        ADAPT @pt-api/src/jobs/processors/sweeper.processor.ts
├── jobs/queues/deadLetter.queue.ts               COPY  @pt-api/src/jobs/queues/deadLetter.queue.ts
├── jobs/deadLetter.ts                            ADAPT @pt-api/src/jobs/deadLetter.ts (cells, not documents; no outbox)
├── services/dlq.service.ts                       ADAPT @pt-api/src/services/dlq.service.ts (drop resumeBlockedDocument)
├── controllers/dlq.controller.ts · routes/dlq.route.ts   COPY @pt-api/src/{controllers,routes}/dlq.*.ts
├── utils/events/{sse,streamLimiter}.ts           COPY  @pt-api/src/utils/events/
├── utils/events/pubsub.ts                        ADAPT @pt-api/src/utils/events/pubsub.ts (channel pl:events:<runId>; RunProgress)
├── services/run.service.ts                       NEW   (create, list, get, cancel)
├── controllers/run.controller.ts · routes/run.route.ts   NEW   (POST /runs behind Phase 06's runCreateLimiter)
├── constants/queue.ts                            ADAPT (+ RUN_CELL, RUN_FINALIZE, DEAD_LETTER; job names)
├── constants/env.ts                              ADAPT (+ CELL_BACKOFF_MS default 5000, OWNER_RUNS_REQUIRE_ADMIN default false)
├── jobs/dashboard/bull-board.ts                  ADAPT (+ the two queues)
├── worker.ts                                     ADAPT (start/close the two workers; schedule stale-runs every 5 min)
└── scripts/bench.ts                              NEW   (the CLI)
```

**One addition to data-model.md:** `Run.promptSnapshots Json @map("prompt_snapshots")`. The rendered
system text, few-shot turns and schema per variant must be frozen with the run (§5). Add it in this
phase's migration and update data-model.md in the same commit.

## 5. Concepts

**Why one job per cell.** A grid of 5 prompts × 3 models × 70 examples × 3 repeats is 3,150 calls
and tens of minutes. A loop inside one job loses everything on a deploy, can't pace providers
independently and can't show cell-level progress. One job per cell gives retries per cell, per-model
pacing across every worker (the leases), resumability and progress.

**Idempotency, three locks.**
1. **Job id** `cell-<runId>-<h>`, where `h` is the first 16 hex characters of
   `sha1(variantId + "|" + exampleId + "|" + repeat)`: adding the same cell twice is a no-op while the
   job exists. Four raw UUIDs would make a ~150-character id that is hard to read in Bull Board and in
   logs; the hash keeps it short and still deterministic (2^64 space per run, so no collisions in
   practice). The cell's ids travel in the payload. Dashes only: BullMQ rejects custom ids containing `:`.

   ```ts
   // runner/cellJobId.ts
   import { createHash } from "node:crypto";
   export const cellJobId = (runId: string, variantId: string, exampleId: string, repeat: number) =>
       `cell-${runId}-${createHash("sha1").update(`${variantId}|${exampleId}|${repeat}`).digest("hex").slice(0, 16)}`;
   ```
2. **Unique row** `results (run_id, variant_id, example_id, repeat_index)`: a second insert raises
   `P2002`, caught as "already done".
3. **Counters move only with the insert**: `persistCell` inserts the `Result` and increments
   `Run.doneCells` (and `errorCells`) in **one** `withTransaction`. A retried cell hits `P2002`, the
   transaction rolls back, nothing is counted twice.

**No outbox, on purpose.** Starting a run commits the run, then enqueues the cells. If the API dies
in between, the run sits `queued` with no jobs. The **stale-run sweeper** (every 5 minutes) finds runs
`queued` or `running` with no progress for 10 minutes and re-adds every cell that has no `Result`
yet. Deterministic ids and the unique row make that safe to repeat. This is the same pattern as
PaperTrail's `sweeper.processor.ts`, and it's why the outbox wasn't copied (inherited-architecture.md).

**Three kinds of non-success**, kept apart in data and UI:

| Kind | Example | `Result.status` | In accuracy? |
| --- | --- | --- | --- |
| wrong answer | invalid JSON, wrong salary | `scored` | **yes**: that's the measurement |
| error | 429 until retries ran out, provider down, 401, 410 retired model | `error` | **no**: counted and listed |
| skipped | `structured` prompt × `unsupported` model; cancelled run | `skipped` (`error` holds the reason) | **no**: "n/a" |

Counting errors as zeros would make a rate-limited provider look like a bad prompt.

**Retries at two levels.** `complete()` retries 408/429/5xx/timeouts inside the call (3 attempts with
jitter). The cell job retries the whole cell (`attempts: 5`, exponential from 5 s) for
`ProviderBusy`/`ProviderUnavailable`/`ProviderTimeout`. On the **final** attempt, or for an
unrecoverable error (400, 401, 403, 404, 410), the cell writes an `error` result and **completes**
the job, so the run can still finish. The DLQ only receives jobs that failed for reasons the cell
couldn't record (the database was down, a bug).

**Snapshot first.** `createRun` renders each variant's prompt once with a placeholder input and stores
system text, few-shot turns, schema and `fewShotStyle` in `Run.promptSnapshots`. Cells render only the
final user turn. A few-shot label edited mid-run can't change what later cells see.

**Budget check before spending.** The upper-bound estimate is
`cells × (inputTokensEstimate × inPrice + maxTokens × outPrice)`, from the price snapshot. If this
month's spent `Σ results.cost_usd_micros` plus the estimate exceeds `Org.monthlyBudgetUsdMicros`,
the run is refused (`402 BUDGET_EXCEEDED`) before anything is enqueued. `MAX_CELLS_PER_RUN = 5000`.

**`testReused`.** When a run uses `split: test` and an earlier non-cancelled test run exists on the
same task with the same `datasetHash`, the new run is created with `testReused: true`. Every export and
summary carries the flag. The protocol is "test once", and the data says when that was broken.

**Cancel.** `POST …/runs/:id/cancel` sets `status: cancelled` (conditional: only from `queued`/`running`).
Each cell checks the run status before calling a model and records `skipped` with error `cancelled`.
Queued jobs drain in seconds without spending money, and completed results are kept.

## 6. Steps

### 6.1 Schema and migration

Add the `runs` models exactly as in data-model.md, plus `promptSnapshots`. Then
`pnpm --filter api exec prisma migrate dev --name runs < /dev/null && pnpm --filter api exec prisma generate`
(Prisma 7's `migrate dev` no longer runs `generate`). Add `Run`, `RunVariant`, `Result` to
`TENANT_MODELS` (they're already listed if Phase 03 copied the full set).

### 6.2 `createRun`

```ts
export const createRun = async (orgId: string, userId: string, body: CreateRun) => {
    const task = await prisma.task.findFirst({ where: { id: body.taskId } });                 // tenant-scoped
    appAssert(task, NOT_FOUND, "Task not found");
    const prompts = await prisma.promptVersion.findMany({ where: { id: { in: body.promptVersionIds }, taskId: task.id } });
    appAssert(prompts.length === body.promptVersionIds.length, NOT_FOUND, "Prompt version not found");
    const models = await prisma.model.findMany({ where: { key: { in: body.modelKeys }, active: true } });
    appAssert(models.length === body.modelKeys.length, BAD_REQUEST, "Model not active", appErrorCode.ModelInactive);
    for (const p of prompts) for (const m of models)
        appAssert(!(p.technique === "structured" && m.structured === "untested"), BAD_REQUEST,
            `Probe ${m.key} before running a structured prompt on it`, appErrorCode.ModelUnprobed);

    const examples = await prisma.example.findMany({ where: { taskId: task.id, split: body.split }, select: { id: true, ref: true, revision: true }, orderBy: { ref: "asc" } });
    appAssert(examples.length > 0, BAD_REQUEST, `No ${body.split} examples`);
    const totalCells = prompts.length * models.length * examples.length * body.repeats;
    appAssert(totalCells <= MAX_CELLS_PER_RUN, BAD_REQUEST, `Run too large (${totalCells} cells)`);

    const datasetHash = sha256(examples.map((e) => `${e.ref}:${e.revision}`).join("\n"));
    const pricesSnapshot = Object.fromEntries(models.map((m) => [m.key, pick(m, ["inputUsdMicrosPerMTok", "outputUsdMicrosPerMTok", "priceCheckedOn", "priceNote"])]));
    await assertWithinBudget(task.orgId, estimateCost(prompts, models, examples.length * body.repeats));
    const snapshots = await buildSnapshots(task, prompts);           // renderPrompt with the few-shot examples' CURRENT labels

    const run = await withTransaction(async (tx) => {
        await freezePromptVersions(tx, task.id, body.promptVersionIds);       // Phase 13: sets frozenAt where null, audits
        const testReused = body.split === "test" &&
            (await tx.run.count({ where: { taskId: task.id, split: "test", datasetHash, status: { not: "cancelled" } } })) > 0;
        return tx.run.create({
            data: {
                orgId, taskId: task.id, taskVersion: task.version, split: body.split, repeats: body.repeats,
                datasetHash, testReused, pricesSnapshot, promptSnapshots: snapshots, totalCells, notes: body.notes, startedById: userId,
                variants: { create: prompts.flatMap((p) => models.map((m) => ({ orgId, promptVersionId: p.id, modelId: m.id }))) },
            },
            include: { variants: true },
        });
    });
    await enqueueCells(run, examples);          // after commit; the sweeper covers a crash right here
    return run;
};
```

`enqueueCells` uses `runCellQueue.addBulk` in chunks of 500, ordered **example-outer, variant-inner**,
so early progress covers every model instead of finishing one first. Payload:
`{ orgId, runId, variantId, exampleId, repeat, traceId }`, and nothing else (ids only, never prompt
text or keys).

**Who may spend the server's keys.** `run.controller.ts` checks, before calling `createRun`:

```ts
appAssert(OWNER_RUNS_REQUIRE_ADMIN !== "true" || req.role === "admin", FORBIDDEN,
    "Runs on the server's model keys are limited to the owner", appErrorCode.OwnerRunsAdminOnly);
```

Production sets `OWNER_RUNS_REQUIRE_ADMIN=true` (Phase 29), so a stranger who signs up can't start a
paid run. The `bench` CLI runs on your machine with your keys and skips the check.

### 6.3 `executeCell` (the shared core)

```ts
export const executeCell = async (cell: CellContext, deps: { complete: CompleteFn; apiKey?: string; signal?: AbortSignal }): Promise<CellOutcome> => {
    if (cell.prompt.technique === "structured" && cell.model.structured === "unsupported")
        return { status: "skipped", error: "structured_unsupported" };
    const snap = cell.snapshot;
    const user = renderTemplate(cell.prompt.template, { ...snap.shared, input: cell.example.input });
    const call = await deps.complete(cell.model, cell.price, {      // price from Run.pricesSnapshot
        system: snap.system, messages: [...snap.fewShotTurns, { role: "user", content: user }],
        structured: snap.structured, temperature: snap.temperature, maxTokens: snap.maxTokens,
    }, { apiKey: deps.apiKey, signal: deps.signal });
    const s = scoreOutput({ rawText: call.text, technique: cell.prompt.technique, fields: cell.task.fields, expected: cell.example.expected });
    return {
        status: "scored", rawOutput: call.text, extractedText: s.extractedText, parsedJson: s.parsed,
        validJson: s.validJson, schemaValid: s.schemaValid, fieldScores: s.fieldScores, fieldDetails: s.fieldDetails,
        overallScore: s.overallScore, exactMatch: s.exactMatch, finishReason: call.finishReason,
        inputTokens: call.usage.inputTokens, outputTokens: call.usage.outputTokens,
        costUsdMicros: call.costUsdMicros,   /* complete() priced it with the run's snapshot */ latencyMs: call.latencyMs, attempts: call.attempts,
    };
};
```

Cost comes from the **run's price snapshot**, not the live registry, so a price edit tomorrow can't
change yesterday's numbers.

### 6.4 `persistCell` and the processor

```ts
export const persistCell = async (p: CellPayload, outcome: CellOutcome) => {
    try {
        const run = await withTransaction(async (tx) => {
            await tx.result.create({ data: { orgId: p.orgId, runId: p.runId, variantId: p.variantId, exampleId: p.exampleId, repeatIndex: p.repeat, ...outcome } });
            await tx.run.updateMany({ where: { id: p.runId, status: "queued" }, data: { status: "running" } });
            return tx.run.update({
                where: { id: p.runId },
                data: { doneCells: { increment: 1 }, ...(outcome.status === "error" && { errorCells: { increment: 1 } }) },
                select: { id: true, status: true, doneCells: true, errorCells: true, totalCells: true },
            });
        });
        await publishRunProgress(run);                        // throttled, never throws
        if (run.doneCells === run.totalCells) await runFinalizeQueue.add("finalize", { orgId: p.orgId, runId: p.runId }, { jobId: `finalize-${p.runId}` });
    } catch (e) {
        if (isUniqueViolation(e)) return;                     // this cell was already recorded: count nothing
        throw e;
    }
};
```

Exactly one transaction sees `doneCells === totalCells` (the increments are serialised by the row
lock), so `finalize` is enqueued once, and its job id dedupes it anyway.

```ts
export async function processRunCell(job: Job<CellPayload>) {
    const p = cellPayloadSchema.parse(job.data);
    return runWithRequestContext({ requestId: p.traceId ?? String(job.id), orgId: p.orgId, runId: p.runId }, async () => {
        const ctx = await loadCellContext(p);                 // run (status, snapshots, prices), variant, prompt, model, example, task; cell.price = run.pricesSnapshot[model.key]
        if (!ctx) throw new UnrecoverableError("Run or cell deleted");
        if (ctx.run.status === "cancelled") return persistCell(p, { status: "skipped", error: "cancelled" });
        try {
            return persistCell(p, await executeCell(ctx, { complete }));
        } catch (error) {
            const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
            if (isTransient(error) && !final) throw error;    // BullMQ backoff
            return persistCell(p, { status: "error", error: errorCode(error), attempts: job.attemptsMade + 1 });
        }
    });
}
```

`isTransient` = `ProviderBusy | ProviderUnavailable | ProviderTimeout | isRetryable(error)` (all from
`@pt-api/src/ai/{errors,reliability}.ts` via Phase 14). The error string is a code plus at most 300
characters of the provider message, after the key-pattern scrub (`nvapi-…`, `sk-…`). Worker:
`concurrency: 16` (the leases do the per-model pacing), `lockDuration: 240_000`. Queue:
`attempts: 5`, `backoff: { type: "exponential", delay: CELL_BACKOFF_MS }` (env, default `5000`; tests set
`20`), `removeOnComplete: { age: 86400, count: 20000 }`.

### 6.5 Finalize, sweeper, DLQ

- `runFinalize.processor.ts`: `updateMany({ where: { id, status: "running" }, data: { status: "completed", finishedAt } })`
  (a cancelled run stays `cancelled`). `// Phase 18:` compute `RunVariant.summary` here, bump `runs`.
  Then enqueue the "run finished" email (Phase 08's producer) to the starter.
- `staleRuns.processor.ts` (ADAPT the sweeper): `runAsSystem`, find runs `queued|running` whose
  `updatedAt` is older than 10 minutes, load their variants and examples, `addBulk` every cell without
  a `Result`. Same ids, so live jobs aren't duplicated. A run whose every cell has a result but is
  still `running` gets its `finalize` job re-added.
- `deadLetter.ts` (ADAPT): on a cell's final failure, record an `error` result through `persistCell`
  (so the run completes), then copy the job to `dead-letter` with `jobId: dead-${job.id}`. The
  document/outbox code from PaperTrail is removed.
- `dlq.service.ts` (ADAPT): `listDead`, `discardDeadJob`, and `replayDeadJob`. Replaying a cell first
  deletes its `error` result and decrements `doneCells`/`errorCells` in one transaction, sets the run
  back to `running` if it had completed, then re-adds the cell with its original job id.

### 6.5b Hand-offs from earlier phases (resolve every `// Phase 17:` comment)

| Comment in | Do |
| --- | --- |
| Phase 01 `index.ts` shutdown | `await closePubSub()` after the workers close, before `disconnectDB()` |
| Phase 03 `utils/db` | add `money.ts`: `toBigMicros`, `sumMicros`, `microsToUsd` (BigInt-safe totals for runs and the workspace budget) |
| Phase 08 `constants/queue.ts`, `jobs/deadLetter.ts` | the `RUN_CELL`, `RUN_FINALIZE` queues, `RUN_FINISHED` email, `SWEEP_STALE_RUNS` schedule (every 5 min); the dead-letter hook writes the cell's `Result` with `status: "error"` before moving the job |
| Phase 10 `deleteOrg` | before the delete transaction: mark the workspace's `queued|running` runs `cancelled` (so remaining cells record `skipped`), then delete; cascades remove runs and results |
| Phase 11 `updateTask` | return `runsAffected = count(runs where taskId and taskVersion < task.version)`; the UI shows "N runs were scored with an earlier version" |
| Phase 11 `deleteTask` | `appAssert(!(await prisma.run.count({ where: { taskId } })), CONFLICT, "This task has runs. Archive it instead.")` |
| Phase 12 auto-split `reassign: true` | refuse with 409 when a run with `split: "test"` exists for the task |
| Phase 12 `updateExample` test → dev | if a test run used the example, set `testReused` on the **next** test run via `detectTestReuse` (below) and audit it |
| Phase 12 example delete | 409 when any `Result` references the example (`prisma.result.count({ where: { exampleId } })`) |

`detectTestReuse(taskId, split)`: `split === "test"` and a completed test run exists for this task, or
an `example.split_moved` audit row exists for it. `createRun` stores the result in `Run.testReused`,
and every export line carries it.

### 6.6 Progress over SSE

COPY `sse.ts` and `streamLimiter.ts`. ADAPT `pubsub.ts`: channel `pl:events:<runId>`, message
`{ runId, status, doneCells, errorCells, totalCells, at }`. Publishing is throttled to one message per
run per 500 ms (`SET pl:progress:<runId> 1 NX PX 500`), except the final message, which always goes
out. `GET /orgs/:orgId/runs/:id/events` (viewer) sends the current state first, then live messages.

### 6.7 The CLI

```
pnpm --filter api bench -- --task job-postings --split dev \
  --prompts v1-zero-shot@1,v2-few-shot@1,v4-structured@1 --models nvidia:openai/gpt-oss-20b,nvidia:nvidia/nemotron-3-super-120b-a12b \
  --repeats 1 --concurrency 4 [--replay] [--save] [--out runs/2026-11-05-dev.jsonl]
```

1. Load the task, examples, prompt versions and models from PostgreSQL (`--from-files` reads
   `cases/<task>/` instead, for the weekend version).
2. Build snapshots with `buildSnapshots`, the same function `createRun` uses.
3. Run cells through a ~15-line in-process concurrency pool calling `executeCell` (`--replay` swaps in
   Phase 14's replay provider).
4. `--save` creates a real `Run` via `createRun`'s transaction and inserts every result through
   `persistCell`, so CLI runs appear in the UI. Without it, `runId` is `cli-<uuidv7>`.
5. `--out` writes one line per cell with `toResultLine` (`runner/resultLine.ts`):

```ts
export const toResultLine = (r: ResultWithRefs) => ({
    runId: r.runId, split: r.split, promptVersion: `${r.promptKey}@${r.promptVersion}`, modelKey: r.modelKey,
    exampleId: r.exampleRef, repeat: r.repeatIndex, status: r.status, rawOutput: r.rawOutput ?? null,
    validJson: r.validJson ?? null, schemaValid: r.schemaValid ?? null, exactMatch: r.exactMatch ?? null,
    overallScore: r.overallScore ?? null, fieldScores: r.fieldScores?.map(({ key, score }) => ({ key, score })) ?? null,
    outputTokens: r.outputTokens ?? null, costUsdMicros: r.costUsdMicros ?? null, latencyMs: r.latencyMs ?? null,
    completedAt: r.completedAt.toISOString(),
    // extras the contract allows (§1): tags, fieldDetails, inputTokens, error, testReused
    tags: r.exampleTags, fieldDetails: r.fieldDetails ?? null, inputTokens: r.inputTokens ?? null, error: r.error ?? null, testReused: r.testReused,
});
```

Validate every line against `resultLineSchema` (a copy of the Playbook's `promptLabResultLineSchema`)
before writing it. A contract break fails the CLI, not the Playbook's importer weeks later. Read a
flag's value only after checking `args.indexOf(flag) !== -1`. Close Prisma, the queue connection and
the cache in `finally`, or the script hangs on open sockets.

## 7. Verify

```bash
# 2 prompts × 2 models × 30 dev × 1 repeat, fake provider (LLM_PROVIDER=fake)
curl -s -b c.txt -X POST localhost:5000/orgs/$ORG/runs -H 'content-type: application/json' \
  -d "{\"taskId\":\"$TASK\",\"promptVersionIds\":[\"$V1\",\"$V2\"],\"modelKeys\":[\"fake:a\",\"fake:b\"],\"split\":\"dev\",\"repeats\":1}" | jq '.data.totalCells'
# 120
curl -sN -b c.txt localhost:5000/orgs/$ORG/runs/$RUN/events     # doneCells rises to 120, status completed
psql "$DATABASE_URL" -c "select status, count(*) from results where run_id='$RUN' group by 1"
```

1. Bull Board shows 120 `cell-…` jobs; the run ends `completed`; 120 results; `done_cells = 120`.
2. Kill the worker halfway, restart → it continues; `select count(*) … group by run_id, variant_id, example_id, repeat_index having count(*) > 1` returns nothing.
3. `FAKE_LLM_SCRIPT` with 429 × 4 on one cell → it retries and succeeds; with 429 forever → an
   `error` result, and the run still completes with `error_cells = 1`.
4. A `structured` prompt on an `unsupported` model → those cells `skipped`; on an `untested` model →
   `400 MODEL_UNPROBED` and no run row.
5. Cancel mid-run → remaining cells `skipped` (`cancelled`) within seconds, no further model calls in
   the logs.
6. Edit a few-shot example's label mid-run → `runs.prompt_snapshots` unchanged.
7. Delete the cell jobs from Redis right after creating a run (simulated crash), wait for the sweeper
   (or run it by hand) → the run completes with no duplicate results.
8. Set `monthly_budget_usd_micros` to 1 → `402 BUDGET_EXCEEDED`, nothing enqueued.
9. `bench -- … --replay --out /tmp/r.jsonl` → every line passes the Playbook schema; running the
   Playbook importer with `--dry-run` on it succeeds (full check in Phase 27).

## 8. Definition of done

- [ ] Run creation freezes prompts and snapshots prices and prompts in one transaction.
- [ ] Deterministic cell ids (dashes), a unique row per cell, counters that move only with the insert.
- [ ] Errors and skips are recorded, never counted as wrong answers; runs always reach a terminal state.
- [ ] Cancel, sweeper, DLQ with replay, throttled SSE progress.
- [ ] The CLI uses the same core and writes contract-valid result lines.
- [ ] data-model.md updated with `Run.promptSnapshots` in the same commit.
- [ ] Commit: `feat: queue-backed experiment runner, sweeper, DLQ and CLI`.

## 9. Interview angle

*"How do you run thousands of model calls without double-counting or losing a run?"* Each cell is a
job with a deterministic id, and its result row is unique on the cell key. The insert and the counter
increment are one transaction, so a retried cell hits the unique constraint and counts nothing. If the
API dies between committing a run and enqueuing it, a sweeper re-adds the missing cells, and the same
two locks make that safe. A provider that stays down produces error cells, excluded from accuracy and
listed. The CLI runs the identical core.
