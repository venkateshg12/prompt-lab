# Phase 00 — Monorepo, packages, docker-compose

## 1. Goal

A green skeleton:
- pnpm + Turborepo with the shared packages copied from PaperTrail;
- an empty `packages/scoring` workspace;
- an `apps/api` that prints one line;
- a `docker-compose.yml` with **MongoDB (single-node replica set)** and **two Redis instances**.

Prompt Lab stores no files, so MinIO isn't needed.

The *why* behind each piece (the Turbo `^build`, two Redis policies, the replica set, CommonJS) is
explained in `~/Code/paper-trail/docs/phases/phase-00-monorepo-setup.md`. Read it if you haven't
built PaperTrail.

## 2. What I will understand after this phase

1. Why `packages/scoring` is its own workspace (and pure).
2. Why Turborepo builds `@repo/types` and `@repo/scoring` before `api` and `web`.
3. Why there are two Redis containers and a Mongo replica set even for a "small" app.

## 3. Prerequisites

Node ≥ 20, pnpm 9 (`corepack enable`), Docker with Compose v2, `~/Code/paper-trail` present.

## 4. Files

```
prompt-lab/
├── package.json                    ADAPT  @pt-root/package.json          (name)
├── pnpm-workspace.yaml             COPY   @pt-root/pnpm-workspace.yaml
├── turbo.json                      COPY   @pt-root/turbo.json
├── .gitignore · .prettierrc · .prettierignore   COPY   @pt-root/
├── docker-compose.yml              ADAPT  @pt-root/docker-compose.yml    (drop minio, rename containers)
├── Makefile                        ADAPT  @pt-root/Makefile
├── packages/
│   ├── typescript-config/          COPY   @pt-root/packages/typescript-config/
│   ├── eslint-config/              COPY   @pt-root/packages/eslint-config/
│   ├── types/{package.json,tsconfig.json}   COPY  @pt-root/packages/types/
│   ├── types/src/index.ts          NEW    (empty barrel)
│   └── scoring/                    NEW    (package.json, tsconfig.json, src/index.ts)
└── apps/api/
    ├── package.json                ADAPT  @pt-api/package.json            (deps trimmed, scripts)
    ├── tsconfig.json · eslint.config.mjs   COPY   @pt-api/
    ├── .env.example                NEW
    └── src/index.ts                NEW    (temporary)
```

## 5. Concepts

**Why `packages/scoring`.** The same scoring code must run in four places: the worker (scoring each
cell), the CLI benchmark, the re-score job (Phase 17, when you fix a scoring rule) and the web
(showing *why* a field failed in the error browser). If it lived in `apps/api`, the web would
reimplement it and the two would drift. A separate **pure** package (no Mongo, no fetch, no `Date.now`)
can't drift and is trivially testable.

**Why so much infrastructure.** A full run is 5 prompts × 3 models × 70 examples × 3 repeats =
**3,150 model calls**. A loop in a request handler would time out, lose progress on a crash, and get
rate-limited. A queue (Redis `noeviction`) with per-provider limits and resumable cells is the right
tool. The cache Redis (`volatile-lru`) keeps the results aggregates cheap. Transactions (replica set)
make "freeze a prompt version + create the run" atomic (Phase 12/16).

## 6. Steps

```bash
mkdir -p ~/Code/prompt-lab && cd ~/Code/prompt-lab && git init
PT=~/Code/paper-trail
cp $PT/{turbo.json,pnpm-workspace.yaml,.gitignore,.prettierrc,.prettierignore} .
mkdir -p packages apps/api/src
rsync -a --exclude node_modules $PT/packages/typescript-config $PT/packages/eslint-config packages/
mkdir -p packages/types/src && cp $PT/packages/types/{package.json,tsconfig.json} packages/types/
echo 'export {};' > packages/types/src/index.ts
cp $PT/apps/api/{tsconfig.json,eslint.config.mjs} apps/api/
```

`package.json` (root): PaperTrail's with `"name": "prompt-lab"`. Keep the scripts (`build`, `dev`,
`lint`, `typecheck`, `test`, `format`) and devDependencies.

`packages/scoring/package.json`:

```json
{
  "name": "@repo/scoring",
  "version": "0.1.0",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "type": "commonjs",
  "scripts": { "build": "tsc", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "zod": "^4.4.3", "@repo/types": "workspace:*" },
  "devDependencies": { "@repo/typescript-config": "workspace:*", "typescript": "5.9.2", "vitest": "^3.2.0" }
}
```

`packages/scoring/tsconfig.json`: the same as `packages/types/tsconfig.json`. `src/index.ts`:
`export {};` for now. (Match the Vitest major version to the one PaperTrail's `apps/api` uses.)

`apps/api/package.json`: start from `@pt-api/package.json`, then:
- `name: "api"`;
- remove `@aws-sdk/*`, `pdfjs-dist`, `undici`, `@langfuse/*`, `@opentelemetry/*`, `@sentry/*` and
  every PaperTrail-only script (`eval*`, `try-*`, `openapi:*`);
- add `"@repo/scoring": "workspace:*"` and `"bench": "tsx src/scripts/bench.ts"`;
- keep the rest. Each later phase uses them as it copies files. Simplest: keep the dependency list,
  then delete what `pnpm --filter api exec depcheck` reports unused at the end of Phase 16.

`docker-compose.yml`: copy PaperTrail's and delete the `minio` and `minio-init` services and the
`minio_data` volume. Rename `papertrail-*` containers to `promptlab-*`. Keep `redis` (`noeviction`, AOF),
`redis-cache` (`volatile-lru`, port 6380, no persistence) and `mongo` (`--replSet rs0`, the
`rs.initiate` healthcheck) exactly as they are.

`Makefile`: PaperTrail's targets `up`, `down`, `logs`, `test`, `test-int`, with the new container
names; replace `eval` with `bench`.

`apps/api/src/index.ts`: `console.log("Prompt Lab API skeleton");`. `apps/api/.env.example`:
`NODE_ENV=development` and `PORT=5000`.

## 7. Verify

```bash
pnpm install && pnpm build && pnpm typecheck && pnpm lint
pnpm --filter api dev                                     # prints the skeleton line
docker compose up -d && docker compose ps                 # redis, redis-cache, mongo healthy
docker exec promptlab-mongo mongosh --quiet --eval "rs.status().set"            # rs0
docker exec promptlab-redis redis-cli CONFIG GET maxmemory-policy               # noeviction
docker exec promptlab-redis-cache redis-cli CONFIG GET maxmemory-policy         # volatile-lru
for f in turbo.json pnpm-workspace.yaml; do diff -q ~/Code/paper-trail/$f $f; done
diff -rq -x node_modules ~/Code/paper-trail/packages/typescript-config packages/typescript-config
```

## 8. Definition of done

- [ ] Clean install, build, typecheck and lint pass; Turbo builds `types` and `scoring` before `api`.
- [ ] Compose services healthy; replica set `rs0`.
- [ ] COPY files diff-identical.
- [ ] Commit: `chore: monorepo skeleton`.

## 9. Interview angle

*"Why a queue and two Redis instances for a prompt benchmark?"* Because a full grid is thousands of
slow, rate-limited calls. Each cell must be resumable, limited per provider and visible as progress.
And scoring is its own pure package, so every number on screen comes from one implementation.
