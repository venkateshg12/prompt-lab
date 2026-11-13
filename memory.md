# memory.md — short build memory

## What this is
Prompt Lab: benchmark prompts × models on hand-labelled test sets (case study: job postings → JSON).
Express 5 + PostgreSQL 17/Prisma 7.10.1 + Redis ×2 + BullMQ API, Next.js web, `packages/scoring`.
Built phase by phase from `docs/phases/`. Rules in `CLAUDE.md`. Status in `tracker.md`. Deploy: `docs/DEPLOY.md`.

## Environment
- Node from `.nvmrc` via nvm; Docker Desktop started from WSL (`"/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe"`), then `docker compose up -d`.
- `prisma migrate dev` refuses without a TTY: generate SQL with `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, save as a migration folder, `migrate deploy`, re-diff (must be empty).
- After any `pnpm add`, run `pnpm install` at the root (a dangling `@prisma/client` link broke the API once).
- `test:int` (Testcontainers) relays Docker through `docker system dial-stdio` (`test/helpers/dockerRelay.ts`): no `/var/run/docker.sock` here.
- `docker compose --profile app down` also stops Postgres/Redis; use `docker compose stop api worker web`.
- No `jq`; find a process by port with `ss -ltnp`, never `pkill -f`.
- NVIDIA retired llama-3.x (410, 26 Aug 2026). Verified ids 2 Nov 2026: `nvidia/nemotron-3-super-120b-a12b`, `openai/gpt-oss-20b`.

## Decisions / deviations
- Test split needs `confirmFinal: true` (`bench --final`). "Test reused" = an earlier non-cancelled test run on the same dataset hash.
- Budget is enforced BEFORE a run (402, nothing created), not by stopping mid-run (Phase 17 design; Phase 28 guide wording differs).
- Phase 21: results feed index recreated `NULLS FIRST` by hand-written migration (Prisma can't express it; diff empty).
- Phase 23: a 429 on a caller-supplied (visitor) key doesn't count against the shared model breaker.
- Phase 25: `enum` takes opt-in `nullable` (reasoning-mini; scorer v2); empty system prompts allowed and the 3 adapters (ADAPT files) omit the system message (v0-vague = the Playbook's single user message).
- Phase 28: public pages null every text-bearing field of a private-input result (input, outputs, fieldDetails, expected); list routes 404 for another workspace's parent id.
- Phase 29: migrations use `DIRECT_DATABASE_URL ?? DATABASE_URL` via the container CMD (prisma.config.ts stays COPY); no `COOKIE_SAME_SITE` (production cookies are already SameSite=None; Secure); Redis via host/port/user/password, no TLS (use Render Key Value internal URLs). Sentry (optional) not added.
- `.gitignore` ignores *.md except README/CLAUDE, docs/reference, cases/**/*.md, docs/*.md, docs/adr/*.md.
- The Playbook repo is read-only: E2E runs its importer with its types compiled to a temp dir (`e2e/helpers/playbook.ts`); `playbook-dry-run.sh` uses the Playbook's own `import:prompt-lab` (rebuilds its gitignored dist).

## Needs the owner (👤)
- `NVIDIA_API_KEY` → `list-nvidia-models`, `try-model`, the structured probe (Phases 14–15 stay 🟡). Verify prices in `models.config.ts`.
- Real `GOOGLE_CLIENT_ID` + Gmail OAuth. Phase 24: 100 labelled postings + second labeller. Phase 25: dev runs, v5, reasoning-mini questions, ONE final test run, then `handoff.ts`, `readme:update -- --run <id>`, What I learned, GIF, post, bullet, tag v1.0.0.
- Deploy per `docs/DEPLOY.md` (Neon, Render ×2 + Key Value ×2, Vercel, GitHub secrets), first green CI on GitHub.

## Built (13 Nov 2026)
- Phases 00–23 and 28 done and ticked; 24–27, 29, 30: all code built and verified, owner items pending.
- Tests: `pnpm test` (scoring 111 incl. 8 properties, 100 % branch; api 77), `pnpm --filter api test:int` (Testcontainers, 89 + 2 visible skips), `pnpm --filter web e2e` (Playwright, own DB `promptlab_e2e`, NIM stub `e2e/stubs/nim-stub.js`; 30 specs).
- Run page: on SSE open and on a terminal message, cancel the in-flight run fetch, THEN invalidate (TanStack only cancels when data exists). Full E2E 29/29 twice after that fix.
