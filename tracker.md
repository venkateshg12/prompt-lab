# Tracker — Prompt Lab

Legend: ✅ done+verified · 🟡 built, check pending · ⬜ not started · 👤 needs the owner

## Parts
| Phase | Topic | Status | Evidence |
| --- | --- | --- | --- |
| 00–09 | Foundation: monorepo, API, logging, Postgres/Prisma, auth, limiter, cache, queue + email, web | 🟡 ✅ through 01 | 00: build/typecheck/lint green; 3 healthy containers; redis policies noeviction / volatile-lru; PG 17.11; copies `diff`-identical (4 Nov 2026); 01: /health+404+400+413 in envelope, boot fails on missing env, SIGINT shutdown lines, COPY diffs clean |
| 10–18 | Workspaces, tasks, test sets, prompts, providers, techniques, scoring, runner, aggregation | ⬜ 👤 provider keys | |
| 19–23 | Web screens, runs, results, export/publish, BYOK demo | ⬜ | |
| 24–27 | Dataset (100 labels), experiment + Playbook variants, judge, Playbook contract | ⬜ 👤 labelling | |
| 28–30 | Tests, deploy, README/demo | ⬜ 👤 deploy | |

## Next steps
1. Phase 02. Start labelling postings early (Phase 24): it is the slow part.

## Known limits (for README/ADRs)
- _(add as found)_
