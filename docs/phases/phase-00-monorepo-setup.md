# Phase 00 — Monorepo, packages, docker-compose

## 1. Goal

Create the empty but **building** monorepo every later phase lands in:
- pnpm + Turborepo at the root, configured like PaperTrail (itself copied from e-commerce);
- four shared packages:
  - `@repo/types`: Zod schemas shared by the API, the web app and the CLI;
  - `@repo/scoring`: the pure scoring library, empty for now and filled in Phase 16;
  - `@repo/typescript-config` and `@repo/eslint-config`;
- two app placeholders: `apps/api` (Express, CommonJS) and `apps/web` (Next.js, Phase 09);
- a `cases/` folder, the git home of the shipped case studies (`job-postings`, `reasoning-mini`);
- a `docker-compose.yml` with exactly the infrastructure this project needs: **PostgreSQL 17**,
  `redis` (noeviction) and `redis-cache` (volatile-lru). There's no MinIO, because nothing is uploaded
  as a file: test sets are JSONL rows in PostgreSQL.

At the end, `pnpm build`, `pnpm typecheck` and `pnpm lint` are green on an almost empty repo, and
`docker compose up -d` brings up three healthy containers.

## 2. What I will understand after this phase

1. Why the repo is a monorepo: a field rule, a result line or a prompt version is defined once and
   imported by the API, the web app, the CLI and the tests.
2. Why scoring is its **own package** (`@repo/scoring`) and not a folder inside `apps/api`.
3. Why both packages build to **CommonJS** (`dist/`), and why nothing imports their TypeScript source.
4. Why there are **two** Redis instances with different eviction policies.
5. Why `apps/api` is CommonJS + `tsx`: COPY files from PaperTrail must stay identical.
6. What Turborepo's `dependsOn: ["^build"]` does (packages build before apps typecheck).

## 3. Prerequisites

