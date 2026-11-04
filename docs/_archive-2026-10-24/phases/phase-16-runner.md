# Phase 16 — The runner: fan-out, limits, retries, progress, CLI

## 1. Goal

Run an experiment grid reliably:
- `POST /runs { taskId, promptIds, modelKeys, split, repeats, notes }` validates the grid,
  **freezes** the prompt versions and creates the run **in one transaction**, then enqueues it;
- the **run job** snapshots the rendered prompts and fans out one **cell job** per
  prompt × model × example × repeat, each with a **deterministic id**;
- a **cell** renders → `complete()` → `scoreOutput()` → upserts a `Result` (unique on the cell key)
  → increments run counters atomically → publishes progress;
- per-provider pacing (the Phase 13 lease and RPM budget), retries only on transport errors, error
  cells recorded, **cancel**, live progress over SSE;
- `pnpm --filter api bench` runs **the same core** in-memory from the command line, the spec's
  reproducibility script.

## 2. What I will understand after this phase

1. Why the grid is fanned out as individual jobs, not one loop.
2. How deterministic job ids plus a unique result key make every step idempotent.
3. How run counters stay correct under retries (the `$inc` only on first insert).
4. The difference between an error cell, a skipped cell and a wrong answer.
5. Why the CLI and the worker share one function.

## 3. Prerequisites

Phase 15 done.

## 4. Files

```
packages/types/src/run.ts                       NEW   (create-run schema, statuses, cell key)
apps/api/src/
├── models/{run,result}.model.ts                NEW
├── services/run.service.ts                     NEW   (createRun, cancelRun, listRuns, getRun)
├── core/executeCell.ts                         NEW   (the shared core: render → complete → score)
├── jobs/queues/{run,cell}.queue.ts             NEW   (shape of email.queue.ts)
├── jobs/processors/{run,cell}.processor.ts     NEW
├── jobs/workers/{run,cell}.worker.ts           NEW
├── jobs/interfaces/jobPayload.ts               ADAPT (+ RunPayload, CellPayload)
├── jobs/dashboard/bull-board.ts                ADAPT (+ run, cell queues)
├── constants/queue.ts                          ADAPT (+ RUN, CELL)
├── utils/events/{pubsub,sse,streamLimiter}.ts  ADAPT @pt-api/src/utils/events/  (channel pl:events:<ownerId>; message = run progress)
├── controllers/{run,events}.controller.ts · routes/{run,events}.route.ts   NEW
├── worker.ts                                   ADAPT (close run + cell workers)
└── scripts/bench.ts                            NEW   (CLI on the same core)
```

## 5. Concepts

**Why jobs, not a loop.** A grid of 3,150 calls takes tens of minutes. A loop inside one job loses
everything on a crash or deploy, can't pace providers independently, and can't show cell-level
progress. One job per cell gives you retries per cell, per-provider concurrency across all workers,
resumability (completed cells stay done), and progress for free.

**Idempotency at three levels.**
1. `POST /runs` is guarded by `runCreateLimiter` and a 10 s duplicate check (same task, prompts,
   models, split and repeats from the same owner → returns the existing queued run). A double-click
   doesn't create two runs.
2. Job ids: `run:<runId>`, `cell:<runId>:<promptId>:<modelKey>:<exampleId>:<repeat>`. Re-running the
   fan-out (a retried run job) adds no duplicates. (BullMQ job ids can't contain `:` in some versions;
   check, and use `__` as the separator if so.)
3. `Result` is unique on `{ runId, promptId, modelKey, exampleId, repeat }`. The cell **upserts**, and
   only when the upsert **inserted** does it `$inc` the run counters. A retried cell can't
   double-count progress.

**Three kinds of non-success** (keep them apart in the data and the UI):

| Kind | Example | Counts toward accuracy? |
| --- | --- | --- |
| wrong answer | invalid JSON, wrong salary | **yes**: that's the measurement |
| error cell | 429s until retries ran out, provider down, timeout | **no**: `error` set, listed separately |
| skipped cell | `structured` prompt × model whose structured mode is `unsupported` | **no**: shown as "n/a" |

Mixing errors into accuracy would make a flaky provider look like a bad prompt.

**Retries.** Inside `complete()`: 3 attempts with jitter on 429/5xx/timeouts. Around it, the cell job:
5 attempts with exponential backoff (5 s → 80 s) for `ProviderSkipped` / `ProviderBusy` /
retryable HTTP errors, so a provider outage is waited out rather than turned into errors. On the
final attempt the cell writes an **error result** (`error: { code, message }`, `overallScore: null`)
and completes. It doesn't fail the job, so the run can still finish. 4xx (bad key, bad model id) are
unrecoverable immediately: an error result, no retries.

