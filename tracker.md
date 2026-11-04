# Tracker — Prompt Lab

Legend: ✅ done+verified · 🟡 built, check pending · ⬜ not started · 👤 needs the owner

## Parts
| Phase | Topic | Status | Evidence |
| --- | --- | --- | --- |
| 00–09 | Foundation: monorepo, API, logging, Postgres/Prisma, auth, limiter, cache, queue + email, web | 🟡 ✅ through 09 | 00: build/typecheck/lint green; 3 healthy containers; redis policies noeviction / volatile-lru; PG 17.11; copies `diff`-identical (4 Nov 2026); 03 (typecheck cleared by Phase 04 models): /health db up/503-on-down/recovers, bad DATABASE_URL fails boot, baseline migration recorded, COPY diffs clean; 01: /health+404+400+413 in envelope, boot fails on missing env, SIGINT shutdown lines, COPY diffs clean; 02: X-Request-Id (unsafe replaced), 1 access line/req w/o query, redaction of keys/outputs/inputs (0 key hits), requestId COPY identical, no console.*; 04: register→verify(single use)→login→refresh rotation; replay >30s revokes session; token stored as 64-hex digest; unknown/known email login ≈0.2s each; logout deletes session; JWT secret checks; COPY diffs clean; 05: revoked session dead on next request; cookie+Bearer; /session isCurrent; /me has no password; forgot identical; reset single-use + revokes all, access log path has no token (only dev debug link); invalid Google token 401; one-door grep clean. 👤 real GOOGLE_CLIENT_ID; 06: login lockout 429 at limit 10 + X-RateLimit headers; /debug-ip; API serves /health 200 + login with Redis stopped; demoDualLimiter 204×5 then 429×2, both buckets charged; COPY files diff-clean; 07: cache:session:<id> TTL 59, cleared on logout (401 immediately), /health reports redis, fails closed (200 on /auth/me with cache stopped), versionedKey runs.0→runs.1; authenticate diff = log-context hunk only; 08: register→queue→dev mailbox link; reset job ids = hash (no token, no ':'); Bull Board 401/200, half-config refuses boot; garbage Gmail token → 1 attempt → dead-letter-queue entry; purge-expired removed expired session; standalone worker :8080 {email,maintenance} true and processed the job (API log 0); COPY diffs clean. 👤 real Gmail send unverified (no refresh token); 09: Next 16.4.5 build ok; TanStack Table 9.3.1; root dev serves api+web; Playwright E2E 6/6 (register→verify→/tasks, guards + open-redirect refusal, ONE /auth/refresh for concurrent 401s, failed refresh→/login, device revoke kills other device, wake notice appears+clears); UI dir identical to PaperTrail. 👤 Google button needs a real client id |
| 10–18 | Workspaces, tasks, test sets, prompts, providers, techniques, scoring, runner, aggregation | ⬜ 👤 provider keys | |
| 19–23 | Web screens, runs, results, export/publish, BYOK demo | ⬜ | |
| 24–27 | Dataset (100 labels), experiment + Playbook variants, judge, Playbook contract | ⬜ 👤 labelling | |
| 28–30 | Tests, deploy, README/demo | ⬜ 👤 deploy | |

## Next steps
1. Phase 10 (Part B starts). Start labelling postings early (Phase 24): it is the slow part.

## Known limits (for README/ADRs)
- _(add as found)_
