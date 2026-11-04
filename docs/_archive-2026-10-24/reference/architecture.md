# Architecture: why Prompt Lab looks like this

Prompt Lab could be a weekend script. It's built as a full-stack app on the same architecture as
`~/Code/e-commerce` and `~/Code/paper-trail` for two reasons:
1. a benchmark that runs thousands of slow, failure-prone model calls needs a **queue, limits and
   retries**;
2. reusing a proven stack means the new hours go into the part that's actually new: **scoring and
   the experiment**.

Path shorthands used in every phase:

| Shorthand | Real path |
| --- | --- |
| `@pt-root/` | `~/Code/paper-trail/` |
| `@pt-api/` | `~/Code/paper-trail/apps/api/` |
| `@pt-web/` | `~/Code/paper-trail/apps/web/` |
| `@ec-api/` | `~/Code/e-commerce/apps/backends/mongo/` (origin of most backend files) |
| `@ec-web/` | `~/Code/e-commerce/apps/client/` (origin of the client architecture) |

**Copy from PaperTrail, not from e-commerce.** PaperTrail already did the porting: the Next.js client,
`createApp()`, pino, the Zod error envelope, the Gmail wiring, the LLM reliability layer. Its code
runs and is tested. Before copying a file, **read it**: PaperTrail's code is the source of truth, and
its phase docs may lag behind its code. Its `tasks/lessons.md` records the differences.

---

## 1. What comes from where

| Concern | Source | Why it matters here |
| --- | --- | --- |
| Error trio, envelope, `createApp`, shutdown | `@pt-api/src/{utils/errors,utils/api,app.ts,index.ts}` | testable API, clean failures |
| pino + request ids + redaction | `@pt-api/src/utils/{logger,requestContext}.ts`, `middleware/requestId.ts` | BYOK keys must never reach a log |
| Auth: rotation, live sessions, revocation, Google | `@pt-api/src/{utils/auth,services/auth.service.ts,middleware/authenticate.ts,…}` | owner accounts; runs cost money |
| Rate limiter (Lua, breaker, trusted IP, `visitorId`) | `@pt-api/src/utils/rateLimiter/*`, `middleware/{rateLimiter,visitorId}.ts` | the public BYOK demo is limited per visitor and per IP |
| Versioned cache | `@pt-api/src/utils/cache/*` | results aggregates are expensive and change only when a run finishes |
| BullMQ + Gmail | `@pt-api/src/jobs/*`, `services/gmail.service.ts` | runs are jobs; verification emails |
| LLM reliability: `withRetry`, typed errors, breaker, lease semaphore, RPM budget | `@pt-api/src/ai/{reliability,errors,breakers,concurrency}.ts` | thousands of calls without 429 storms |
| Replay / fake providers | `@pt-api/src/ai/providers/{replay,fake}.ts` | free, deterministic tests and re-scoring |
| Cost in micro-dollars | `@pt-api/src/utils/cost.ts` | cost per 100 inputs without float drift |
| SSE progress (pub/sub) | `@pt-api/src/utils/events/*` | live run progress |
| Cursor pagination | `@pt-api/src/utils/db/cursor.ts` | results and runs lists |
| Next.js client: axios refresh queue, query client, stores, guards, shadcn | `@pt-web/src/*` | the whole UI foundation |
| Vitest + Testcontainers harness | `@pt-api/vitest*.mts`, `@pt-api/test/{globalSetup,setupEnv}.ts` | real Mongo/Redis in tests |

**Not copied:** orgs, memberships and the tenant plugin; documents, pages, uploads, R2/MinIO; the
outbox; webhooks; API keys; idempotency keys. Prompt Lab is a **single-owner workspace**
(`ownerId` on every document) with **published read-only pages**. Phase 10 explains why that is
enough, and when you'd add orgs.

## 2. What's genuinely new

1. **The model layer records raw text.** PaperTrail's `generateJson` repairs and validates, because
   it needs a correct answer. Prompt Lab must **measure** how often a prompt breaks JSON, so its
   `complete()` returns exactly what the model said. Parsing happens later, in scoring, and broken
   output is a data point. Retries happen only for transport failures (429/5xx/timeout).
2. **Multi-provider adapters**: NVIDIA NIM by default, plus OpenAI, Anthropic and Gemini, all plain
   `fetch`, so no SDK retries hide underneath `withRetry`.
3. **A generic scoring library** (`packages/scoring`), driven by a per-task field-rule DSL: `text`,
   `enum`, `integer`, `set_f1` with synonyms, `money` with unit normalisation. It's pure, so the
   worker, the CLI and the web give identical numbers.
4. **The experiment grid**: one run = prompts × models × examples × repeats, fanned out as BullMQ
   jobs with deterministic ids, limited per provider, with live progress.
5. **The protocol**: dev/test split, prompt immutability, few-shot from dev only, the test set run
   once.

## 3. The request and run flow

```
POST /runs { taskId, promptIds[], modelIds[], split, repeats }
  └─ validate → create Run (status queued, totals) → enqueue "run:<runId>"
worker: run job
  └─ load examples(split) → for each prompt × model × example × repeat:
        add cell job  jobId = call:<runId>:<promptId>:<modelId>:<exampleId>:<repeat>
worker: cell job (concurrency per provider via lease semaphore)
  └─ render prompt (template + few-shot + technique) → complete() with withRetry
     → score(raw, expected, task.fields) → upsert Result (unique on the cell key)
     → $inc run counters → publish progress
last cell → run "completed" → bump cache "results" → SSE "done"
```

## 4. Interview pitch

> "Prompt Lab benchmarks prompts across models with a scoring library I wrote per field: set-F1
> with synonyms for skills, salary normalised across LPA/monthly/hourly with a 5 % tolerance. It
> runs as a queue-backed grid of thousands of calls with per-provider concurrency limits, retries
> only on rate limits, and never 'fixes' model output before scoring it, because broken JSON is part
> of what I'm measuring. On a 100-posting test set, going from zero-shot to my best prompt moved field
> accuracy from X to Y and valid JSON to Z, at $C per 100 inputs."