**Snapshot first.** The run job renders each prompt's system text, few-shot turns and structured
schema once and stores them on the run (`promptSnapshots`). Cells then render only the per-example
user turn from the snapshot. A label edit mid-run can't change the few-shot block between cells.

**Freezing in a transaction.** `createRun` freezes the prompt versions and inserts the run in one
`withTransaction` (Phase 03). Either both happen or neither, so a prompt is never "used by a run that
doesn't exist", or the reverse.

**Cancel.** `POST /runs/:id/cancel` sets `status: "cancelling"`. Cells check the run status before
calling a model and finish as `skipped: "cancelled"`. Then the run moves to `cancelled`. Already
queued jobs drain quickly without spending money. Completed results are kept.

**Completion.** When `completed + errored + skipped === total` after an `$inc` (read in the same
`findOneAndUpdate` with `returnDocument: "after"`), that cell sets `status: "completed"` (conditional
on the status still being `running`, so exactly one cell wins), bumps the `results` cache domain and
publishes `done`.

**One core, two drivers.** `executeCell(ctx, cell)` takes everything it needs as arguments (snapshots,
task, example, model) and returns the result document. The cell processor calls it and persists; the
CLI calls it in a bounded-concurrency loop and writes JSONL + a summary. Same rendering, same model
call, same scoring. PaperTrail's `extractInMemory` lesson: an eval must run the production path.

## 6. Steps

### 6.1 Models

```ts
// models/run.model.ts
const runSchema = new mongoose.Schema({
    ownerId: { type: Schema.Types.ObjectId, required: true },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    promptIds: [Schema.Types.ObjectId],
    modelKeys: [String],
    split: { type: String, enum: ["dev", "test"], required: true },
    repeats: { type: Number, min: 1, max: 5, default: 1 },
    exampleIds: [Schema.Types.ObjectId],                       // fixed at creation: the run's population
    fieldsVersion: Number,                                     // task rules version used for scoring
    status: { type: String, enum: ["queued", "running", "cancelling", "cancelled", "completed"], default: "queued" },
    totals: { total: Number, completed: { type: Number, default: 0 }, errored: { type: Number, default: 0 }, skipped: { type: Number, default: 0 } },
    costUsdMicros: { type: Number, default: 0 },
    promptSnapshots: [{ promptId: Schema.Types.ObjectId, system: String, fewShotTurns: Schema.Types.Mixed, structured: Schema.Types.Mixed, fewShotStyle: String, _id: false }],
    notes: String,
    byok: { type: Boolean, default: false },                   // Phase 22
    publishedSlug: { type: String, unique: true, sparse: true },   // Phase 21
    startedAt: Date, completedAt: Date,
}, { timestamps: true });
runSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });
```

```ts
// models/result.model.ts
const resultSchema = new mongoose.Schema({
    ownerId: { type: Schema.Types.ObjectId, required: true },
    runId: { type: Schema.Types.ObjectId, required: true },
    promptId: { type: Schema.Types.ObjectId, required: true },
    modelKey: { type: String, required: true },
    exampleId: { type: Schema.Types.ObjectId, required: true },
    repeat: { type: Number, required: true },
    status: { type: String, enum: ["scored", "error", "skipped"], required: true },
    rawOutput: String,
    extractedText: String,
    parsed: Schema.Types.Mixed,
    validJson: Boolean, schemaValid: Boolean, exactMatch: Boolean,
    fieldScores: [{ key: String, score: Number, reason: String, expected: Schema.Types.Mixed, predicted: Schema.Types.Mixed,
                    normExpected: Schema.Types.Mixed, normPredicted: Schema.Types.Mixed, _id: false }],
    overallScore: Number,
    canonicalAnswer: String,
    finishReason: String,
    inputTokens: Number, outputTokens: Number, costUsdMicros: Number, latencyMs: Number, attempts: Number,
    labelVersion: Number, fieldsVersion: Number,
    error: { code: String, message: String },
    skippedReason: String,
}, { timestamps: true });
resultSchema.index({ runId: 1, promptId: 1, modelKey: 1, exampleId: 1, repeat: 1 }, { unique: true });
resultSchema.index({ runId: 1, promptId: 1, modelKey: 1, overallScore: 1 });     // error browser: worst first
```

### 6.2 `createRun`

