# Phase 27 — Deploy, README, demo, sharing

## 1. Goal

Ship it and tell the story:
- **deploy**: web on Vercel; API and a separate worker on Render (Docker); Atlas; two hosted Redis
  instances. The public site shows **published results** and the **BYOK demo**; owner runs work for
  you;
- **CI**: lint → typecheck → unit → integration → build (→ E2E on web changes), from PaperTrail's
  workflow;
- **docs**: README per the spec's layout (§11), ADRs, LIMITATIONS;
- a **1-minute demo GIF**, a **LinkedIn post**, the **resume bullet** with real numbers, and the
  **interview Q&A** prepared from your own results.

## 2. What I will understand after this phase

1. What the production topology looks like and why the worker is separate.
2. Which numbers go where (README, resume, post) and how to keep them identical.
3. How to answer the spec's interview questions from your own data.

## 3. Prerequisites

Phase 26 done; Phase 24's final run published.

## 4. Files

```
apps/api/Dockerfile                    ADAPT  @pt-api/Dockerfile        (no poppler; same multi-stage, non-root, tini)
apps/web/Dockerfile                    ADAPT  @pt-web/Dockerfile        (compose/E2E only)
.dockerignore                          COPY   @pt-root/.dockerignore
.github/workflows/ci.yml               ADAPT  @pt-root/.github/workflows/ci.yml   (no eval job; + scoring tests)
docs/adr/0001-mongodb-not-sqlite.md · 0002-queue-per-cell.md · 0003-no-repair-before-scoring.md ·
0004-no-fallback-model.md · 0005-byok-synchronous.md · 0006-nvidia-default-plus-adapters.md      NEW
docs/LIMITATIONS.md                    NEW
README.md                              ADAPT  (final, per spec §11)
```

## 5. Concepts

**Topology.**
- Render web service: `node dist/index.js`, `RUN_WORKERS_IN_API=false`, `/health` check.
- Render background worker: `node dist/worker.js` (same image).
- Atlas: a least-privilege user.
- Redis: queue/limiter `noeviction` plus cache `volatile-lru`.
- Vercel: `apps/web`.

A full owner run is thousands of calls. Keeping it in the worker means the API (and the public pages
and demo) stay responsive. Cookies across Vercel/Render are handled by the copied `SameSite=None; Secure`
config, with PaperTrail's caveat about strict third-party-cookie browsers (a custom domain fixes it;
note it in LIMITATIONS).

**Keep the public site free to run.**
- Published pages are cached reads.
- The demo uses visitors' keys only.
- Owner runs require sign-in **and** `requireAdmin` in production (only your account), via an env flag
  `OWNER_RUNS_REQUIRE_ADMIN=true`. Anyone can sign up and explore, but not spend your provider credits.

**One set of numbers.** The README table is the Markdown export of the published test run (Phase 21).
The resume bullet and the LinkedIn post quote **from that table**, with the same rounding. In an
interview, open the live page and click into an error.

**ADRs** (half a page each: context, decision, alternatives, consequences):
1. MongoDB instead of the spec's SQLite;
2. a queue job per cell instead of a loop;
3. never repairing output before scoring;
4. no fallback model in a benchmark;
5. synchronous BYOK runs (keys never queued);
6. NVIDIA by default plus optional adapters (cost; open models; the reference-price note).

**LIMITATIONS.md**, specific:
- 100 examples, one domain;
- a single primary labeller (20 double-checked, agreement X %);
- prices checked on a date;
- NVIDIA costs are reference prices, not what you paid;
- temperature-0 non-determinism on hosted inference;
- structured-mode support varies by hosted model (probe results);
- normalisation choices (no fuzzy text match; strict types) are opinions written down;
- test-set reuse, if it happened.

## 6. Steps

1. Dockerfiles from PaperTrail (drop the `poppler-utils` install), `.dockerignore`, the compose `app`
   profile (API, worker, web).
2. `ci.yml` from PaperTrail: remove the eval job and the OpenAPI check; add
   `pnpm --filter @repo/scoring test`; keep integration tests on Testcontainers and the image build.
   Deploy hooks for the Render API and worker on `main`.
3. Deploy: Atlas (run `db:indexes`), Redis × 2, Render API + worker (env from `.env.example`; real
   JWT secrets; `TRUSTED_PROXY_CIDRS=127.0.0.1/32` per PaperTrail's measurement; Gmail redirect URI;
   provider keys), Vercel (`NEXT_PUBLIC_API_URL`). Seed models + the case-study task, import data,
   publish the final run.
4. **README** in the spec's order:
   1. one line;
   2. GIF;
   3. the results table (export), with caption;
   4. What I learned: the top 3 mistake types and what fixed them;
   5. the final v5 prompt, explained;
   6. how the test set was built and labelled (link `LABELLING.md`, `SOURCES.md`, agreement);
   7. the scoring rules (link `scoring-rules.md`);
   8. how to run it yourself (`make up`, seed, `bench`);
   9. limits (link `LIMITATIONS.md`).

   Then "Built on" (the PaperTrail / e-commerce architecture) and links to the live demo and a
   published run.
5. **GIF (≤ 60 s)**: launch a run → the live progress bar → the results table → click salary → an
   error card with the reason chip → side-by-side v1 vs v5. Record at 1280 px wide; keep it under 5 MB.
6. **LinkedIn post** (short): "I compared 4 prompting techniques on 3 models on 100 hand-labelled job
   postings. Here's what changed the results:" plus 3 findings with numbers, the live link and the
   repo link.
7. **Resume bullet** (spec §12), numbers from the table only:
   > Built Prompt Lab, a TypeScript app that benchmarks prompts across NVIDIA-hosted open models (plus
   > OpenAI, Claude and Gemini adapters) on hand-labelled test sets; on a 100-example job-posting
   > extraction task, comparing zero-shot, few-shot, chain-of-thought and structured-output prompting
   > raised field accuracy from [X]% to [Y]% and valid-JSON rate to [Z]% at $[C] per 100 inputs.
8. **Interview prep**: answer each question in spec §13 in `docs/INTERVIEW.md` *from your data*:
   - how you know a prompt is better;
   - when few-shot helped;
   - whether CoT helped;
   - why structured mode;
   - how skills are scored;
   - temperature and your consistency numbers;
   - tokens and context, and how prompt length moved cost;
   - invented salaries (null rule + `null_expected` counts);
   - which model you'd choose.

   Each answer ≤ 5 sentences with one number.
9. Tick every phase in `docs/phases/README.md`; write the review in `tasks/todo.md`; tag `v1.0.0`.

## 7. Verify

- The live web loads published results with no sign-in. The demo works with a personal key. An
  ordinary signed-up account can't start owner runs in production.
- `/health` on the API is green; the worker logs show cells being processed for an owner run started
  from the live site.
- The README table equals the published run's export; the resume and post numbers equal the table.
- CI is green on `main`; a PR that breaks a scoring rule test fails.

## 8. Definition of done

- [ ] Deployed: web, API, worker, Atlas, Redis × 2; public pages and the demo cost you nothing.
- [ ] README per spec §11, ADRs, LIMITATIONS, INTERVIEW.md.
- [ ] GIF, LinkedIn post, resume bullet, all with the same real numbers.
- [ ] Tag `v1.0.0`.

## 9. Interview angle

Open the live published run and drive the answer from it: the table, a click into salary errors, the
v5 change that fixed the biggest bucket, the cost-vs-accuracy chart, and the recommendation. Then:
*"The whole thing runs on the same backend architecture as my other two projects, so this project's
time went into scoring and the experiment, not plumbing."*
