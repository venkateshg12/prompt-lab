# Phase 29 — Docker, CI, deploy

## 1. Goal

Ship the same build everywhere and keep the public site free to run:

- **Docker**: one API image with two commands (API, worker), migrations applied by `prisma migrate
  deploy` before the API starts; a web image for the compose stack and E2E;
- **compose `app` profile**: API, worker and web next to the existing infrastructure;
- **CI** (`ci.yml`): lint, typecheck, scoring tests, API unit, integration (Testcontainers), the Playbook
  contract, web build, Playwright with the `fake` provider, then image → deploy on `main`;
- **`bench.yml`**: a **manual** workflow that runs a benchmark from GitHub (replay by default, live only
  when you choose it, with a cell cap) and uploads the exports as artifacts;
- **deploy runbook** (`docs/DEPLOY.md`): Neon (pooled + direct URL), Render web + worker, two Redis
  instances with the right eviction policies, Vercel, the env checklist, **no owner-key runs from the
  public**, smoke tests and rollback.

## 2. What I will understand after this phase

1. Why the worker is a separate process in production, and why it never migrates.
2. Why Neon needs two URLs (pooled for the app, direct for migrations).
3. Why the queue Redis must be `noeviction` and the cache Redis must evict.
4. How a public demo stays free: published pages are cached reads, demo runs use the visitor's key, and
   owner runs need the owner.
5. Why schema rollback is never "undo the migration".

## 3. Prerequisites

- Phase 28 green locally (unit, integration, E2E).
- Accounts you'll need (owner tasks, marked ☐ in the runbook): GitHub, Vercel, Render, Neon, a hosted
  Redis provider, the Google Cloud project used for Gmail and Google sign-in.

## 4. Files

```
.dockerignore                         COPY  @pt-root/.dockerignore
apps/api/Dockerfile                   ADAPT @pt-api/Dockerfile          (no poppler-utils; builds @repo/scoring; ships prisma/ + prisma.config.ts)
apps/web/Dockerfile                   ADAPT @pt-web/Dockerfile          (builds @repo/scoring too)
docker-compose.yml                    ADAPT (+ `app` profile: api, worker, web; no MinIO)
.github/workflows/ci.yml              ADAPT @pt-root/.github/workflows/ci.yml    (no eval gate, no OpenAPI check, no Cloud Run; + scoring + contract)
.github/workflows/bench.yml           ADAPT @pt-root/.github/workflows/eval.yml  (manual only; replay | live; cell cap; artifacts)
apps/api/.env.example                 ADAPT (production checklist mirrored, grouped)
docs/DEPLOY.md                        NEW   (the runbook; model: @pb-root/docs/DEPLOY.md)
```

## 5. Concepts

**One image, two commands.** `node dist/index.js` is the API; `node dist/worker.js` is the worker
(cells, finalize, email, maintenance). The default container command is
`npx --no-install prisma migrate deploy && node dist/index.js`. The worker never migrates: two processes
racing to migrate is a problem you don't need, even though `migrate deploy` takes an advisory lock.
`migrate deploy` only applies committed migrations. **Never run `prisma migrate dev` against
production.**

**Why a separate worker.** A full benchmark is thousands of model calls. In the worker they can't slow
down the API that serves published pages and the demo. On Render's free tier you can run one service
with `RUN_WORKERS_IN_API=true`; it sleeps when idle, and a stuck run is picked up by the stale-cell
sweeper (Phase 17) when it wakes.

**Neon's two URLs.** The pooled URL (PgBouncer, transaction mode) is right for the app's many short
queries but wrong for migrations, which need session-level advisory locks and DDL. `prisma.config.ts`
reads `DIRECT_DATABASE_URL ?? DATABASE_URL`, so migrations use the direct URL and the app uses the
pooled one. Both need `sslmode=require`.

**Two Redis instances, again.** The queue instance holds BullMQ jobs and limiter counters: if it evicts,
cells vanish and a run never finishes. It must be `noeviction`. The cache instance must evict
(`volatile-lru`): an empty cache is a valid state. Hosted Redis often defaults to an evicting policy, so
you set it **and** verify it.

**Free to run in public.**
- Published runs (`/r/<slug>`) are cached reads of stored results. No model calls.
- `/demo` uses the visitor's own key, synchronously, never stored (Phase 23).
- Owner runs (POST `/orgs/:orgId/runs`) need a signed-in workspace member **and**, in production,
  `OWNER_RUNS_REQUIRE_ADMIN=true`: only platform admins (you) can start runs on the server's keys.
  Anyone can sign up and explore published results; nobody else can spend your credits.
