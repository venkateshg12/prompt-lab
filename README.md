<h1 align="center">Prompt Lab</h1>

<p align="center">
  <strong>Compare prompts and models on hand-labelled test sets: real scores, cost and latency, down to the single wrong field.</strong>
</p>

<p align="center">
  <a href="https://github.com/venkateshg12/prompt-lab/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/venkateshg12/prompt-lab/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6.svg">
  <img alt="PostgreSQL 17" src="https://img.shields.io/badge/PostgreSQL-17-336791.svg">
  <img alt="Scoring branch coverage 100%" src="https://img.shields.io/badge/scoring%20coverage-100%25-brightgreen.svg">
</p>

<p align="center">
  <a href="#results">Results</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/DEPLOY.md">Deploy</a> ·
  <a href="docs/reference/architecture.md">Architecture</a> ·
  <a href="docs/LIMITATIONS.md">Limitations</a>
</p>

<!-- 👤 The ≤ 60 s demo GIF goes here once recorded from the published run (docs/demo-script.md):
<p align="center"><img src="docs/demo.gif" alt="Prompt Lab: launch a run, read the results, open a mistake, compare, publish" width="900"></p> -->

Prompt Lab answers one question: **which prompt, on which model, gives the best results for this task,
at what cost and speed?** It runs every *prompt version × model × test input* (with repeats), scores
each output against a hand-checked answer with written rules, and shows the result as a table you can
click into: every percentage has its sample size and 95 % interval, and every mistake opens to the raw
model output and the reason it was scored wrong.

It ships with one real case study, **Job Posting Extractor** (messy job postings → clean JSON), and a
second small task, `reasoning-mini`, for chain-of-thought.

## Results

The final test-split run, generated from the database by `pnpm --filter api readme:update` and checked
in CI against its committed snapshot (`docs/results/`). Never typed by hand.

<!-- results:start -->
_No published test run yet: `pnpm --filter api readme:update -- --run <id>` fills this from the database._
<!-- results:end -->

"n/a" means nothing was scored for that row (for example a structured-output prompt on a model whose
schema mode the probe found unsupported). Errors are counted apart, never scored as 0.

**What I learned.** 👤 Written from the dev error browser and this table once the final run exists:
the three most common mistake types, the prompt change aimed at each, whether it worked on test (with
the number), and one change that didn't help. The lab notebook is
[cases/job-postings/EXPERIMENT.md](cases/job-postings/EXPERIMENT.md).

**The best prompt.** 👤 `v5-best` goes here once frozen, one line per part naming the mistake it
addresses (starting draft: [drafts/v5-best.md](cases/job-postings/prompts/drafts/v5-best.md)).

## Quick start

Requirements: Node 22 (`.nvmrc`), pnpm 9, Docker.

```bash
git clone https://github.com/venkateshg12/prompt-lab.git && cd prompt-lab
pnpm install
make up                                                    # PostgreSQL 17 + two Redis instances
cp apps/api/.env.example apps/api/.env                     # fill JWT_SECRET, JWT_REFRESH_SECRET (openssl rand -hex 32)
pnpm --filter api db:migrate && pnpm --filter api db:seed-models
pnpm dev                                                   # API on :5000, web on :3000
```

Sign up at <http://localhost:3000> (in development the verification link is served by the in-memory
dev mailbox), then load the case study and run a benchmark from the terminal:

```bash
pnpm --filter api import-cases -- --case job-postings --email you@example.com
pnpm --filter api bench -- --task job-postings --split dev \
  --prompts v1-zero-shot@1 --models nvidia:openai/gpt-oss-20b --email you@example.com
```

Model calls need a provider key in `apps/api/.env` (`NVIDIA_API_KEY` by default; OpenAI, Anthropic
and Gemini switch on when their key is set). Without one, try a published run at `/demo` with your own
key: it is used for that request only and never stored.

## Features

