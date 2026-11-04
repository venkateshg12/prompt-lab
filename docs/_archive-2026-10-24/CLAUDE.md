# CLAUDE.md

Guidance for Claude Code (and other assistants) in this repository.

## What this repo is

Prompt Lab: benchmark prompt versions × models on a hand-labelled test set (see `README.md`). Built
phase by phase from `docs/phases/`. **Read `docs/phases/README.md` first**: it lists the fixed
decisions and which phases are done.

Copy sources (read-only):
- `~/Code/paper-trail`, the primary source: the e-commerce architecture already ported to Next.js,
  plus the LLM reliability layer;
- `~/Code/e-commerce`, the origin.

A file tagged `COPY` stays byte-identical to its source (`diff -q` proves it). A file tagged `ADAPT`
may contain only the changes its phase lists.

## Workflow

- Plan first for anything with 3+ steps: write it to `tasks/todo.md` with checkboxes.
- After any correction, add the pattern to `tasks/lessons.md`.
- A phase is done only when its **Verify** section ran and its **Definition of done** is ticked.
- Simplicity first. Minimal impact. Root causes, no temporary fixes.

## Rules that are easy to break

- **Never repair, retry or "fix" a model's output before scoring it.** Broken JSON is a measured
  result. Retries are for 429/5xx/timeouts only.
- Scoring lives in `packages/scoring` and is **pure**: no I/O, no clock, no randomness. The worker,
  the CLI and the web all use the same functions.
- The **test split** is used only for final reported numbers. Prompts are developed on **dev**.
  Few-shot examples come from dev only.
- Prompt versions are **immutable** once a run used them. Editing creates a new version.
- Prices live in `models` with a `priceCheckedOn` date. Never hard-code a price elsewhere.
- Bring-your-own-key: a visitor's API key is never stored, logged or put in a job payload.
- Every query is scoped by `ownerId`, except published read-only pages, which are looked up by slug.
- Write CSS class strings inline in JSX `className`. Never extract them into constants.
- Check current library and provider docs (Context7) before writing against an API.

## Commands (after Phase 00)

```bash
pnpm install && docker compose up -d
pnpm dev                                   # api + web
pnpm --filter api worker                   # standalone worker
pnpm --filter api bench -- --split dev     # CLI benchmark (same core as the app)
pnpm test && pnpm --filter api test:int
```
