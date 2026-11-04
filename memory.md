# memory.md — short build memory

## What this is
Prompt Lab: benchmark prompts × models on hand-labelled test sets (case study: job postings → JSON).
Express 5 + PostgreSQL 17/Prisma 7.10.1 + Redis ×2 + BullMQ API, Next.js web, `packages/scoring`.
Built phase by phase from `docs/phases/`. Rules in `CLAUDE.md`. Status in `tracker.md`.

## Environment
- Same machine setup as the Playbook (`~/Code/prompt-engineering-playbook/memory.md`): Node from `.nvmrc`
  via nvm, Docker Desktop started first, `prisma migrate dev < /dev/null` in scripts.
- NVIDIA retired llama-3.x (410, 26 Aug 2026). Verified ids on 2 Nov 2026: `nvidia/nemotron-3-super-120b-a12b`,
  `openai/gpt-oss-20b`. Pick the third family with the probe.

## Decisions / deviations
- `.env` in `apps/api` is local (gitignored). GOOGLE_CLIENT_ID is a placeholder; Gmail unset → dev mailbox (`/auth/dev/latest-link`). 👤 owner: real Google Web client id + Gmail OAuth (`/api/auth/gmail`).
- No `jq` on this box: use `$S/bin/pj` (node JSON helper in the scratchpad) for curl checks.
- `db:migrate:dev --name x` works via `sh -c` wrapper (see lessons). Find API pid with `ss -ltnp`, never `pkill -f`.
- Standalone worker has its own dev mailbox (in-process memory), so `/auth/dev/latest-link` only works with workers in the API.

## Built so far
- Nothing yet (plan only, 3 Nov 2026).