- Each workspace's `monthlyBudgetUsdMicros` stops a run at the cap (Phase 17).

**CI never spends money.** Unit and integration tests use the `fake` provider; E2E uses recorded
answers. `bench.yml` defaults to `replay` (recorded fixtures). `live` needs you to pick it in the
dispatch form, reads keys from the `bench` environment (with required reviewers), and refuses to run
more than `max_cells` cells.

**Rollback.** Code rolls back by redeploying the previous image (Render "Rollback", Vercel "Promote").
The **schema doesn't roll back**. Migrations only ever add, so the previous build runs on the newer
schema. A destructive change ships as add → backfill → switch code → drop in a later deploy. A bad
migration is fixed by a new forward migration, never by editing an applied one.

## 6. Steps

1. **`apps/api/Dockerfile`.** Start from PaperTrail's. Changes:
   ```dockerfile
   # deps stage: also copy the scoring package manifest
   COPY packages/scoring/package.json packages/scoring/
   # build stage
   RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --offline --frozen-lockfile \
    && pnpm --filter @repo/types build \
    && pnpm --filter @repo/scoring build \
    && pnpm --filter api build \
    && pnpm deploy --filter api --prod /out
   # runtime stage: no poppler-utils
   RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*
   CMD ["sh", "-c", "npx --no-install prisma migrate deploy && node dist/index.js"]
   ```
   `prisma` is a runtime dependency (as in PaperTrail), so `pnpm deploy --prod` ships the CLI, and the
   `files`/copy must include `prisma/` and `prisma.config.ts`. Check with
   `docker run --rm --entrypoint ls promptlab-api prisma/migrations`.
2. **`apps/web/Dockerfile`.** PaperTrail's, plus `COPY packages/scoring/package.json packages/scoring/`
   and `pnpm --filter @repo/scoring build` before `pnpm --filter web build`.
3. **Compose `app` profile.** `api` (command above, `RUN_WORKERS_IN_API=false`, depends on postgres and
   redis healthy), `worker` (`node dist/worker.js`, depends on `api` started), `web`
   (`NEXT_PUBLIC_API_URL=http://localhost:5000`). Use `LLM_PROVIDER=fake` by default in the anchor env,
   overridable from a `.env` file. On WSL2, `docker` is `docker.exe` and ignores variables set on the
   command line, so put overrides in `.env` next to `docker-compose.yml` (the Playbook hit this).
