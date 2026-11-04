# Prompt Lab — build phases

Follow the phases in order. Each one leaves the app runnable and ends with **Verify** and a
**Definition of done**. Tick a phase here only when every box in its Definition of done is ticked.

Reference projects (read-only): `~/Code/paper-trail` (primary: the e-commerce architecture on
PostgreSQL + Prisma, implemented), `~/Code/e-commerce` (origin), `~/Code/prompt-engineering-playbook`
(built: its importer is the export contract, its Try-it is the BYOK reference). Shorthands are in
[../reference/inherited-architecture.md](../reference/inherited-architecture.md); every COPY / ADAPT /
NEW is listed in [../reference/copy-map.md](../reference/copy-map.md).

## Before you start

1. [../reference/architecture.md](../reference/architecture.md), end to end.
2. [../reference/inherited-architecture.md](../reference/inherited-architecture.md), then
   `~/Code/paper-trail/docs/reference/ecommerce-architecture.md`.
3. Before Part B: [../reference/data-model.md](../reference/data-model.md) and
   [../reference/scoring-rules.md](../reference/scoring-rules.md) (decided **before** any run).
4. Before Phase 14: [../reference/providers.md](../reference/providers.md).
5. Before Phase 22: [../reference/playbook-contract.md](../reference/playbook-contract.md) (binding).
6. Every phase has: **Goal · What I will understand · Prerequisites · Files (COPY/ADAPT/NEW) · Concepts
   · Steps · Verify · Definition of done · Interview angle.**
7. When a library's API disagrees with a guide, current docs win (Context7). Fix it and record it in
   `tasks/lessons.md`.

## How these guides were checked

- Source paths (`@pt-*`, `@ec-*`, `@pb-root/`, `@eq-docs/`) exist as of **4 November 2026**: the check at
  the end of copy-map.md reports `checked 331 paths, missing 0`, and every `phase-NN-*.md` link resolves.
  copy-map.md itself is generated from every phase's Files tree by `scripts/copymap.py` (about 470 rows).
- **PostgreSQL only.** Prisma pinned to **7.10.1**. npm's `latest` is an 8.0 RC.
- Provider facts are in `providers.md`, with dates. NVIDIA's Llama 3.x endpoints were retired on
  26 Aug 2026 (410): models are picked from the live list + a probe, never from memory.
- Not executed as a whole project. When reality differs from a Verify section, investigate, fix it in
  your repo, and record it.

## Decisions fixed up front

