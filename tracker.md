# Tracker — Prompt Lab

Legend: ✅ done+verified · 🟡 built, check pending · ⬜ not started · 👤 needs the owner

## Parts
| Phase | Topic | Status | Evidence |
| --- | --- | --- | --- |
| 00–09 | Foundation: monorepo, API, logging, Postgres/Prisma, auth, limiter, cache, queue + email, web | 🟡 ✅ through 06 | 00: build/typecheck/lint green; 3 healthy containers; redis policies noeviction / volatile-lru; PG 17.11; copies `diff`-identical (4 Nov 2026); 03 (typecheck cleared by Phase 04 models): /health db up/503-on-down/recovers, bad DATABASE_URL fails boot, baseline migration recorded, COPY diffs clean; 01: /health+404+400+413 in envelope, boot fails on missing env, SIGINT shutdown lines, COPY diffs clean; 02: X-Request-Id (unsafe replaced), 1 access line/req w/o query, redaction of keys/outputs/inputs (0 key hits), requestId COPY identical, no console.*; 04: register→verify(single use)→login→refresh rotation; replay >30s revokes session; token stored as 64-hex digest; unknown/known email login ≈0.2s each; logout deletes session; JWT secret checks; COPY diffs clean; 05: revoked session dead on next request; cookie+Bearer; /session isCurrent; /me has no password; forgot identical; reset single-use + revokes all, access log path has no token (only dev debug link); invalid Google token 401; one-door grep clean. 👤 real GOOGLE_CLIENT_ID; 06: login lockout 429 at limit 10 + X-RateLimit headers; /debug-ip; API serves /health 200 + login with Redis stopped; demoDualLimiter 204×5 then 429×2, both buckets charged; COPY files diff-clean |
| 10–18 | Workspaces, tasks, test sets, prompts, providers, techniques, scoring, runner, aggregation | ⬜ 👤 provider keys | |
| 19–23 | Web screens, runs, results, export/publish, BYOK demo | ⬜ | |
| 24–27 | Dataset (100 labels), experiment + Playbook variants, judge, Playbook contract | ⬜ 👤 labelling | |
| 28–30 | Tests, deploy, README/demo | ⬜ 👤 deploy | |

## Next steps
1. Phase 07.

## Known limits (for README/ADRs)
- _(add as found)_
