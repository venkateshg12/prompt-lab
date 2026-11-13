# Deploying Prompt Lab

The runbook. Every step you do in an account is marked **☐ owner**; tick it and write the date when
done. Nothing here needs a code change.

## What runs where

| Piece | Where | Notes |
| --- | --- | --- |
| Web | **Vercel**, root directory `apps/web` | framework Next.js; ignored build step `git diff --quiet HEAD^ HEAD -- apps/web packages` |
| API | **Render** web service, runtime Docker, Dockerfile `apps/api/Dockerfile`, build context = repo root, health check path `/health` | **auto-deploy off**: CI's deploy hook is the only path. The image migrates, then starts the API |
| Worker | **Render** background worker, same repo + Dockerfile, start command `node dist/worker.js` | paid plan. Free tier: skip it and set `RUN_WORKERS_IN_API=true` on the API |
| PostgreSQL 17 | **Neon**, region near Render | pooled URL → `DATABASE_URL`, direct URL → `DIRECT_DATABASE_URL`, both `?sslmode=require` |
| Redis (queue) | **Render Key Value** (internal URL) or Redis Cloud | `maxmemory-policy noeviction`; persistence on if the plan has it |
| Redis (cache) | a **second** Key Value instance | `volatile-lru`, no persistence |

Redis connections use host, port, username and password (no TLS option): use Render Key Value's
**internal** host/port from the API and worker (same region, no TLS needed). A provider that only offers
TLS endpoints needs a code change first.

## ☐ owner: create the accounts and services

1. ☐ **Neon**: create a project (Postgres 17). Copy the **pooled** and the **direct** connection strings.
2. ☐ **Render Key Value** ×2: `promptlab-queue` with policy *noeviction*, `promptlab-cache` with
   *volatile-lru*. Copy each internal host and port (and password, if set).
3. ☐ **Render API service** (Docker, see the table). Set the environment below. Turn auto-deploy off.
   Copy its **deploy hook** URL.
4. ☐ **Render worker** (optional, paid): same image, start command `node dist/worker.js`, the same
   environment with `RUN_WORKERS_IN_API=false` on both services. Copy its deploy hook.
5. ☐ **Vercel**: import the repo, root `apps/web`, set `NEXT_PUBLIC_API_URL` (the Render API URL) and
   `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Add the ignored-build-step command above.
6. ☐ **Google Cloud**: the OAuth **Web** client for sign-in (authorised JavaScript origin = the Vercel URL),
   and the Gmail sender client (see "Email" below).
7. ☐ **GitHub** → Settings → Secrets → Actions: `RENDER_API_DEPLOY_HOOK`, `RENDER_WORKER_DEPLOY_HOOK`
   (if you made a worker), `API_HEALTH_URL` (`https://<your-api>.onrender.com/health`). Create an
   environment `production`; for live benchmarks, an environment `bench` with yourself as required
   reviewer and the secret `NVIDIA_API_KEY`.

## Production environment (API, and the worker if you have one)

| Group | Variable | Value |
| --- | --- | --- |
| Core | `NODE_ENV` | `production` |
| | `PORT` | `5000` (Render also injects `PORT`; either works) |
| | `LOG_LEVEL` | `info` |
| | `SERVICE_NAME` | `prompt-lab-api` |
| Origins | `CORS_ORIGIN` | the Vercel URL, exact, no trailing slash |
| | `CLIENT_URL` | the same |
| Database | `DATABASE_URL` | Neon **pooled** URL, `?sslmode=require` |
| | `DIRECT_DATABASE_URL` | Neon **direct** URL, `?sslmode=require` (used only by `migrate deploy`) |
| Auth | `JWT_SECRET`, `JWT_REFRESH_SECRET` | two different `openssl rand -hex 32` values (generate fresh ones: never reuse local secrets) |
| | `GOOGLE_CLIENT_ID` | the OAuth Web client id |
| Redis | `REDIS_HOST`, `REDIS_PORT` (+ `REDIS_USERNAME`, `REDIS_PASSWORD` if set) | the **queue** instance |
| | `CACHE_REDIS_HOST`, `CACHE_REDIS_PORT` (+ user/password) | the **cache** instance |
| | `CACHE_ENABLED` | `true` |
| Proxy | `TRUSTED_PROXY_CIDRS` | measured (below); a startup warning in production is a failed deploy |
| Email | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_NAME` | see "Email" |
| Models | `NVIDIA_API_KEY` (+ optional `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`) | the API and the worker need the **same** keys |
| | `LLM_PROVIDER` | `live` |
| Spend | `OWNER_RUNS_REQUIRE_ADMIN` | `true`: only platform admins can start runs on your keys |
| | `DEMO_DAILY_CAP` | `500` (demo runs per day, all visitors; they use their own keys) |
| Workers | `RUN_WORKERS_IN_API` | `false` with a worker service, `true` without one |
| | `ENABLE_QUEUE_DASHBOARD` | `false` |

Vercel: `NEXT_PUBLIC_API_URL` (the Render API URL), `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