```ts
export const createRun = async (ownerId: Types.ObjectId, body: CreateRunSchema) => {
    const task = await getTask(ownerId, body.taskId);
    const prompts = await PromptModel.find({ _id: { $in: body.promptIds }, ownerId, taskId: task._id }).lean();
    appAssert(prompts.length === body.promptIds.length, NOT_FOUND, "Prompt not found");
    const models = await ModelModel.find({ key: { $in: body.modelKeys }, enabled: true }).lean();
    appAssert(models.length === body.modelKeys.length, BAD_REQUEST, "Model not enabled");
    const examples = await ExampleModel.find({ ownerId, taskId: task._id, split: body.split, archivedAt: null }).select("_id").lean();
    appAssert(examples.length > 0, BAD_REQUEST, `No ${body.split} examples`);
    const total = prompts.length * models.length * examples.length * body.repeats;
    appAssert(total <= MAX_CELLS_PER_RUN, BAD_REQUEST, `Run too large (${total} cells, max ${MAX_CELLS_PER_RUN})`);

    const run = await withTransaction(async (session) => {
        await PromptModel.updateMany({ _id: { $in: body.promptIds }, frozenAt: null }, { $set: { frozenAt: new Date() } }, { session });
        const [created] = await RunModel.create([{
            ownerId, taskId: task._id, promptIds: body.promptIds, modelKeys: body.modelKeys, split: body.split,
            repeats: body.repeats, exampleIds: examples.map((e) => e._id), fieldsVersion: task.fieldsVersion,
            totals: { total }, notes: body.notes,
        }], { session });
        return created;
    });
    await runQueue.add(JOB_NAMES.RUN.FAN_OUT, { runId: String(run._id), ownerId: String(ownerId), traceId: getRequestId() },
                       { jobId: `run:${run._id}` });
    return run;
};
```

`MAX_CELLS_PER_RUN = 5000` for owners (a full spec grid is 3,150). Phase 22 sets 30 for demo runs.

### 6.3 Run processor (fan-out)

1. Load the run. If it isn't `queued`/`running`, return.
2. Build `promptSnapshots` once: `renderPrompt` with a placeholder input, keeping the system text,
   few-shot turns and structured schema. Store them with `$set` only if not already set (idempotent).
3. `status: running`, `startedAt`.
4. Add the cells with `cellQueue.addBulk` (in chunks of 500), each with its deterministic `jobId`.
   Order the loops **example-outer, model-inner**, so early progress covers every model rather than
   finishing one model first. `pnpm` users watching the table get a fair partial view.

### 6.4 `core/executeCell.ts`

```ts
export const executeCell = async (cell: CellContext, deps: { complete: typeof complete; signal?: AbortSignal; apiKey?: string }): Promise<ResultFields> => {
    if (cell.prompt.technique === "structured" && cell.model.structured === "unsupported") {
        return { status: "skipped", skippedReason: "structured_unsupported" };
    }
    const userTurn = renderTemplate(cell.prompt.user, { ...cell.sharedValues, input: cell.example.input });
    const request = {
        system: cell.snapshot.system,
        messages: [...cell.snapshot.fewShotTurns, { role: "user" as const, content: userTurn }],
        structured: cell.snapshot.structured,
        temperature: cell.prompt.options.temperature,
        maxTokens: cell.prompt.options.maxTokens,
    };
    const call = await deps.complete(cell.model, request, { apiKey: deps.apiKey, signal: deps.signal });
    const score = scoreOutput({ rawText: call.text, technique: cell.prompt.technique, fields: cell.task.fields, expected: cell.example.expected as Record<string, unknown> });
    return {
        status: "scored", rawOutput: call.text, finishReason: call.finishReason,
        inputTokens: call.usage.inputTokens, outputTokens: call.usage.outputTokens, costUsdMicros: call.costUsdMicros,
        latencyMs: call.latencyMs, attempts: call.attempts, labelVersion: cell.example.labelVersion, fieldsVersion: cell.task.fieldsVersion,
        ...pick(score, ["extractedText", "parsed", "validJson", "schemaValid", "exactMatch", "fieldScores", "overallScore", "canonicalAnswer"]),
    };
};
```

### 6.5 Cell processor

```ts
export async function processCell(job: Job<CellPayload>) {
    const p = cellPayloadSchema.parse(job.data);          // malformed → UnrecoverableError (wrap)
    return runWithRequestContext({ requestId: p.traceId ?? job.id!, ownerId: p.ownerId, runId: p.runId }, async () => {
        const run = await RunModel.findOne({ _id: p.runId, ownerId: p.ownerId }).select("status promptSnapshots fieldsVersion").lean();
        if (!run) throw new UnrecoverableError("Run deleted");
        const key = cellKey(p);
        if (run.status === "cancelling" || run.status === "cancelled") return persist(p, key, { status: "skipped", skippedReason: "cancelled" });

        const ctx = await loadCellContext(p, run);       // task, prompt, example, model, snapshot (cache per job batch if needed)
        let fields: ResultFields;
        try {
            fields = await executeCell(ctx, { complete });
        } catch (error) {
            const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
            if (isTransient(error) && !final) throw error;                    // BullMQ backoff
            fields = { status: "error", error: { code: errorCode(error), message: String((error as Error).message).slice(0, 500) } };
        }
        return persist(p, key, fields);
    });
}

const persist = async (p: CellPayload, key: CellKey, fields: ResultFields) => {
    const write = await ResultModel.updateOne(key, { $setOnInsert: { ...key, ownerId: p.ownerId, ...fields } }, { upsert: true });
    if (write.upsertedCount === 1) {                       // first time this cell finished → count it once
        const inc = fields.status === "scored" ? { "totals.completed": 1, costUsdMicros: fields.costUsdMicros ?? 0 }
                  : fields.status === "error" ? { "totals.errored": 1 } : { "totals.skipped": 1 };
        const run = await RunModel.findOneAndUpdate({ _id: p.runId }, { $inc: inc }, { returnDocument: "after" }).lean();
        await publishRunProgress(p.ownerId, run!);
        await maybeComplete(run!);
    }
};
```