| | |
| --- | --- |
| **Tasks as rules** | A task is instructions plus a field-rule DSL (text, enum, integer, boolean, set-F1 with synonyms, money). The JSON Schema and the `{{fields}}` prompt block are derived from it. |
| **Test sets** | JSONL/CSV import with a dry-run report, revisions, tags, a deterministic dev/test split, and blind second labels with agreement scored by the same rules. |
| **Prompt versions** | Zero-shot, few-shot (dev examples only), chain-of-thought, structured output. A version used by a run is frozen; editing creates `@N+1`. |
| **Runs** | One queue job per cell, per-model concurrency and RPM budgets, retries for transport errors only, live progress over SSE, cancel, a monthly budget checked before anything is spent. |
| **Results** | Overall and per-field accuracy, valid JSON, schema-valid, exact match, consistency across repeats, $ / 100 inputs, p50/p95, with Wilson or bootstrap intervals; tag subsets recompute every number. |
| **Error browser** | Worst first, facets by reason and tag, raw output with the parsed span highlighted, keyboard navigation, side-by-side comparison of two variants across repeats. |
| **Re-score** | Fix a label or a rule and re-score from the stored raw outputs: deterministic, free, no model calls. |
| **Export & publish** | Markdown table, CSV (formula-safe), JSONL in the Prompt Engineering Playbook's contract; publish a run to a read-only `/r/<slug>` page. |
| **Bring-your-own-key demo** | Visitors run a published prompt on its public examples with their own key: synchronous, never stored, logged or queued. |
| **LLM judge & charts** | A binary judge from a different model family, stored apart and validated with Cohen's kappa; cost-vs-accuracy chart with the Pareto front, per-field bars with intervals. |
| **CLI** | `bench`, `export-run`, `import-cases`, `probe-structured`, `handoff` and dataset tools share the same runner core as the app. |

## Why Prompt Lab

- **Model output is never repaired.** Broken JSON is a measured result, not something to fix before
  scoring ([ADR 0003](docs/adr/0003-never-repair-model-output.md)).
- **Rules before runs.** Scoring rules are written down before the first run
  ([scoring-rules.md](docs/reference/scoring-rules.md)): skills by F1 with synonyms, salary normalised
  to per-year within ±5 % and never partial, an invented salary for "competitive" scores 0.
- **Every number has its n.** Errors are shown apart from accuracy, intervals come with every rate, and
  "best" is dimmed when it isn't clearly better.
- **The test split is used once.** Prompts are developed on dev; a reused test set is flagged on the run
  and in every export.
- **Same backend as production apps.** PostgreSQL + Prisma, BullMQ, Redis ×2 and a tenant-scoped
  workspace model, copied from a hardened codebase and tested on real Postgres 17 containers.

## How it works

```
 Next.js (apps/web)                Express 5 API (apps/api)                Worker (apps/api/src/worker.ts)
 ─────────────────                 ────────────────────────                ───────────────────────────────
 tasks · test sets · prompts  ──▶  route → controller → service → Prisma   one BullMQ job per cell
 run launcher (live progress)      authenticate (live session)              cell = prompt × model × input × repeat
 results · error browser           rate limiter (Lua, breaker)               complete() → raw text, tokens, latency, cost
 side-by-side · export · judge     BYOK demo (synchronous)                   score (packages/scoring) → save result
        ▲  SSE progress                    │                                        │
        └──────────────────────────────────┤                                        │
                                     PostgreSQL · Redis (queue) · Redis (cache)     NVIDIA NIM (+ OpenAI / Anthropic / Gemini)
```