- Node from `.nvmrc` (`22.23.4`, the version the Playbook build settled on: `nvm install && nvm use`),
  pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.4 --activate`).
- Docker with Compose v2. On WSL2 the engine is Docker Desktop on Windows: start it first
  (`"/mnt/c/Program Files/Docker/Docker/Docker Desktop.exe" &`).
- Read [../reference/architecture.md](../reference/architecture.md) §2 (layout) and
  [../reference/inherited-architecture.md](../reference/inherited-architecture.md) (shorthands, pins).
- Ports 5432, 6379, 6380 free. The Playbook and PaperTrail stacks use the same ports, so run
  `docker compose down` there first.

## 4. Files

```
prompt-lab/
├── .nvmrc                            NEW    (22.23.4)
├── package.json                      ADAPT  @pt-root/package.json          (name; same scripts and devDependencies)
├── pnpm-workspace.yaml               COPY   @pt-root/pnpm-workspace.yaml   (apps/*, packages/*)
├── turbo.json                        COPY   @pt-root/turbo.json
├── .prettierrc                       COPY   @pt-root/.prettierrc
├── .gitignore                        COPY   @pt-root/.gitignore           (+ apps/api/src/generated/)
├── Makefile                          ADAPT  @pt-root/Makefile             (drop load/minio/e2e; keep up/down/logs/test/test-int/db-migrate/lint/typecheck/build; add bench)
├── docker-compose.yml                ADAPT  @pt-root/docker-compose.yml   (postgres + redis + redis-cache only)
├── cases/README.md                   NEW    (what a case folder holds; Phases 11–12, 24–25 fill it)
├── packages/
│   ├── typescript-config/            COPY   @pt-root/packages/typescript-config/   (base.json, nextjs.json, react-library.json, package.json)
│   ├── eslint-config/                COPY   @pt-root/packages/eslint-config/       (base.js, next.js, react-internal.js, package.json, README.md)
│   ├── types/
│   │   ├── package.json              COPY   @pt-root/packages/types/package.json
│   │   ├── tsconfig.json             COPY   @pt-root/packages/types/tsconfig.json
│   │   └── src/
│   │       ├── index.ts              NEW    (re-exports; grows each phase)
│   │       ├── api.ts                COPY   @pt-root/packages/types/src/api.ts        (envelope schemas)
│   │       ├── id.ts                 COPY   @pt-root/packages/types/src/id.ts         (UUID id schema)
│   │       └── pagination.ts         COPY   @pt-root/packages/types/src/pagination.ts (cursor query)
│   └── scoring/
│       ├── package.json              ADAPT  @pt-root/packages/types/package.json      (name @repo/scoring; + vitest; no @types/express)
│       ├── tsconfig.json             COPY   @pt-root/packages/types/tsconfig.json
│       └── src/index.ts              NEW    (an exported version constant; Phase 16 fills the package)
└── apps/
    ├── api/{package.json,tsconfig.json,eslint.config.mjs,src/index.ts}   NEW placeholder (Phase 01 fills it)
    └── web/README.md                 NEW    placeholder (Phase 09)
```

`user.ts`, `cookie.ts` and `org.ts` aren't copied yet. They arrive with the phases that use them (04,
10). Copying them now would pull `@types/express` usage into a package nothing imports yet.

## 5. Concepts

**One source of truth for shapes.** PaperTrail's `@repo/types` holds every Zod schema that crosses a
process boundary. Here that will include:
- the field-rule DSL (Phase 11): the web editor validates against it, and the scorer reads it;
- the case line `{ id, split, tags, input, expected }` (Phase 12): the importer, the CLI and the
  Playbook all read this exact shape;
- the result line (Phase 22): the export writes it, and the Playbook's importer parses it with a copy
  of the same schema ([playbook-contract.md](../reference/playbook-contract.md)).

Three copies of one shape drift. One copy can't.

**Why a separate scoring package.** The architecture's rule ([architecture.md](../reference/architecture.md)
§1): the worker, the CLI, the web app's re-score preview and the unit tests must all compute a score
through **the same functions**. A package with no I/O dependencies (no Prisma, no Redis, no Express)
makes that structural. `apps/web` can import `@repo/scoring` without dragging in the API's server
code, and a test can't accidentally score through a database round trip. It exists from Phase 00, so
Turborepo's build graph and the CommonJS setup are proven before any real code lands in it.

**Why CommonJS for the packages.** `apps/api` is CommonJS (so COPY files keep `require` semantics and
`tsx` runs them unchanged), and a CommonJS consumer can't `require` an ESM-only package. Both packages
build with `tsc` to `dist/` as CommonJS, which Next.js consumes fine.

Consume them **through the built `dist/`**, never through a `paths` alias to `src/`. The Playbook
build learned this the hard way: tsx loading a `"type": "commonjs"` package's TypeScript source
silently loses every `export *` name. So `pnpm --filter @repo/types build` must run before any `tsx`
script. Turbo's `^build` does it for `dev`, `build` and `typecheck`.

**Two Redis instances** (e-commerce's lesson, unchanged):

| Instance | Policy | Holds | Why |
| --- | --- | --- | --- |
| `redis` :6379 | `noeviction`, AOF on | BullMQ cell jobs, rate-limit counters, pub/sub | an evicted cell job is a hole in a benchmark: the run never reaches `done = total` |
| `redis-cache` :6380 | `volatile-lru`, 256 MB, no persistence | published pages, task lists, session check | a cache that can't evict grows until it falls over; an empty cache after restart is correct |

**PostgreSQL 17, locally in Docker.** Production is Neon. The local container uses the same major
version, so `prisma migrate` produces the same SQL in both. The spec suggested SQLite. PostgreSQL is
used everywhere instead (dev, tests, prod), so a migration that works locally is the migration that
deploys (ADR in Phase 30).

**Pin, don't `pnpm add` bare.** A bare `pnpm add -D typescript` installs TypeScript 7, and the newest
`eslint-*` plugins want ESLint 10, while the copied `@repo/eslint-config` is on **ESLint 9**. Keep these
exact versions:
- `typescript` **5.9.2** at the root;
- PaperTrail's `^6.0.3` in `apps/api` (as in `@pt-api`);
- `eslint` `^9`.

## 6. Steps

1. **Init.**
   ```bash
   cd ~/Code/prompt-lab
   git init -b main
   echo "22.23.4" > .nvmrc
   ```
   The folder already has `docs/`, `tasks/`, `README.md`, `CLAUDE.md`, `tracker.md` and `memory.md`.
   Keep them.

2. **Root files.** Copy `pnpm-workspace.yaml`, `turbo.json`, `.prettierrc` and `.gitignore` from
   `~/Code/paper-trail/`. Then write `package.json`:
   ```json
   {
     "name": "prompt-lab",
     "private": true,
     "scripts": {
       "build": "turbo run build",
       "dev": "turbo run dev",
       "lint": "turbo run lint",
       "format": "prettier --write \"**/*.{ts,tsx,md}\"",
       "typecheck": "turbo run typecheck",
       "test": "turbo run test"
     },
     "devDependencies": { "prettier": "^3.7.4", "turbo": "^2.9.18", "typescript": "5.9.2" },
     "engines": { "node": ">=22" },
     "packageManager": "pnpm@9.15.4"
   }
   ```
   Append to `.gitignore`:
   ```
   # Prisma client is generated on install (Phase 03)
   apps/api/src/generated/
   # CLI output (Phase 17); exported results you want to keep go under cases/<task>/runs/
   apps/api/out/
   ```

3. **docker-compose.yml.** Start from PaperTrail's and keep only these services:
   ```yaml
   services:
     postgres:
       image: postgres:17-alpine
       container_name: promptlab-postgres
       environment:
         POSTGRES_USER: promptlab
         POSTGRES_PASSWORD: promptlab
         POSTGRES_DB: promptlab
       ports: ["5432:5432"]
       volumes: [postgres_data:/var/lib/postgresql/data]
       healthcheck:
         test: ["CMD-SHELL", "pg_isready -U promptlab -d promptlab"]
         interval: 5s
         timeout: 3s
         retries: 20

     # Cell jobs, rate limits, pub/sub. Must never evict (BullMQ loses jobs otherwise).
     redis:
       image: redis:7
       container_name: promptlab-redis
       ports: ["6379:6379"]
       volumes: [redis_data:/data]
       command: redis-server --appendonly yes --maxmemory-policy noeviction
       healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, timeout: 3s, retries: 5 }

     # Response cache. volatile-lru evicts only keys with a TTL: every cache entry has one, the
     # namespace version counters don't. No persistence: an empty cache after restart is correct.
     redis-cache:
       image: redis:7
       container_name: promptlab-redis-cache
       ports: ["6380:6379"]
       command: redis-server --save "" --appendonly no --maxmemory 256mb --maxmemory-policy volatile-lru
       healthcheck: { test: ["CMD", "redis-cli", "ping"], interval: 5s, timeout: 3s, retries: 5 }

   volumes:
     postgres_data:
     redis_data:
   ```
   The `app` profile (api, worker and web containers) is added in Phase 29.

4. **Makefile.** From PaperTrail's, keep `help up down logs test test-int db-migrate lint typecheck
   build`. Drop `e2e`, `load` and every MinIO target until Phases 28–29 add what they need. Change
   `up`/`down` to plain `docker compose up -d` / `docker compose down` (no `--profile app` yet). Add:
   ```make
   bench: ## Run the benchmark CLI (Phase 17), e.g. make bench ARGS="--task job-postings --split dev"
   	pnpm --filter api bench -- $(ARGS)
   ```

5. **Shared packages.**
   ```bash
   mkdir -p packages && cp -r ~/Code/paper-trail/packages/typescript-config packages/
   cp -r ~/Code/paper-trail/packages/eslint-config packages/
   rm -rf packages/*/node_modules
   mkdir -p packages/types/src packages/scoring/src
   cp ~/Code/paper-trail/packages/types/{package.json,tsconfig.json} packages/types/
   cp ~/Code/paper-trail/packages/types/src/{api,id,pagination}.ts packages/types/src/
   cp ~/Code/paper-trail/packages/types/tsconfig.json packages/scoring/
   ```
   `packages/types/src/index.ts`:
   ```ts
   export * from "./id";
   export * from "./pagination";
   export * from "./api";
   ```
   `packages/scoring/package.json`:
   ```json
   {
     "name": "@repo/scoring",
     "version": "1.0.0",
     "private": true,
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "files": ["dist"],
     "type": "commonjs",
     "scripts": {
       "build": "tsc",
       "typecheck": "tsc --noEmit",
       "test": "vitest run"
     },
     "dependencies": { "@repo/types": "workspace:*", "zod": "^4.4.3" },
     "devDependencies": {
       "@repo/typescript-config": "workspace:*",
       "typescript": "5.9.2",
       "vitest": "^5.0.5"
     }
   }
   ```
   `packages/scoring/src/index.ts`:
   ```ts
   // Pure scoring: no I/O, no clock, no randomness (Phase 16). Bump on any rule change, so every
   // stored result can say which scorer produced it.
   export const SCORING_VERSION = "0";
   ```
   Until Phase 16 adds tests, `vitest run` would fail with "no test files". Add `--passWithNoTests`
   to the `test` script now and remove it in Phase 16.

6. **cases/README.md.**
   ```md
   # Case studies (versioned in git)

   Each folder is one task, reproducible from a fresh clone:
   - `task.json`: instructions + field rules (Phase 11)
   - `data/*.jsonl`: labelled examples, one `{ id, split, tags, input, expected }` per line (Phase 12, 24)
   - `prompts/*.md`: prompt versions (Phase 13, 25)
   - `LABELLING.md`: how the labels were decided (Phase 24)

   `pnpm --filter api import-cases` loads a folder into PostgreSQL (Phase 12).
   ```

7. **API placeholder** (Phase 01 replaces `src/index.ts`). `apps/api/package.json`:
   ```json
   {
     "name": "api",
     "version": "0.1.0",
     "private": true,
     "main": "src/index.ts",
     "type": "commonjs",
     "scripts": {
       "dev": "tsx watch src/index.ts",
       "build": "tsc",
       "start": "node dist/index.js",
       "typecheck": "tsc --noEmit",
       "lint": "eslint src --max-warnings 0"
     },
     "dependencies": { "@repo/types": "workspace:*", "@repo/scoring": "workspace:*", "zod": "^4.4.3" },
     "devDependencies": {
       "@repo/eslint-config": "workspace:*",
       "@types/node": "^25.9.3",
       "eslint": "^9.39.1",
       "tsx": "^4.22.4",
       "typescript": "^6.0.3"
     }
   }
   ```
   - `apps/api/tsconfig.json`: COPY `@pt-api/tsconfig.json`.
   - `apps/api/eslint.config.mjs`: COPY `@pt-api/eslint.config.mjs`. Its COPY-file override lists
     `src/utils/rateLimiter/**`, `src/middleware/visitorId.ts`, `src/services/gmail.service.ts` and
     `src/types/verificationLink.types.ts`. This project copies the same four, so keep the list as is.
   - `apps/api/src/index.ts`:
     ```ts
     console.log("api placeholder: Phase 01 replaces this file");
     ```

8. **Web placeholder.** A one-line `apps/web/README.md` (`Phase 09`). It has no `package.json` yet, so
   pnpm ignores it.

9. **Install and check.**
   ```bash
   pnpm install
   pnpm build && pnpm typecheck && pnpm lint
   docker compose up -d && docker compose ps
   ```

10. **Commit:** `chore: monorepo, shared packages, docker-compose`.

## 7. Verify

```bash
pnpm build
# • Packages in scope: @repo/eslint-config, @repo/scoring, @repo/types, @repo/typescript-config, api
# Tasks: 3 successful, 3 total

ls packages/types/dist packages/scoring/dist
# packages/types/dist: api.d.ts api.js id.d.ts id.js index.d.ts index.js pagination.d.ts pagination.js
# packages/scoring/dist: index.d.ts index.js

node -e "console.log(require('./packages/scoring').SCORING_VERSION)"
# 0

diff -r ~/Code/paper-trail/packages/typescript-config packages/typescript-config -x node_modules && echo SAME
# SAME
diff -q ~/Code/paper-trail/packages/types/src/id.ts packages/types/src/id.ts && echo SAME
# SAME

docker compose ps --format '{{.Name}} {{.Status}}'
# promptlab-postgres Up … (healthy)
# promptlab-redis Up … (healthy)
# promptlab-redis-cache Up … (healthy)

docker exec promptlab-redis redis-cli CONFIG GET maxmemory-policy
# maxmemory-policy noeviction
docker exec promptlab-redis-cache redis-cli CONFIG GET maxmemory-policy
# maxmemory-policy volatile-lru

docker exec promptlab-postgres psql -U promptlab -d promptlab -c "select version();" | head -3
# PostgreSQL 17.x …
```

## 8. Definition of done

- [ ] `pnpm install`, `pnpm build`, `pnpm typecheck` and `pnpm lint` all succeed.
- [ ] `typescript-config`, `eslint-config` and the three copied `types/src` files are identical to
      PaperTrail's (`diff` prints nothing).
- [ ] `@repo/scoring` builds to CommonJS and `apps/api` depends on it.
- [ ] `docker compose ps` shows three healthy containers, and the two Redis policies match §5.
- [ ] `.gitignore` excludes `.env*` (but keeps `.env.example`), `apps/api/src/generated/` and
      `apps/api/out/`.
- [ ] `cases/README.md` exists. There's no MinIO, no app container and no extra package.
- [ ] Committed. `tracker.md` updated (Phase 00 ✅ with one line of evidence).

## 9. Interview angle

*"Why is scoring a separate package?"* Because the most damaging bug in a benchmark is two code paths
that disagree, with the README table computed one way and the UI another. `@repo/scoring` has no I/O
at all, and the worker, the CLI, the web preview and the tests all import it. A number can only come
from one place.

*"Why PostgreSQL when the spec said SQLite?"* So dev, tests and production run the same database and
the same migrations. The integration tests (Phase 28) start a real PostgreSQL 17 in a container and
apply the same migrations a deploy applies. With SQLite locally and Postgres in prod, I'd be testing a
different database from the one I ship.

*"Why two Redis servers?"* They need opposite failure behaviour. The queue holds benchmark cells: lose
one and the run never finishes, so it runs `noeviction`. The cache must evict or it grows without
bound, so it runs `volatile-lru` with no persistence. I learned that split building my e-commerce
backend and have kept it in every project since.
