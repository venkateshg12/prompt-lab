# Architecture

Prompt Lab answers one question with numbers: **which prompt, on which model, gives the best results
for this task, and at what cost and speed?** You define a task (instructions + fields with scoring
rules), import a hand-labelled test set, write prompt versions, pick models, and run every prompt ×
model × example × repeat. Every output is scored by code, aggregated into a results table, and
browsable down to the single wrong field.

It is built on the e-commerce architecture (`~/Code/e-commerce`) in the **PostgreSQL + Prisma** form
PaperTrail implemented (`~/Code/paper-trail`, ADR 0010 there). **PostgreSQL only**: no MongoDB, no
SQLite (the spec's SQLite suggestion is replaced so dev, tests and production run the same database
and migrations). See [inherited-architecture.md](inherited-architecture.md).

---

## 1. The system

```
 apps/web (Next.js App Router)                        CLI: pnpm --filter api bench -- --task … --split dev
   tasks · test sets · prompts · run launcher           │   (same runner core, same scoring, same DB)
   results table · error browser · side-by-side         │
   /r/<slug> public results · /demo (bring your key)    │
        │ axios + cookies, SSE progress                 │
        ▼                                               ▼
 ┌──────────────────────── apps/api (Express 5, CommonJS) ─────────────────────────┐
 │ POST /runs: freeze prompt versions + price snapshot, create Run + RunVariants,   │
 │   enqueue one BullMQ job per CELL (variant × example × repeat),                  │
 │   jobId = cell-<runId>-<sha1(variant|example|repeat)[0:16]>  (dedupes retries)    │
 │                                                                                  │
 │ worker: run-cell → per-provider concurrency limiter → complete() → raw text     │
 │          → @repo/scoring (extract → parse → schema → fields → overall)          │
 │          → Result row (unique per cell) → progress counter → Redis pub/sub → SSE│
 │ run-finalize (when done = total): aggregates → RunVariant.summary (jsonb)        │
 └──────────────────────────────────────────────────────────────────────────────────┘
        │                         │                          │
 PostgreSQL 17 (Neon)      redis :6379 noeviction     redis-cache :6380 volatile-lru
 Prisma 7.10.1             BullMQ, limiter, pub/sub   published pages, task lists, session check

 Providers (adapters over fetch): NVIDIA NIM (default) · OpenAI · Anthropic · Gemini (on when their key is set)
```

### Why one job per cell

A cell is one model call plus scoring: the unit that can fail, be retried and be counted. With a
deterministic job id, a crashed worker or a double click can't produce two results for one cell, and
the `Result` unique index `(runId, variantId, exampleId, repeatIndex)` is the second lock. A run of
5 prompts × 3 models × 70 examples × 3 repeats is 3,150 cells, which BullMQ handles comfortably. The
alternative (one job per run looping inside) loses progress on a crash and can't spread across workers.

### Why scoring is a package

`packages/scoring` is pure TypeScript with no I/O: extract JSON, parse, validate against the task's
schema, score each field by its rule, aggregate. The API worker, the CLI, the web app's "re-score
preview" and the unit tests all call the same functions, so a number in the README can't come from a
different code path than the number in the UI.

---

## 2. Monorepo layout

```
prompt-lab/
├── package.json · pnpm-workspace.yaml · turbo.json · docker-compose.yml · Makefile · .prettierrc
├── apps/
│   ├── api/           Express 5 + Prisma 7.10.1 + BullMQ (API, worker, CLI)
│   │   ├── prisma/{schema.prisma,migrations/} · prisma.config.ts
│   │   ├── src/{index,app,worker}.ts
│   │   ├── src/ai/            complete() · providers/{nvidia,openai,anthropic,gemini,fake,replay}.ts · limiter · errors
│   │   ├── src/runner/        createRun · runCell · finalizeRun · cellJobId
│   │   ├── src/{config,constants,controllers,db,jobs,middleware,routes,services,types,utils}/
│   │   ├── src/scripts/       bench.ts (CLI) · probe-structured.ts · import-cases.ts · export-run.ts
│   │   ├── out/           CLI output (gitignored)
│   │   └── test/
│   └── web/           Next.js App Router, TanStack Query + Table, Zustand, axios, Tailwind 4, shadcn/ui, Recharts
├── packages/
│   ├── types/         @repo/types: Zod schemas (API, field-rule DSL, case lines, result lines)
│   ├── scoring/       @repo/scoring: pure scoring + aggregation + stats (Wilson, bootstrap, percentiles)
│   ├── typescript-config/ · eslint-config/      COPY @pt-root/packages/
├── cases/job-postings/                         the shipped case study (versioned in git)
│   ├── task.json                               instructions + field rules
│   ├── data/job_postings.jsonl                 100 labelled postings (public, anonymised)
│   ├── prompts/{v0-vague,v1-zero-shot,v2-few-shot,v3-cot,v4-structured,v5-best,…}.md
│   └── LABELLING.md
│   └── runs/                                   exported runs worth keeping (`*.results.jsonl`, Markdown)
├── cases/reasoning-mini/                       30 short reasoning questions (Playbook Lesson 3)
└── docs/ · tasks/ · tracker.md · memory.md
```