**Cookies.** `vercel.app` and `onrender.com` are on the Public Suffix List, so the web and the API are
different sites. The API already sets its auth cookies `SameSite=None; Secure` in production, which is
what that needs: nothing to set. With your own domain for both (`promptlab.<you>.dev`,
`api.promptlab.<you>.dev`) it keeps working the same way.

**Measuring `TRUSTED_PROXY_CIDRS`.** Deploy once with `DEBUG_IP_ENDPOINT=true`, call
`GET /debug-ip`, put the proxy range it shows into `TRUSTED_PROXY_CIDRS`, set `DEBUG_IP_ENDPOINT=false`,
redeploy.

**Email.** Create the Gmail OAuth client (Google Cloud → APIs → Gmail API → OAuth client, redirect URI
`https://<your-api>/api/auth/gmail/callback`), set `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
`GMAIL_REDIRECT_URI`, deploy, open `https://<your-api>/api/auth/gmail` once, consent, and copy the refresh
token it shows into `GMAIL_REFRESH_TOKEN`. Redeploy. Until then sign-up emails can't be sent in production.

## ☐ owner: the first deploy

1. ☐ Push to `main`. CI runs `checks` → `e2e` → `image` → `deploy` (Render hooks) → the health poll.
   The API container runs `prisma migrate deploy` on `DIRECT_DATABASE_URL`, then starts.
2. ☐ From your machine, once, with the production **direct** URL in a temporary shell variable
   (never in a committed file):
   ```bash
   cd apps/api
   DATABASE_URL="<direct url>" pnpm db:seed-models                    # the model registry
   # sign up on the live site and verify your email, then:
   DATABASE_URL="<direct url>" pnpm promote-admin -- --email you@example.com
   DATABASE_URL="<direct url>" pnpm import-cases -- --case job-postings --email you@example.com
   ```
3. ☐ Publish the final test run from the UI (the run itself is done locally or with `bench.yml` live,
   per Phase 25).

## Smoke test after every deploy

```bash
API=https://<your-api>.onrender.com
curl -fsS $API/health                                                    # "database":"up","redis":"up"
curl -s -o /dev/null -w "%{http_code}\n" $API/admin/queues               # 401 (no dashboard; /admin needs auth)
curl -s $API/public/runs/<published-slug> | jq '.data.variants | length' # > 0, without signing in
curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/demo/run -H 'content-type: application/json' -d '{}'  # 400: no key
redis-cli -h <queue host> -p <port> CONFIG GET maxmemory-policy          # noeviction
redis-cli -h <cache host> -p <port> CONFIG GET maxmemory-policy          # volatile-lru
```

By hand: the published page loads signed out; a second (non-admin) account gets **403** on starting a
run; run the demo once with your own key, then search the Render logs for `nvapi-`: zero hits.

## Rollback

Code rolls back by redeploying the previous image (Render → the service → "Rollback"; Vercel →
"Promote" an earlier deployment). The **schema never rolls back**: migrations only add, so the previous
build runs on the newer schema. A destructive change ships as add → backfill → switch code → drop, over
several deploys. A bad migration is fixed with a new forward migration, never by editing an applied one.
**Never run `prisma migrate dev` against production.**

☐ owner, once: on a preview service, deploy a commit that breaks `/health`, watch CI's health step fail,
roll back from Render, confirm health is green. Record how long it took: ____

## Verified locally (13 Nov 2026)

- `docker build -f apps/api/Dockerfile -t promptlab-api .` → the image contains all 11 migration folders,
  `dist/` and `@repo/scoring`.
- `docker compose --profile app up -d --build` → api: "11 migrations found … No pending migrations to
  apply", "Server is listening to the port: 5000"; `/health` database up, redis up; worker: schedulers
  initialised, its `/health` lists email, maintenance, runCell, runFinalize, runJudge all running;
  web: 200, `/r` renders. `/admin/queues` 401, `POST /demo/run` with no key 400.
- Stop only the app containers with `docker compose stop api worker web`: `docker compose --profile app
  down` also stops Postgres and both Redis (volumes are kept).
- `.github/workflows/ci.yml` and `bench.yml` parse as YAML. Not yet run on GitHub (☐ owner: push a
  branch and watch `checks` and `e2e`; dispatch `bench.yml` with `replay` once a case folder has data
  and recorded answers in `cases/<task>/replay`).
