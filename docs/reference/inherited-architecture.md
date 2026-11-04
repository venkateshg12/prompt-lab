# The inherited architecture (e-commerce → PaperTrail → Prompt Lab)

Prompt Lab copies the e-commerce backend's architecture in the **PostgreSQL + Prisma** form PaperTrail
implemented. PaperTrail is the primary source for anything touching the database, tenancy, the model
layer, queues and the web app. e-commerce is the origin, cited where a file is database-free and
unchanged. Read `~/Code/paper-trail/docs/reference/ecommerce-architecture.md` once before Phase 01.

## Path shorthands

| Shorthand | Real path |
| --- | --- |
| `@ec-root/` | `~/Code/e-commerce/` |
| `@ec-api/` | `~/Code/e-commerce/apps/backends/mongo/` |
| `@ec-web/` | `~/Code/e-commerce/apps/client/` |
| `@pt-root/` | `~/Code/paper-trail/` |
| `@pt-api/` | `~/Code/paper-trail/apps/api/` (Express 5 + Prisma 7.10.1, implemented) |
| `@pt-web/` | `~/Code/paper-trail/apps/web/` (Next.js App Router, implemented) |
| `@pb-root/` | `~/Code/prompt-engineering-playbook/` (**built** through its Phase 23: its importer is the export contract; its Try-it is a working BYOK reference) |
| `@eq-docs/` | `~/Code/ai-enquiry-assistant/docs/` (sibling plan on the same foundation; its Phases 00–09 are the closest guide-level match) |

Tags: **COPY** = identical apart from import paths. **ADAPT** = only the listed changes. **NEW** =
full code in the phase.

## The pieces