4. **`ci.yml`.** From PaperTrail's, keep `checks → e2e → image → deploy`, and:
   - in `checks`: after `Typecheck`, add `pnpm --filter @repo/types build && pnpm --filter @repo/scoring build`,
     then `pnpm --filter @repo/scoring test`, `pnpm --filter api test`, `pnpm --filter api test:int`
     (which includes Phase 27's contract test); remove the poppler and OpenAPI steps; build the web app;
   - remove the `eval` job (Prompt Lab's "eval" is the benchmark itself, run by `bench.yml`);
   - in `e2e`: `docker compose up -d --wait postgres redis redis-cache` (no MinIO), then
     `pnpm --filter web e2e`;
   - in `deploy`: keep the Render deploy hooks and the `/health` poll; delete the Cloud Run steps. Keep
     the `env:`-then-`if: env.X != ''` pattern for optional secrets (GitHub refuses `secrets.*` inside
     `if:`).
5. **`bench.yml`.**
   ```yaml
   name: bench
   on:
     workflow_dispatch:
       inputs:
         task: { description: "case folder", default: "job-postings", required: true }
         split: { type: choice, options: [dev, test], default: dev }
         prompts: { description: "comma-separated prompt keys", default: "v1-zero-shot,v2-few-shot" }
         models: { description: "comma-separated model keys", default: "nvidia:openai/gpt-oss-20b" }
         repeats: { default: "1" }
         provider: { type: choice, options: [replay, live], default: replay }
         max_cells: { default: "300" }
   jobs:
     bench:
       runs-on: ubuntu-latest
       environment: ${{ inputs.provider == 'live' && 'bench' || '' }}
       services:
         postgres: { image: "postgres:17-alpine", env: { POSTGRES_USER: pl, POSTGRES_PASSWORD: pl, POSTGRES_DB: pl }, ports: ["5432:5432"],
                     options: --health-cmd "pg_isready -U pl" --health-interval 5s --health-retries 20 }
         redis: { image: "redis:7-alpine", ports: ["6379:6379"] }
       env:
         DATABASE_URL: postgresql://pl:pl@localhost:5432/pl
         LLM_PROVIDER: ${{ inputs.provider == 'live' && 'live' || 'replay' }}
         NVIDIA_API_KEY: ${{ inputs.provider == 'live' && secrets.NVIDIA_API_KEY || '' }}
       steps:
         - uses: actions/checkout@v4
         - uses: pnpm/action-setup@v3
           with: { version: 9.15.4 }
         - uses: actions/setup-node@v4
           with: { node-version: 22, cache: pnpm }
         - run: pnpm install --frozen-lockfile && pnpm --filter @repo/types build && pnpm --filter @repo/scoring build
         - run: pnpm --filter api db:migrate && pnpm --filter api import-cases -- --cask ${{ inputs.task }}
         - run: >
             pnpm --filter api bench -- --task ${{ inputs.task }} --split ${{ inputs.split }}
             --prompts ${{ inputs.prompts }} --models ${{ inputs.models }} --repeats ${{ inputs.repeats }}
             --max-cells ${{ inputs.max_cells }} --out bench-out/results.jsonl --md bench-out/table.md
         - uses: actions/upload-artifact@v4
           with: { name: bench-${{ github.run_id }}, path: apps/api/bench-out/ }
   ```
   The CLI flags are Phase 17's (`bench`) and Phase 22's (`--md`). If yours differ, the earlier phase
   wins. The `bench` environment in GitHub has required reviewers, so a live run needs your approval
   even from your own dispatch.
6. **`apps/api/.env.example`.** Group it like the checklist below, with comments; no real values.
7. **`docs/DEPLOY.md`.** Write the runbook below, marking every account-side step **☐ owner**, and run
   the local part (`docker compose --profile app up -d --build`) so its "verified locally" section is
   true.

### The runbook (content of `docs/DEPLOY.md`)

| Piece | Where | Notes |
| --- | --- | --- |
| Web | Vercel, root `apps/web` | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`; ignored build step `git diff --quiet HEAD^ HEAD -- apps/web packages` |
| API | Render web service, Docker, `apps/api/Dockerfile`, context = repo root, health `/health` | auto-deploy **off**; CI's deploy hook is the only path |
| Worker | Render background worker, same image, command `node dist/worker.js` | paid plan; free tier: `RUN_WORKERS_IN_API=true` on the API instead |
| PostgreSQL 17 | Neon, region near Render | pooled → `DATABASE_URL`, direct → `DIRECT_DATABASE_URL`, both `sslmode=require` |
| Redis (queue) | Render Key Value / Redis Cloud | `noeviction`, persistence on if the plan allows |
| Redis (cache) | second instance | `volatile-lru`, no persistence |

**Production env checklist**

| Group | Variables | Check |
| --- | --- | --- |
| Core | `NODE_ENV=production`, `PORT`, `LOG_LEVEL=info`, `SERVICE_NAME=prompt-lab-api` | |
| Origins | `CORS_ORIGIN` (web origin only), `CLIENT_URL` | exact, no trailing slash |
| Database | `DATABASE_URL`, `DIRECT_DATABASE_URL` | pooled vs direct |
| Auth | `JWT_SECRET`, `JWT_REFRESH_SECRET` (`openssl rand -hex 32`, different), `COOKIE_SAME_SITE`, `GOOGLE_CLIENT_ID` | the API refuses short or equal secrets |
| Redis | `REDIS_*`, `CACHE_REDIS_*`, `CACHE_ENABLED=true` | policies verified |
| Proxy | `TRUSTED_PROXY_CIDRS` | measured on Render by logging `req.socket.remoteAddress`; a startup warning in production is a failed deploy |
| Email | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_NAME`, `GMAIL_OAUTH_SETUP=false` | a verification email arrives |
| Models | `NVIDIA_API_KEY` (+ optional `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`), `LLM_PROVIDER=live` | the API and worker have the **same** keys |
| Spend | `OWNER_RUNS_REQUIRE_ADMIN=true`, `DEMO_DAILY_CAP`, workspace budgets | a non-admin account gets 403 on `POST /orgs/:orgId/runs` |
| Workers | `RUN_WORKERS_IN_API`, `ENABLE_QUEUE_DASHBOARD=false` | `/admin/queues` is a 404 |

**First deploy.** API deploy creates the schema. Then, once, from your machine with the **direct** URL:
`pnpm --filter api db:seed-models` (the registry from `models.config.ts`), sign up, promote your account
to platform admin with the seed script, `pnpm --filter api import-cases -- --case job-postings`, and
publish the final test run from the UI (the run itself is done locally or with `bench.yml` live and
imported, per Phase 25).

**Cookies.** `vercel.app` and `onrender.com` are on the Public Suffix List, so two subdomains of either
are different sites: leave `COOKIE_SAME_SITE` unset (production default `none`, `Secure`). With your own
domain (`promptlab.<you>.dev`, `api.promptlab.<you>.dev`) set `COOKIE_SAME_SITE=lax`.

**Smoke test after every deploy**

```bash
API=https://api.promptlab.example
curl -fsS $API/health                                                   # database, redis, cache: "up"
curl -s -o /dev/null -w "%{http_code}\n" $API/admin/queues              # 404
curl -s $API/public/runs/<published-slug> | jq '.data.variants | length' # > 0, served without sign-in
curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/demo/run -H 'content-type: application/json' -d '{}'  # 400: no key
redis-cli -u "$QUEUE_REDIS_URL" CONFIG GET maxmemory-policy             # noeviction
redis-cli -u "$CACHE_REDIS_URL" CONFIG GET maxmemory-policy             # volatile-lru
```

Then by hand: the published page loads signed out; a second (non-admin) test account can't start a run;
run the demo once with your own key, then search the Render logs for `nvapi-`: zero hits.

**Rollback drill (☐ owner, once).** On a preview service: deploy a commit that breaks `/health`, watch
CI's health step fail, roll back from the Render dashboard, health green again. Record the time it took.

### Error reporting (optional, resolves Phase 01's `// Phase 29:` comments)

- `src/instrument.ts`: ADAPT `@pt-api/src/instrument.ts` (Sentry only; no Langfuse: Prompt Lab traces
  nothing per call that isn't already a `Result` row). `index.ts` and `worker.ts` import it first;
  shutdown awaits `flushObservability()`; `errorHandler.ts` gets back the two Sentry lines Phase 01
  removed.
- `beforeSend` drops `request.headers` entirely and runs `scrubKeys` (Phase 23) over the event's
  message, breadcrumbs and extra, so no `X-Provider-Key`, cookie or `nvapi-…`/`sk-…` string reaches
  Sentry. No `SENTRY_DSN` → Sentry stays off.
- Web: wrap `next.config.ts` with the Sentry plugin only when `NEXT_PUBLIC_SENTRY_DSN` is set.

## 7. Verify

```bash
docker build -f apps/api/Dockerfile -t promptlab-api .
docker run --rm --entrypoint ls promptlab-api prisma/migrations          # every migration folder is there
docker compose --profile app up -d --build
docker compose logs api | grep -i migrat                                 # "applied …" first time, "No pending migrations" after
curl -fsS localhost:5000/health                                          # all "up"
docker compose logs worker | tail                                        # maintenance jobs registered
python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/ci.yml .github/workflows/bench.yml
```

Then push a branch: `checks` and `e2e` go green on GitHub. Dispatch `bench.yml` with `provider=replay`:
an artifact with `results.jsonl` and `table.md` appears. Record what you observed in the runbook's
"Verified" section. Leave every account step **☐** until you've done it and noted the date.

## 8. Definition of done

- [ ] API image builds; it contains the migrations; `migrate deploy` runs before the API, never in the worker.
- [ ] Compose `app` profile runs API, worker and web locally against the fake provider.
- [ ] `ci.yml` green on GitHub: lint, types, scoring, unit, integration (incl. the Playbook contract), web build, E2E.
- [ ] `bench.yml` runs on `replay` and uploads artifacts; `live` needs an approved environment and respects `max_cells`.
- [ ] `docs/DEPLOY.md` written; owner steps marked ☐ with dates when done.
- [ ] Production: smoke test passes, Redis policies verified, a non-admin can't start a run, no key in logs.
- [ ] `tracker.md` updated; commit `build: docker, ci, bench workflow and deploy runbook`.

## 9. Interview angle

*"How is this deployed, and how do you keep a public AI demo from costing you money?"* One Docker image
runs as the API and as a separate worker. Migrations run before the API starts, through Neon's direct
URL, because the pooled URL can't hold the locks migrations need. The queue Redis is `noeviction` so
benchmark jobs can't silently disappear, and the cache Redis is allowed to evict. The public side costs
nothing per visit: published results are cached reads, the demo runs on the visitor's own key and never
stores it, and only my admin account can start runs on the server's keys, under a monthly budget. CI
never calls a real model: tests use a fake provider, and live benchmarks are a manual workflow behind an
approval with a cell cap.
