# CLAUDE.md

Guidance for Claude Code (and other assistants) in this repository.

## What this repo is

Prompt Lab: benchmark prompt versions × models on a hand-labelled test set (see `README.md`). Built
phase by phase from `docs/phases/`. **Read `docs/phases/README.md` first**: it lists the fixed
decisions and which phases are done.

Copy sources (read-only):
- `~/Code/paper-trail`, the primary source: the e-commerce architecture already ported to Next.js,
  plus the LLM reliability layer;
- `~/Code/e-commerce`, the origin;
- `~/Code/prompt-engineering-playbook` (built): its importer defines the export contract.

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
- Prices live in the `models` table with a `priceCheckedOn` date, snapshotted into each run. Never hard-code a price elsewhere.
- Bring-your-own-key: a visitor's API key is never stored, logged or put in a job payload.
- Every tenant query is scoped by `orgId` (the Prisma tenant extension), except published read-only
  pages, which are looked up by slug through `runAsSystem()` and then filtered on that run's `orgId`.
- Write CSS class strings inline in JSX `className`. Never extract them into constants.
- Check current library and provider docs (Context7) before writing against an API.

## Database and copying rules

- **PostgreSQL 17 + Prisma 7.10.1 only** (no MongoDB, no SQLite). One migration per phase; in scripts run
  `prisma migrate dev < /dev/null` then `prisma generate`.
- A workspace is a PaperTrail **org**: every tenant table carries `orgId` and is in `TENANT_MODELS`; the
  tenant extension enforces it. Copied model and field names stay exactly as in PaperTrail.
- Model output is **never repaired**. Scoring rules in `docs/reference/scoring-rules.md` are fixed
  before any run.
- Exports must match `docs/reference/playbook-contract.md` (the Playbook's importer is built against it).
- BullMQ job ids use `-`, never `:`. Stay inside the current phase (`// Phase NN:` comments).

## Keep the tracker and memory current (every conversation)

- **Start of a conversation:** read `memory.md` (setup gotchas, decisions, what's built) and `tracker.md` (phase status, next steps) before doing anything.
- **When a phase's Verify runs:** update `tracker.md` in the same commit: status, one line of evidence, next steps. Tick the phase in `docs/phases/README.md` only when its Definition of done is fully ticked. A phase that is built but not fully verified is marked 🟡 with what is pending.
- **End of a conversation (or before a long pause):** update `memory.md`, short: new decisions or deviations, environment gotchas, what's built, what needs the owner. Keep it brief, replace stale lines, don't append a diary.
- Corrections and surprises still go in `tasks/lessons.md` (pattern → rule). `memory.md` and `tracker.md` are summaries; never record a result that wasn't observed.

## Commands (after Phase 00)

```bash
pnpm install && docker compose up -d
pnpm dev                                   # api + web
pnpm --filter api worker                   # standalone worker
pnpm --filter api bench -- --split dev     # CLI benchmark (same core as the app)
pnpm test && pnpm --filter api test:int
```