| Piece | Source | Why | Here |
| --- | --- | --- | --- |
| Layering, `createApp`/`index`/`worker` split | `@pt-api/src/{app,index,worker}.ts` | Testable app; workers in-process in dev | Same |
| Env at boot, error trio, envelope | `@pt-api/src/{constants/env.ts,utils/errors,utils/api}` | Fail at deploy, one shape | Adds provider keys (all optional except one) |
| pino + request context + redaction | `@pt-api/src/utils/{logger,requestContext}.ts` | Traceable logs, no secrets | Redacts `x-provider-key`, `apiKey`, `rawOutput`, `input` (postings may be third-party text) |
| Prisma client + tenant extension + `runAsSystem` | `@pt-api/src/db/prisma.ts` | Every tenant query scoped | COPY, `TENANT_MODELS` per data-model.md |
| db helpers | `@pt-api/src/db/errors.ts`, `src/utils/db/{transaction,cursor}.ts` | One transaction style; cursor lists | COPY |
| Auth (JWT + DB sessions + refresh reuse detection, verify, reset, Google) | `@pt-api/src/{services/auth.service.ts,utils/auth,middleware/authenticate.ts,controllers/{auth,googleAuth,session}.controller.ts}` | Real logout and revocation | COPY |
| Orgs, memberships, invites, roles | `@pt-api/src/{services/{org,member,invite}.service.ts,middleware/{resolveOrg,requireOrgRole,authorize}.ts,constants/permissions.ts}` | Live roles, no cross-tenant reads | A **workspace**; `reviewer` = labeller |
| Audit log | `@pt-api/src/services/audit.service.ts` | Who changed a label or published a run | Same |
| Rate limiter (Lua, punitive, dual bucket, breaker, IP extractor, visitorId) | `@pt-api/src/utils/rateLimiter/*`, `middleware/{rateLimiter,visitorId}.ts` | Public endpoints without abuse | Adds demo and public-page limiters |
| Two Redis, three configs | `@pt-root/docker-compose.yml`, `@pt-api/src/config/redis.ts` | Queue never evicts; cache must | Same |
| Cache (versioned, single-flight, never throws) | `@pt-api/src/utils/cache` | O(1) invalidation | Domains `tasks`, `runs`, `published` |
| BullMQ, Bull Board, DLQ, replay | `@pt-api/src/jobs/*`, `@pt-api/src/{services,controllers,routes}/dlq.*` | Retries, visibility | Phase 08 copies the queues and only the **generic** dead-letter hook (`jobs/deadLetter.ts`); Phase 17 ADAPTs the DLQ service/endpoints for cells (PaperTrail's is document-specific). Queues `run-cell`, `run-finalize`, `run-judge`, `email`, `maintenance` |
| System email via Gmail API | `@pt-api/src/{config/gmail.ts,services/gmail.service.ts}` | Verify, reset, invites, "run finished" | Same |
| Model layer (NVIDIA, fake, replay, errors, retry, concurrency, breakers) | `@pt-api/src/ai/*` | One reliable call | **ADAPT: raw text only, never repaired**; adds OpenAI, Anthropic, Gemini adapters |
| Cost | `@pt-api/src/{utils/cost.ts,constants/pricing.ts}` | Micro-dollar cost per call | Prices from the `models` table, snapshotted per run |
| SSE + pub/sub + stream limiter | `@pt-api/src/utils/events/*` | Live progress | Channel per run |
| CSV with formula-injection escaping | `@pt-api/src/utils/csv.ts` | Safe spreadsheet exports | Summary + results CSV |
| Stats (Wilson, seeded bootstrap, nearest-rank percentiles) | `@pb-root/apps/site/src/lib/data/stats.ts` | The Playbook importer recomputes intervals from exports; both sides must agree to the digit | **COPY** into `packages/scoring/src/stats.ts`, with a parity test on a copy of the Playbook's `fixtures/import/run.jsonl` (Phase 18) |
| Tests, Dockerfile, CI | `@pt-api/{vitest*.mts,test/*,Dockerfile}`, `@pt-root/.github/workflows/ci.yml` | Real migrations in tests | Phases 28–29 |
| Web foundation | `@pt-web/src/{lib,store,app/providers.tsx,components/{auth,layout,ui,common},hooks/auth,app/(public)}` | Silent refresh, guards, primitives | Same + TanStack Table screens |
| BYOK leak table | `@pb-root/apps/api/src` (Try-it, implemented) | Every place a visitor key could leak, closed | The demo (Phase 23) |

## Version pins that differ from "latest"

| Package | Pin | Why |
| --- | --- | --- |
| `prisma`, `@prisma/client`, `@prisma/adapter-pg` | exactly `7.10.1` | npm `latest` is an 8.0 RC (PaperTrail ADR 0010) |
| `googleapis` | PaperTrail's `^184` | copied Gmail files compile unchanged |
| `typescript` | `5.9.2` at the root, `^6.0.3` in `apps/api` (as PaperTrail) | a bare `pnpm add -D typescript` installs 7 |
| `eslint` | `^9` | the copied config is ESLint 9 |
| `@tanstack/react-table` | `^9` | npm's current major; v9 replaced `useReactTable` with `useTable` + a `tableFeatures` object. Nothing copied uses the table library, so Phases 19–21 write against v9 (Phase 09 installs it) |
| `next` | `^16` | as decided in the Enquiry plan's Phase 09 (fallback 15) |

## Deliberately not copied

| Not copied | Why |
| --- | --- |
| Transactional outbox, webhooks, idempotency middleware, API keys | No external side effects to make atomic: starting a run enqueues after commit, and every cell job has a deterministic id, so a retried request can't double a run's results |
| PaperTrail's JSON repair (`modelJson.ts` repair retry) and cheap-model cascade | Prompt Lab **measures** raw model behaviour. Repairing output would hide exactly what valid-JSON % reports |
| Extraction cache | Benchmarks must call the model. The `replay` provider (recorded fixtures) covers tests and CI |
| Documents, PDF, storage, validators | Different domain |
| `utils/pii.ts` (PII masking) | Prompt Lab stores no customer contacts; postings are anonymised before import (Phase 24), and inputs are redacted from logs instead (Phase 02) |
| Quotas per page, fair-scheduling lanes | One kind of job; a per-workspace monthly budget + per-provider concurrency is enough |