`cases/` is the source of truth for the case study: `import-cases.ts` loads it into PostgreSQL, so
anyone can reproduce the README table from a fresh clone.

---

## 3. Tenancy: a workspace is an org

PaperTrail's tenancy is copied **with its names** (`Org`, `Membership`, `Invite`, `orgId`,
`OrgRole`, `resolveOrg`, `requireOrgRole`, the Prisma tenant extension). The UI says "workspace".

| Role | Can |
| --- | --- |
| `owner` | everything, including API keys for providers stored per workspace (optional) and deletion |
| `admin` | tasks, prompts, runs, publishing |
| `reviewer` | **labelling**: edit expected answers, second-label examples (the spec's "ask a friend to double-check 20") |
| `viewer` | read results |

A new account gets a personal workspace on register and on first Google sign-in (Phase 10,
PaperTrail's `createPersonalOrg`). Why keep tenancy for a one-person tool: the second labeller needs an account with less power than
yours, and the copied extension makes "a published page can only show its own workspace's run"
a database rule, not a hope.

---

## 4. API endpoints

| Area | Routes | Auth | Phase |
| --- | --- | --- | --- |
| Health | `GET /health` | none | 01 |
| Auth | `/auth/{register,login,refresh,logout,me,verify/:token,google,password/forgot,password/reset}` | mixed | 04–05 |
| Sessions | `GET /session`, `DELETE /session/:id` | user | 05 |
| Workspaces | `/orgs`, `/orgs/:orgId/members`, `/orgs/:orgId/invites`, `POST /invites/preview`, `POST /invites/accept` (token in the body; the email link is `/invites#token=…`) | member/admin | 10 |
| Tasks | `/orgs/:orgId/tasks` (CRUD, field rules, JSON-schema preview) | admin | 11 |
| Test sets | `/orgs/:orgId/tasks/:taskId/examples` (list `?split&tag&q&cursor`, `POST …/import?dryRun=true\|false`, `PATCH …/:id`, `PUT …/:id/second-label`, `GET …/agreement`, `GET …/export.jsonl` = the contract's case lines) | reviewer | 12, 22 |
| Prompts | `/orgs/:orgId/tasks/:taskId/prompts` (create, `PATCH …/:id` draft, `POST …/:id/versions` duplicate, freeze on first run, `GET …/:id/preview?exampleId=`) | admin | 13 |
| Models | `GET /models` (registry), `POST /admin/models/probe` | user / platform admin | 14–15 |
| Runs | `POST /orgs/:orgId/runs`, `POST …/runs/estimate` (server-side cost estimate), `GET …/runs?taskId&cursor`, `GET …/runs/:id` (with `progressByModel`), `POST …/runs/:id/cancel`, `GET …/runs/:id/events` (SSE) | admin / viewer | 17, 20 |
| Results | `GET …/runs/:id/summary?tag=`, `GET …/runs/:id/results?variant&field&reason&failedOnly&cursor`, `GET …/runs/:id/compare?a&b&exampleId`, `POST …/runs/:id/rescore` (re-score stored outputs, no model calls) | viewer / admin | 18, 21 |
| Export | `GET …/runs/:id/export.md`, `…/export/summary.csv`, `…/export/results.csv`, `…/export/results.jsonl` (the Playbook contract) | viewer | 22, 27 |
| Publish | `POST/DELETE …/runs/:id/publish`, `GET /public/runs`, `GET /public/runs/:slug`, `GET /public/runs/:slug/results` | admin / none | 22 |
| Demo | `POST /demo/run` with `X-Provider-Key` | none, limited | 23 |
| Judge | `POST …/runs/:id/judge` (optional, validated first) | admin | 26 |
| DLQ | `/admin/dlq`, `/admin/dlq/:jobId/replay` | platform admin | 17 |

## 5. Queues

| Queue | Jobs | Phase |
| --- | --- | --- |
| `email` | `send-email` (verify, reset, invite, "run finished") | 08 |
| `run-cell` | one per cell, `jobId = cell-<runId>-<first 16 hex of sha1 over variantId, exampleId, repeat>`; per-provider rate limits | 17 |
| `run-judge` | one per judged result, `jobId = judge-<runId>-<resultId>` (optional) | 26 |
| `run-finalize` | `finalize-<runId>`, once all cells are terminal | 17–18 |
| `maintenance` | `purge-expired` (hourly), stale-run sweeper (cells stuck > 10 min) | 08, 17 |
| `dead-letter` | cells that exhausted retries, with replay | 17 |

BullMQ job ids never contain `:` (the Playbook build hit this): ids use `-`.

---

## 6. Rules that cut across everything

1. **Scoring rules are fixed before the first run** ([scoring-rules.md](scoring-rules.md)). No output is
   ever repaired. A broken JSON scores 0 and shows in valid-JSON %.
2. **Prompt versions are frozen when a run uses them.** An edit creates `@N+1`. Results always say
   which frozen version produced them.
3. **dev for iteration, test once.** Few-shot examples come only from dev. Re-running test after a
   tweak is flagged in the run (`testReused: true`) and in every export.
4. **Every number is generated** from stored results (README table, published pages, exports). Never
   typed.
5. **Prices are snapshotted per run** with their check date. NVIDIA's free tier is priced at a
   reference host's published price, labelled as such.
6. **API keys only from env** (the owner's). Visitors' keys (demo) are used inside one request, never
   stored, logged, queued or cached. **No public run ever uses the owner's key:** the demo is always
   bring-your-own-key (Phase 23), and in production `OWNER_RUNS_REQUIRE_ADMIN=true` lets only platform
   admins start runs on the server's keys (Phases 17, 29).
7. **PostgreSQL only.** Copied names stay copied. Stay inside the current phase (`// Phase NN:`).
8. **The Playbook contract is binding** ([playbook-contract.md](playbook-contract.md)): the
   Playbook's importer is already built against it.

## 7. Environment variables (API unless noted)

| Variable | Phase | Notes |
| --- | --- | --- |
| `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `CLIENT_URL`, `RUN_WORKERS_IN_API` | 01 | workers in-process when `true` (dev, free tier) |
| `LOG_LEVEL`, `SERVICE_NAME` | 02 | |
| `DATABASE_URL` | 03 | pooled URL at runtime |
| `DIRECT_DATABASE_URL` | 03 (used in 29) | unpooled URL for `prisma migrate` on Neon; `prisma.config.ts` falls back to `DATABASE_URL` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SAME_SITE` | 04 | ≥ 32 chars, different |
| `GOOGLE_CLIENT_ID` | 05 | |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`, `TRUSTED_PROXY_CIDRS`, `DEBUG_IP_ENDPOINT`, `DEMO_DAILY_CAP` | 06 | `DEMO_DAILY_CAP` default 500 demo calls/day, all visitors |
| `CACHE_REDIS_HOST`, `CACHE_REDIS_PORT`, `CACHE_ENABLED` | 07 | |
| `GMAIL_*`, `ENABLE_QUEUE_DASHBOARD`, `QUEUE_DASHBOARD_USER`, `QUEUE_DASHBOARD_PASSWORD`, `WORKER_PORT` | 08 | blank `GMAIL_*` → in-memory dev mailbox |
| `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `LLM_PROVIDER`, `REPLAY_DIR`, `FAKE_LLM_SCRIPT`, `FAKE_LLM_FIXTURES`, `MODELS_SEED` | 14 | a provider is enabled only when its key is set; `LLM_PROVIDER=replay` for CI; `NVIDIA_BASE_URL` overridable for the E2E stub; `MODELS_SEED=test` seeds only `fake:*` models |
| `CELL_BACKOFF_MS`, `OWNER_RUNS_REQUIRE_ADMIN` | 17 | cell retry backoff base; `true` in production |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (web) | 09 | |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` (web) | 29 | optional; unset = off; `beforeSend` drops headers and scrubs keys |

CORS allows the headers `X-Org-Id` (Phase 10), `X-Lab-Visitor` (Phase 06: the web app's per-browser
visitor id, 16–64 chars, kept in `localStorage`) and `X-Provider-Key` (Phase 23).

## 8. Deployment

| Piece | Host |
| --- | --- |
| `apps/web` | Vercel |
| `apps/api` + worker | Render web + background worker (or `RUN_WORKERS_IN_API=true` on the free tier) |
| PostgreSQL | Neon; `prisma migrate deploy` at API start; `DIRECT_DATABASE_URL` for migrations |
| Redis ×2 | queue `noeviction`, cache `volatile-lru` |
| Public demo | saved, published runs at `/r/<slug>` + `/demo` with the visitor's own key. **No paid runs on the owner's key** |
