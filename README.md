# Prompt Lab

**Compare prompts and models with real scores, not opinions.**

Prompt Lab runs every *prompt version × model × test input* (with repeats), scores each output against
a hand-checked answer, and shows a results table: overall score, per-field accuracy, valid-JSON rate,
consistency, cost per 100 inputs, p50/p95 latency. You can click into every mistake.

It ships with one real case study: **Job Posting Extractor**, which turns messy job postings into clean JSON.

> Status: **planning**. This repository holds the build guides. Start at
> [docs/phases/README.md](docs/phases/README.md).
> The previous MongoDB-based plan (24 Oct 2026) is archived in
> [docs/_archive-2026-10-24/](docs/_archive-2026-10-24/).

## The question it answers

> *Which prompt, on which model, gives the best results for this task, at what cost and speed?*

You give it:
1. a **task**: instructions plus the JSON shape you expect, with a scoring rule per field;
2. a **test set**: 50–100 inputs with answers you checked by hand, split dev/test;
3. **prompt versions**: zero-shot, few-shot, chain-of-thought, structured output, and your best;
4. **models**: three model families on NVIDIA NIM by default. OpenAI, Claude and Gemini switch on
   when their API key is set.

## Results (test set, filled in from a real run, never typed by hand)

| Prompt | Model | Overall | Skills F1 | Salary acc | Valid JSON | Consistency | $ / 100 inputs | p95 latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v1 zero-shot | | | | | | | | |
| v2 few-shot | | | | | | | | |
| v3 chain-of-thought | | | | | | | | |
| v4 structured | | | | | | | | |
| **v5 best** | | | | | | | | |

## Architecture

```
 Next.js (apps/web)                Express 5 API (apps/api)                Worker (apps/api/src/worker.ts)
 ─────────────────                 ────────────────────────                ───────────────────────────────
 tasks · test sets · prompts  ──▶  route → controller → service → model    run job → fan out cells
 run launcher (live progress)      authenticate (live session)              cell = prompt × model × input × repeat
 results · error browser           rate limiter (Lua, breaker)               callModel → raw text, tokens, latency, cost
 side-by-side · export             BYOK demo limiter                         score (packages/scoring) → save result
        ▲  SSE progress                    │                                        │
        └──────────────────────────────────┤                                        │
                                     PostgreSQL · Redis (queue) · Redis (cache)     NVIDIA NIM (+ OpenAI / Anthropic / Gemini)
```

It's built on the architecture of [`~/Code/e-commerce`](../e-commerce), as ported and hardened in
[`~/Code/paper-trail`](../paper-trail). Auth, the rate limiter, the cache, BullMQ, the Gmail sender,
the Next.js client and the LLM reliability layer are copied from there.
See [docs/reference/architecture.md](docs/reference/architecture.md).

## Stack

| Layer | Technology |
| --- | --- |
| Monorepo | pnpm workspaces + Turborepo |
| Web | Next.js (App Router), TanStack Query + TanStack Table, Zustand, Tailwind, shadcn/ui, Recharts |
| API | Express 5 + TypeScript (CommonJS + tsx) |
| Validation | Zod (`@repo/types`) |
| Scoring | `packages/scoring`: pure TypeScript, shared by the worker, the CLI and the web |
| Database | PostgreSQL 17 (Neon) + Prisma 7.10.1 |
| Queue / cache | Redis + BullMQ; a second Redis for the cache |
| Models | NVIDIA NIM (default) · OpenAI · Anthropic · Google Gemini, all through plain `fetch` adapters |
| Tests | Vitest, Supertest, Testcontainers, Playwright |
| Deploy | Vercel (web), Render (API + worker), Neon, hosted Redis ×2 |