| Layer | Technology |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo |
| Web | Next.js (App Router), TanStack Query + Table, Zustand, Tailwind, shadcn/ui, Recharts |
| API | Express 5 + TypeScript, Zod (`@repo/types`) |
| Scoring | `packages/scoring`: pure TypeScript (no I/O, clock or randomness), shared by worker, CLI and web |
| Data | PostgreSQL 17 + Prisma 7.10.1; Redis + BullMQ for queues, a second Redis for the cache |
| Models | NVIDIA NIM (default), OpenAI, Anthropic, Gemini through plain `fetch` adapters |
| Tests | Vitest + fast-check, Supertest + Testcontainers, Playwright |
| Deploy | Vercel (web), Render (API + worker, one Docker image), Neon, hosted Redis ×2 |

Design decisions and the alternatives considered are in [docs/adr/](docs/adr/).

### Repository layout

```
apps/api            Express API, worker, CLI scripts, Prisma schema + migrations
apps/web            Next.js app (workspace screens, public /r and /demo pages), Playwright specs
packages/scoring    the pure scorer, aggregation, intervals, Markdown export, kappa / Pareto
packages/types      Zod schemas shared by API and web (incl. the Playbook export contract)
cases/              versioned case studies: task.json, data/*.jsonl, prompts/*.md, notebooks
docs/               deploy runbook, ADRs, limitations, data handling, reference specs, build phases
```

## Testing

```bash
pnpm test                        # unit: scoring (table + property tests, 100 % branch) and API
pnpm --filter api test:int       # integration on Testcontainers Postgres 17 + Redis (needs Docker)
pnpm --filter web e2e            # Playwright against the real API and a local model stub
```

The integration suite checks the claims this README makes: exactly-once cells, no repair, retries only
for transport errors, tenancy (every foreign id is a 404), published-page privacy, and a leak scan that
searches every table, both Redis instances and the logs for a visitor's key. CI never sees a provider
key.

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Production runbook: services, every environment variable, smoke test, rollback |
| [docs/reference/architecture.md](docs/reference/architecture.md) | The system in depth |
| [docs/reference/scoring-rules.md](docs/reference/scoring-rules.md) | Field rules, reason codes, aggregates (binding) |
| [docs/adr/](docs/adr/) | Seven decision records |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | What the results do and don't show |
| [docs/DATA-HANDLING.md](docs/DATA-HANDLING.md) | Test-set sourcing, anonymisation, visitor keys, logging |
| [cases/job-postings/LABELLING.md](cases/job-postings/LABELLING.md) | How every label was decided |
| [docs/phases/](docs/phases/README.md) | The build, phase by phase |

The test set: postings collected by hand and anonymised before labelling
([SOURCES.md](cases/job-postings/SOURCES.md)), 20 double-labelled blind with agreement generated into
`cases/job-postings/data/AGREEMENT.md`, split 30 dev / 70 test with a fixed seed.

## Deployment

One Docker image runs as the API (it applies migrations first) and as a separate worker. The web app
deploys to Vercel. The public side costs nothing per visit: published pages are cached reads, the demo
uses the visitor's key, and only platform admins can start runs on the server's keys
(`OWNER_RUNS_REQUIRE_ADMIN=true`). See [docs/DEPLOY.md](docs/DEPLOY.md).

## Security & privacy

- Visitor API keys are used synchronously for one request and are never stored, logged, queued or
  cached; a test proves it ([DATA-HANDLING.md](docs/DATA-HANDLING.md)).
- Every workspace query is scoped by the database layer; published pages expose one run and never
  owner details or private inputs.
- Report a vulnerability privately through GitHub's security advisories for this repository, not in an
  issue.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `pnpm lint`, `pnpm typecheck`,
`pnpm test` and, for API changes, `pnpm --filter api test:int`. Changes to scoring rules need a rule
change in [scoring-rules.md](docs/reference/scoring-rules.md) and a test; exported shapes must keep the
Playbook contract ([ADR 0006](docs/adr/0006-playbook-export-contract.md)).

Results also feed the Prompt Engineering Playbook (a companion project) through that tested export
contract.

## License

[MIT](LICENSE) for the code. The dataset's terms are in
[cases/job-postings/SOURCES.md](cases/job-postings/SOURCES.md).