| Decision | Result |
| --- | --- |
| Architecture | e-commerce → PaperTrail: pnpm + Turborepo, Express 5 (CommonJS + tsx), Redis ×2, BullMQ, Next.js + TanStack Query/Table |
| Database | **PostgreSQL 17 + Prisma 7.10.1** only (not the spec's SQLite): one database for dev, tests and prod |
| Tenancy | A workspace is a PaperTrail org; `reviewer` = second labeller; names kept so tenancy stays COPY |
| Models | NVIDIA NIM by default (3 families); OpenAI, Anthropic, Gemini adapters switch on with their key |
| Model calls | `complete()` returns **raw text**; retries only on 408/429/5xx/timeouts; **never repaired** |
| Scoring | `packages/scoring`: pure, generic, driven by a per-task field-rule DSL; fixed before any run |
| Runs | One BullMQ job per cell with a deterministic id; per-provider concurrency; SSE progress; a CLI on the same core |
| Protocol | dev (30) / test (70); few-shot from dev only; test run once for final numbers |
| Public demo | Published runs are public; visitor runs use the visitor's own key, never stored; no paid runs on the owner's key |
| Playbook | Exports match the Playbook's built importer exactly; its lesson variants are prompt versions here |

## Status

### Part A — Foundation (copied)

- [x] 00 — [Monorepo, packages, docker-compose](phase-00-monorepo-setup.md)
- [x] 01 — [API bootstrap: env, errors, envelope, `createApp`, health, shutdown](phase-01-api-bootstrap.md)
- [x] 02 — [Logging, request ids, redaction](phase-02-logging.md)
- [x] 03 — [PostgreSQL + Prisma: client, tenant extension, migrations](phase-03-postgres-prisma.md)
- [x] 04 — [Accounts, sessions, refresh rotation, verification links](phase-04-accounts-sessions.md)
- [x] 05 — [`authenticate`, device sessions, Google sign-in, password reset](phase-05-authenticate-google.md)
- [x] 06 — [Rate limiting (+ demo and public limiters)](phase-06-rate-limiting.md)
- [x] 07 — [Response cache](phase-07-cache.md)
- [x] 08 — [BullMQ, DLQ and system email on the Gmail API](phase-08-queue-email.md)
- [x] 09 — [Next.js web foundation](phase-09-web-foundation.md)

### Part B — The core

- [x] 10 — [Workspaces, roles, invites (PaperTrail orgs)](phase-10-workspaces.md)
- [x] 11 — [Tasks and the field-rule DSL](phase-11-tasks-field-rules.md)
- [x] 12 — [Test sets: import, edit, split, tags, second labels](phase-12-test-sets.md)
- [x] 13 — [Prompt versions: templates, few-shot, freezing](phase-13-prompt-versions.md)
- [ ] 14 — [Model registry and provider adapters](phase-14-providers.md)
- [ ] 15 — [Techniques: few-shot, chain-of-thought, structured output + the probe](phase-15-techniques.md)
- [x] 16 — [The scoring library](phase-16-scoring.md)
- [x] 17 — [The runner: cells, limits, retries, progress, DLQ, CLI](phase-17-runner.md)
- [ ] 18 — [Aggregation: the results table, intervals, subsets](phase-18-aggregation.md)

### Part C — The web app

- [ ] 19 — [Web: tasks, test sets, prompts](phase-19-web-setup-screens.md)
- [ ] 20 — [Web: run launcher and live progress](phase-20-web-runs.md)
- [ ] 21 — [Web: results table, error browser, side-by-side](phase-21-web-results.md)
- [ ] 22 — [Export and published pages](phase-22-export-publish.md)
- [ ] 23 — [Public demo: bring your own key](phase-23-byok-demo.md)

### Part D — The case study

- [ ] 24 — [The dataset: 100 labelled job postings](phase-24-dataset.md)
- [ ] 25 — [The experiment: v1–v5, the Playbook variants, `reasoning-mini`, the final test run](phase-25-experiment.md)
- [ ] 26 — [LLM judge (validated) and charts](phase-26-judge-charts.md)
- [ ] 27 — [The Playbook contract: exports, contract test, hand-off](phase-27-playbook-contract.md)

### Part E — Ship

- [ ] 28 — [Tests: Vitest, Supertest, Testcontainers, Playwright](phase-28-tests.md)
- [ ] 29 — [Docker, CI, deploy](phase-29-docker-ci-deploy.md)
- [ ] 30 — [README, ADRs, demo GIF, LinkedIn post, resume](phase-30-ship.md)

## Weekend version (spec §10)

| Step | Phases | Result |
| --- | --- | --- |
| 1 | 00, 01, 03 | API skeleton + Postgres |
| 2 | 11 (task as `cases/job-postings/task.json` only), 12 (import CLI only), 14, 16 | providers + scoring |
| 3 | 17 (CLI path, inline, no queue) on v1, v2, v4 × two models, **30** labelled postings | first numbers |
| 4 | 18 + 22 (Markdown export only) | README table + three example mistakes |

Then continue from Phase 02. The CLI and the web app share the same runner core.

## Time budget (~15–20 h/week)

| Days | Phases |
| --- | --- |
| 1–2 | 00–10 (copy-heavy) + start labelling (24) |
| 3 | 11–16 |
| 4 | 17–18 |
| 5 | 19–21 |
| 6 | 24 (finish labels), 25 (dev iteration) |
| 7 | 25 (test run), 22, 27 |
| 8 | 23, 26, 28 |
| 9 | 29–30 |

## Cross-project links

The Playbook's Lessons 1, 2, 3, 4 and 7 read Prompt Lab exports (`@pb-root/docs/phases/phase-24-lesson-01-be-specific.md`,
`phase-25-lesson-02-few-shot.md`, `phase-26-lesson-03-chain-of-thought.md`, `phase-27-lesson-04-structured-output.md`,
`phase-30-lesson-07-testing.md`). Its old references to Prompt Lab phase numbers follow this map
(old → new): 00–09 same, 10→11, 11→12, 12→13, 13→14, 14→15, 15→16, 16→17, 17→18, 18→19, 19→20,
20→21, 21→22, 22→23, 23→24, 24→25, 25→26, 26→28, 27→30. New: 10 (workspaces), 27 (Playbook
contract), 29 (deploy).
