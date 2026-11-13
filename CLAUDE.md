# CLAUDE.md

Guidance for Claude Code (and other assistants) working in this repository. Read it fully before
changing anything; the rules in **Non-negotiables** are the ones most often broken.

## What this repo is

Prompt Lab benchmarks prompt versions × models on hand-labelled test sets (see `README.md`): a pnpm +
Turborepo monorepo with an Express 5 API and worker, a Next.js web app, and a pure scoring package, on
PostgreSQL 17 + Prisma 7.10.1, Redis ×2 and BullMQ. It was built phase by phase from `docs/phases/`.

## Start of every conversation

1. Read `memory.md` (environment gotchas, decisions and deviations, what's built, what needs the owner).
2. Read `tracker.md` (phase status with evidence, next steps).
3. For phase work, read `docs/phases/README.md` (fixed decisions, phase checklist), then the phase file.

## Commands

```bash
# setup
pnpm install && docker compose up -d                 # Postgres 17 + Redis (queue) + Redis (cache)
pnpm --filter api db:migrate && pnpm --filter api db:seed-models
pnpm dev                                             # API :5000 + web :3000
pnpm --filter api worker                             # standalone worker (default: workers run in the API)

# checks (all must pass before a phase is done)
pnpm lint && pnpm typecheck
pnpm test                                            # unit: scoring (100 % branch gate) + API
pnpm --filter @repo/scoring exec vitest run --coverage
pnpm --filter api test:int                           # Testcontainers Postgres 17 + Redis (needs Docker)
pnpm --filter web e2e                                # Playwright; own DB promptlab_e2e; NIM stub
pnpm --filter api readme:check                       # README results block == committed snapshot

# CLI (same runner core as the app)
pnpm --filter api import-cases -- --case job-postings [--dry-run]
pnpm --filter api bench -- --task job-postings --split dev --prompts v1-zero-shot@1 --models <key>
pnpm --filter api export-run -- --run <id> --out-dir <dir>
pnpm --filter api readme:update -- --run <published test run id>
```

## Repository map

| Path | What lives there |
| --- | --- |
| `apps/api/src/{routes,controllers,services}` | HTTP layer: route → controller (Zod parse) → service |
| `apps/api/src/runner/` | run planning, cell jobs, `executeCell` (the shared core), `persistCell` |
| `apps/api/src/ai/` | `complete()`, provider adapters, breakers, leases, RPM budget |
| `apps/api/src/jobs/` | BullMQ queues, workers, processors (cells, finalize, judge, email, maintenance) |
| `apps/api/src/scripts/` | CLI: bench, import-cases, export-run, handoff, dataset tools, promote-admin |
| `apps/api/prisma/` | `schema.prisma` and migrations |
| `apps/api/test/` | integration suite (`*.int.test.ts`), helpers, Playbook contract copy |
| `apps/web/src/` | Next.js app: `(app)` workspace screens, public `r/` and `demo/` pages |
| `apps/web/e2e/` | Playwright specs, helpers, the NIM stub (`stubs/nim-stub.js`) |
| `packages/scoring/` | pure scorer, aggregation, intervals, Markdown export, kappa / Pareto |
| `packages/types/` | Zod schemas shared by API and web |
| `cases/` | versioned case studies: `task.json`, `data/*.jsonl`, `prompts/*.md`, notebooks |
| `docs/` | `DEPLOY.md`, ADRs, limitations, data handling, `reference/` specs (binding), `phases/` |

## Non-negotiables

- **Never repair, retry or "fix" a model's output before scoring it.** Broken JSON is a measured
  result. Retries are for 408/429/5xx/timeouts only. No fallback model inside a benchmark.
- **Scoring is pure** (`packages/scoring`): no I/O, no clock, no randomness. The worker, the CLI and the
  web use the same functions. Scoring rules in `docs/reference/scoring-rules.md` are fixed before any
  run; a rule change needs the doc, a test, and keeps 100 % branch coverage.
- **The test split** is for final reported numbers only. Prompts are developed on **dev**; few-shot
  examples come from dev only. A reused test set is flagged (`testReused`), never hidden.
- **Prompt versions are immutable** once a run used them; editing creates `@N+1`.
- **Prices** live in the `models` table with a `priceCheckedOn` date and are snapshotted into each run.
  Never hard-code a price elsewhere.
- **Bring-your-own-key:** a visitor's API key is never stored, logged, cached or put in a job payload.
- **Tenancy:** every tenant query is scoped by `orgId` (the Prisma tenant extension); a foreign id is a
  404, never a 403 or an empty list. Raw SQL filters on `org_id` itself. Published pages look a run up by
  slug through `runAsSystem()`, then everything runs inside that run's `orgId`.
- **Exports** must match `docs/reference/playbook-contract.md`: add fields freely, never remove, rename
  or retype one the Playbook schema names.
- **Numbers in docs are generated, never typed** (README results via `readme:update`).

## Conventions

- Copy sources (read-only): `~/Code/paper-trail` (primary), `~/Code/e-commerce` (origin),
  `~/Code/prompt-engineering-playbook` (its importer defines the export contract). A file tagged `COPY`
  in `docs/reference/copy-map.md` stays byte-identical (`diff -q` proves it); `ADAPT` contains only the
  changes its phase lists. Record any deviation in `memory.md`.
- A workspace is a PaperTrail **org**; copied model and field names stay exactly as in PaperTrail.
- BullMQ job ids use `-`, never `:`, and are deterministic where a job must run once.
- Write CSS class strings inline in JSX `className`; never extract them into constants.
- Check current library and provider docs (Context7) before writing against an API.
- Stay inside the current phase; mark later work with `// Phase NN:` comments.

## Database and migrations

- **PostgreSQL 17 + Prisma 7.10.1 only** (no MongoDB, no SQLite). One migration per phase.
- `prisma migrate dev` refuses to run without a TTY here. Instead: bring the dev DB up to date
  (`prisma migrate deploy`), generate the SQL with
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, save it as
  `prisma/migrations/<timestamp>_<name>/migration.sql`, apply with `migrate deploy`, run `prisma
  generate`, and re-run the diff: it must be empty.
- Every tenant table carries `orgId` and is listed in `TENANT_MODELS`.
- Production migrations run in the API container before it starts (direct URL); the worker never
  migrates. Never run `migrate dev` against production.

## Testing expectations

- A behaviour change comes with a test at the right level: pure logic → Vitest in its package; API
  contract, tenancy, queue or privacy → `apps/api/test/*.int.test.ts`; a user flow → Playwright.
- New id routes go into `apps/api/test/tenancy.routes.ts` (the tenancy suite walks it).
- Provider code is tested against stubs or recorded-shape fixtures; no test calls a real provider.
- After any `pnpm add`, run `pnpm install` at the root (a re-resolve once left a dangling Prisma link).

## Workflow and record keeping

- Plan first for anything with 3+ steps: write it to `tasks/todo.md` with checkboxes.
- Simplicity first, minimal impact, root causes, no temporary fixes.
- A phase is done only when its **Verify** ran and its **Definition of done** is ticked; built but not
  fully verified is 🟡 with what is pending.
- **When a phase's Verify runs:** update `tracker.md` in the same commit (status, one line of evidence,
  next steps). Tick `docs/phases/README.md` only when the Definition of done is complete.
- **After any correction or surprise:** add the pattern → rule to `tasks/lessons.md`.
- **End of a conversation:** update `memory.md`, briefly: replace stale lines, don't append a diary.
- Never record a result that wasn't observed.

## Environment gotchas (details in `memory.md`)

- WSL2 + Docker Desktop: start Docker Desktop from Windows first; there is no `/var/run/docker.sock`, so
  `test:int` relays through `docker system dial-stdio` automatically.
- `docker compose --profile app down` also stops Postgres and Redis; use
  `docker compose stop api worker web`.
- Find a process by port (`ss -ltnp`); never `pkill -f` from the tool shell.
- `.gitignore` ignores `*.md` except README/CLAUDE, `docs/*.md`, `docs/adr/`, `docs/reference/`,
  `cases/**/*.md`; check `git check-ignore -v` when a new doc doesn't show up.
