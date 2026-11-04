# Prompt Lab — build phases

Follow the phases in order. Each one leaves the app runnable and ends with **Verify** and a
**Definition of done**. Tick a phase here only when every box in its Definition of done is ticked.

Read first:
- [../reference/architecture.md](../reference/architecture.md): what's copied from where and why;
- [../reference/scoring-rules.md](../reference/scoring-rules.md): the rules, decided before any run;
- [../reference/providers.md](../reference/providers.md): before Phase 13;
- [../reference/copy-map.md](../reference/copy-map.md): every COPY / ADAPT / NEW.

## Phase format

1. **Goal**
2. **What I will understand after this phase**
3. **Prerequisites**
4. **Files** (COPY / ADAPT / NEW tags with source paths)
5. **Concepts**
6. **Steps**
7. **Verify**
8. **Definition of done**
9. **Interview angle**

## How these guides were checked

- Every `@pt-*` / `@ec-*` source path named in a guide exists as of 24 October 2026. The source is
  PaperTrail's **implemented** code (built through its Phase 37), not its plans.
- Provider request shapes (NVIDIA, OpenAI, Anthropic, Gemini) were checked against their docs on
  that date (see `providers.md`, with sources).
- The guides were **not executed** as a project. When reality differs from a Verify section,
  investigate the difference, fix the guide's code in your repo, and note it in `tasks/lessons.md`.

## Decisions fixed up front

| Decision | Result |
| --- | --- |
| Architecture | Same as e-commerce/PaperTrail: pnpm + Turborepo, Express 5 (CommonJS + tsx), MongoDB, Redis ×2, BullMQ, Next.js + TanStack Query |
| Copy source | PaperTrail's implemented code (already ported to Next.js and hardened), e-commerce as origin |
| Database | MongoDB, not the spec's SQLite, to keep one architecture across the portfolio (an ADR in Phase 27 says so) |
| Tenancy | Single-owner workspaces (`ownerId`), plus published read-only result pages by slug |
| Models | NVIDIA NIM by default (3 model families); OpenAI / Anthropic / Gemini adapters on when their key is set |
| Model calls | `complete()` returns **raw text**; retries only on 429/5xx/timeouts; never repair output |
| Scoring | `packages/scoring`, pure and generic, driven by a per-task field-rule DSL |
| Runs | A BullMQ fan-out of cells with deterministic job ids; per-provider concurrency; live SSE progress; a CLI on the same core |
| Protocol | dev (30) / test (70); few-shot from dev only; the test set is run once for final numbers |
| Public demo | Saved results are public; bring-your-own-key runs are capped and never store the key |

## Status

### Foundation (copied from PaperTrail)

- [ ] 00 — [Monorepo, packages, docker-compose](phase-00-monorepo-setup.md)
- [ ] 01 — [API bootstrap: env, errors, envelope, createApp, health, shutdown](phase-01-api-bootstrap.md)
- [ ] 02 — [Logging and request ids](phase-02-logging.md)
- [ ] 03 — [MongoDB and data conventions](phase-03-mongo.md)
- [ ] 04 — [Accounts, sessions, refresh rotation](phase-04-accounts-sessions.md)
- [ ] 05 — [authenticate, device sessions, Google sign-in](phase-05-authenticate-google.md)
- [ ] 06 — [Rate limiting (+ demo limiters)](phase-06-rate-limiting.md)
- [ ] 07 — [Response cache](phase-07-cache.md)
- [ ] 08 — [BullMQ and Gmail email](phase-08-queue-email.md)
- [ ] 09 — [Next.js web foundation](phase-09-web-foundation.md)

### Core

- [ ] 10 — [Tasks and the field-rule DSL](phase-10-tasks-field-rules.md)
- [ ] 11 — [Test sets: import, edit, split](phase-11-test-sets.md)
- [ ] 12 — [Prompt versions](phase-12-prompt-versions.md)
- [ ] 13 — [Model registry and provider adapters](phase-13-providers.md)
- [ ] 14 — [Techniques: few-shot, chain-of-thought, structured output](phase-14-techniques.md)
- [ ] 15 — [The scoring library](phase-15-scoring.md)
- [ ] 16 — [The runner: fan-out, limits, retries, progress, CLI](phase-16-runner.md)
- [ ] 17 — [Aggregation: the results table numbers](phase-17-aggregation.md)

### UI

- [ ] 18 — [Web: tasks, test sets, prompts](phase-18-web-setup-screens.md)
- [ ] 19 — [Web: run launcher and live progress](phase-19-web-runs.md)
- [ ] 20 — [Web: results table, error browser, side-by-side](phase-20-web-results.md)
- [ ] 21 — [Export and published pages](phase-21-export-publish.md)
- [ ] 22 — [Public demo: bring your own key](phase-22-byok-demo.md)

### Case study

- [ ] 23 — [Build the job-postings test set](phase-23-dataset.md)
- [ ] 24 — [The experiment: v1–v4, error analysis, v5, final run](phase-24-experiment.md)

### Finish

- [ ] 25 — [LLM judge and cost-vs-accuracy chart (optional)](phase-25-judge-charts.md)
- [ ] 26 — [Tests: unit, integration, E2E](phase-26-tests.md)
- [ ] 27 — [Deploy, README, demo, sharing](phase-27-ship.md)

## Fast track: the weekend version (spec §10)

To start applying quickly, do this subset first and finish the rest later:

| Step | Phases | What you get |
| --- | --- | --- |
| 1 | 00, 01, 02, 03 | the API skeleton + Mongo (no auth yet) |
| 2 | 10, 13, 14, 15 | task, providers, techniques, scoring |
| 3 | 16 §6.7 only (the **CLI** `bench` script, no queue or UI) + 17's pure aggregation | numbers from the command line |
| 4 | 23 (30 dev postings only) + 24 (v1, v2, v4 on two models) | a results table and three example mistakes |
| 5 | 27 §6.4 (README only) | something to link today |

Then continue from Phase 04 (auth) onwards. Nothing in the fast track is thrown away: the CLI and
the app share the same core.

## Time budget (~15–20 h/week)

| Day | Phases |
| --- | --- |
| 1 | 00–05 (copy-heavy) |
| 2 | 06–09, 10–12 |
| 3 | 13–15 |
| 4 | 16–17 |
| 5 | 18–20; label postings |
| 6 | 21–22, 24 (dev runs → v5 → final run) |
| 7 | 25 (optional), 26, 27 |