`isTransient` = `ProviderSkipped`, `ProviderBusy`, `ProviderTimeout`, or `isRetryable(error)`.
Worker: `concurrency: 16` (the leases do the real pacing per model), `lockDuration: 240_000`
(3 attempts × 60 s + waits). Cell queue options: `attempts: 5`,
`backoff: { type: "exponential", delay: 5000 }`, `removeOnComplete: { age: 24 * 3600 }`.

### 6.6 Progress (ADAPT PaperTrail's SSE)

Copy `utils/events/{pubsub,sse,streamLimiter}.ts`. Change the channel to `pl:events:<ownerId>` and the
message to
`{ runId, status, completed, errored, skipped, total, costUsdMicros, at }`.
Routes: `GET /events` (the owner's runs) and `GET /runs/:id/events` (one run, starting with its
current state). Both use `authenticate` and the stream limiter. Throttle publishing to at most one
message per run per 500 ms (a Redis `SET NX PX 500` key): 3,000 cells must not mean 3,000 messages.

### 6.7 The CLI (`scripts/bench.ts`)

```
pnpm --filter api bench -- --task job-postings --split dev --prompts v1-zero-shot,v2-few-shot,v4-structured \
                          --models nvidia:<id1>,nvidia:<id2> --repeats 1 --concurrency 4 [--replay] [--out runs/2026-10-24-dev.jsonl] [--save]
```

1. Connect to Mongo (for task, examples, prompts, models), or with `--from-files` read
   `cases/job-postings/*` directly, with no database at all. The weekend fast track needs that.
2. Build the snapshots with the same function as the run job.
3. Run cells with a small in-process concurrency pool (`p-limit`-style, ~15 lines, no dependency),
   calling `executeCell` with the real `complete` (or `--replay`).
4. Write each result as a JSONL line, then print the Phase 17 aggregate table (it uses the same pure
   aggregation functions).
5. `--save` also inserts a run and its results into Mongo, so CLI runs appear in the UI.

Check `args.indexOf(flag) !== -1` before reading a flag's value (PaperTrail lesson).

## 7. Verify

1. `POST /runs` with 2 prompts × 2 models × 30 dev × 1 repeat → `total: 120`; Bull Board shows one
   `run:` job, then 120 `cell:` jobs; SSE shows the counters rising; the run completes; 120 results.
2. Double-submit the same body within 10 s → the same run id.
3. Kill the worker halfway, restart → it continues; no result has a duplicate; `completed + errored +
   skipped === total` exactly.
4. Fake provider scripted with 429 ×4 on one cell → that cell retries (job attempts), then succeeds.
   With 429 forever → it ends as an **error** result, and the run still completes.
5. A `structured` prompt with a model marked `unsupported` → those cells are `skipped`.
6. Cancel mid-run → the remaining cells finish as `skipped: cancelled` within seconds; status
   `cancelled`.
7. Edit a few-shot label mid-run → the run's snapshot is unchanged.
8. `pnpm --filter api bench -- … --replay` on the same grid → the same scores as the UI run (same core).

## 8. Definition of done

- [ ] Atomic run creation with prompt freezing; deterministic cell job ids; unique results.
- [ ] Counters exact under retries and crashes; error and skipped cells separated from wrong answers.
- [ ] Cancel, throttled SSE progress, a per-provider pace through the leases.
- [ ] The CLI runs the same core, with and without the database.
- [ ] Commit: `feat: queue-backed experiment runner and CLI`.

## 9. Interview angle

*"How do you run thousands of model calls without the run failing halfway?"* Each cell is its own
job with a deterministic id, and results are upserted on a unique cell key with counters incremented
only on first insert, so retries and crashes can't double-count. Transport errors back off at two
levels. A provider that stays down produces error cells, excluded from accuracy, not fake zeros. The
CLI runs the identical core.
