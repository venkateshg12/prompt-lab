# Phase 03 — PostgreSQL + Prisma: client, tenant extension, migrations

## 1. Goal

Connect the API to PostgreSQL 17 through **Prisma 7.10.1**, set up **exactly as PaperTrail's
implemented code does**:
- `prisma.config.ts` and a schema with the generator, the datasource and the conventions comment, but
  **no models yet** (Phase 04 adds the first ones);
- `src/db/prisma.ts`, a COPY of PaperTrail's client **with the tenant extension**, with
  `TENANT_MODELS` set to Prompt Lab's tables;
- `db/errors.ts` (`isUniqueViolation`, `isRecordNotFound`, `isUuid`, `nullIfNotFound`);
- `utils/db/{transaction,cursor}.ts`: one way to run a transaction, one way to paginate;
- `config/db.ts`: connect at boot, disconnect at shutdown, `isDbHealthy()` for `/health`;
- `scripts/ensure-database.ts` and an empty baseline migration;
- a unit test of the tenant scope rules (`tenantOrgId`) that needs no tables.

**PostgreSQL only.** The spec suggested SQLite. Dev, tests and production all run PostgreSQL 17 with
the same migrations.

## 2. What I will understand after this phase

1. Why PostgreSQL and not MongoDB or SQLite (PaperTrail ADR 0010, plus "test what you ship").
2. Why Prisma is pinned to 7.10.1 when npm's `latest` is 8.0.
3. How the tenant extension turns `findUnique({ where: { id } })` into "by id **and** in this
   workspace", and why a missing scope **throws** instead of returning everything.
4. Why raw SQL bypasses the extension, and the rule that follows (aggregation in Phase 18 uses raw
   SQL).
5. Why races are settled by unique constraints and conditional updates. A retried cell job can't
   create a second result because `(run_id, variant_id, example_id, repeat_index)` is unique.
6. Why UUIDv7 ids make `(created_at, id)` cursors cheap.

## 3. Prerequisites

- Phases 00–02 done, and `docker compose ps` shows `promptlab-postgres` healthy.
- Read `@pt-root/docs/adr/0010-postgresql-and-prisma.md` (10 minutes, worth it).
- Read [../reference/data-model.md](../reference/data-model.md): conventions and the "which phase adds
  what" table.

## 4. Files

```
apps/api/
├── prisma.config.ts                       COPY   @pt-api/prisma.config.ts
├── prisma/
│   ├── schema.prisma                      ADAPT  @pt-api/prisma/schema.prisma  (header + conventions only; no models)
│   └── migrations/
│       ├── migration_lock.toml            (generated)
│       └── <timestamp>_init/migration.sql (generated with --create-only; a comment only)
├── package.json                           ADAPT  (+ prisma scripts and deps, postinstall: prisma generate)
└── src/
    ├── db/
    │   ├── prisma.ts                      ADAPT  @pt-api/src/db/prisma.ts      (TENANT_MODELS list and its comment only)
    │   ├── prisma.test.ts                 NEW    (tenantOrgId rules; runs in Phase 28's Vitest)
    │   └── errors.ts                      COPY   @pt-api/src/db/errors.ts
    ├── config/db.ts                       COPY   @pt-api/src/config/db.ts
    ├── utils/db/
    │   ├── transaction.ts                 COPY   @pt-api/src/utils/db/transaction.ts
    │   ├── cursor.ts                      COPY   @pt-api/src/utils/db/cursor.ts
    │   └── index.ts                       ADAPT  @pt-api/src/utils/db/index.ts  (transaction + cursor; money.ts arrives in Phase 17)
    ├── scripts/ensure-database.ts         COPY   @pt-api/src/scripts/ensure-database.ts
    ├── constants/env.ts                   ADAPT  (+ DATABASE_URL)
    ├── app.ts                             ADAPT  (/health reports the database and gates the status code)
    └── index.ts                           ADAPT  (connectDB before listen; disconnectDB last in shutdown)
```

```bash
pnpm --filter api add prisma@7.10.1 @prisma/client@7.10.1 @prisma/adapter-pg@7.10.1 pg@^8
pnpm --filter api add -D @types/pg@^8
```

Use exact versions, no caret. The CLI, the client and the adapter must match, and an accidental
upgrade to an RC changes generated code.

## 5. Concepts

**Why PostgreSQL.** PaperTrail started on MongoDB and moved. Mongoose dropped unknown filter keys, so
a delete with a misspelled field wiped every row in the org. Prompt Lab's data is a strict tree:

```
workspace → task → examples, prompt versions → run → run variants → results
```

With foreign keys and `ON DELETE CASCADE`, deleting a run deletes its 3,000 results in one statement.
And the unique key on results makes "one result per cell" a database guarantee, not a hope.

Why not the spec's SQLite? Phase 28's integration tests start PostgreSQL 17 in a container and apply
the same migrations a deploy applies. With SQLite in dev and Postgres in prod, you'd be testing a
different database from the one you ship. Aggregation (Phase 18) also leans on PostgreSQL
(`percentile_disc`, `FILTER`, `jsonb_array_elements`).

**Why 7.10.1.** npm's `latest` tag points at `8.0.0-rc.*`. The app is CommonJS, needs interactive
transactions and client extensions, and shouldn't depend on a pre-release API. PaperTrail made the
same call. Check `npm view prisma dist-tags` when you start, and move to 8 only once it's stable, in a
phase of its own.

**The generated client lives in `src/generated/prisma`** (`provider = "prisma-client"`,
`moduleFormat = "cjs"`). It's gitignored and regenerated by `postinstall` and `build`. Import it from
there, never from `@prisma/client`.

**The tenant extension** (`src/db/prisma.ts`, copied). Every query on a model in `TENANT_MODELS` goes
through `$allOperations`:
- **Reads, updates, deletes:** `where` becomes `{ ...where, orgId }`. Since Prisma 5 a unique `where`
  accepts extra filters, so `findUnique({ where: { id } })` means "this id **in this workspace**". A
  run id from another workspace is a 404, not a leak.
- **Creates:** `data.orgId` is set. A different `orgId` in `data` throws `Cross-tenant write refused`.
- **No org in the request context and no `runAsSystem()`:** it **throws**
  `Tenant scope missing for Result.findMany`. Failing closed is the point: a forgotten scope is a crash
  in development, never a silent cross-workspace read in production.

The list is set now for **every** tenant table this project will have (data-model.md), even though
none exist yet, so a model is scoped from the moment it's added:

```ts
export const TENANT_MODELS = new Set<string>([
    "Invite", "AuditLog", "Task", "Example", "PromptVersion", "Run", "RunVariant", "Result",
]);
```

These aren't tenant-scoped:
- `User`, `Session` and `VerificationLink`;
- `Org`, and `Membership` (a user's memberships span workspaces);
- `Model`: the model registry is global and shared by every workspace.

**Worker jobs carry the org.** A run-cell job (Phase 17) has no HTTP request. The worker wraps each job
in `runWithRequestContext({ requestId: job.id, orgId: job.data.orgId, … })`, so the same extension
scopes worker queries. A job with the wrong `orgId` simply finds nothing.

**Raw SQL bypasses it.** `$queryRaw` doesn't go through `$allOperations`. The rule: **every raw
statement on a tenant table filters on `org_id` itself**, and Phase 28's review checklist greps for
`$queryRaw` to check it. Aggregation (Phase 18) is the main user.

**`settleInScope`** (Phase 02's file). A Prisma query is a lazy thenable. Without it,
`runAsSystem(() => prisma.model.findMany())` would return the query unstarted, the scope would end,
and the query would then run with no context and throw. `settleInScope` starts it while the scope is
active.

**Transactions** (`withTransaction(fn)`: interactive, READ COMMITTED, 15 s timeout):
- Use `tx` for every statement inside, or that statement runs outside the transaction.
- Never call a model or enqueue a job inside. Creating a run (Phase 17) commits the `Run`, its
  variants and its frozen prompts first, **then** enqueues the cells. If enqueueing fails, the run is
  `queued` with `doneCells = 0`, and the stale-run sweeper re-enqueues it. Deterministic job ids make
  that safe.
- Races are settled by the database: unique constraints (`P2002` → `isUniqueViolation`) and
  conditional `updateMany({ where: { id, frozenAt: null } })`. Freezing a prompt version twice is one
  conditional update that matches 0 rows the second time.

**Cursor pagination.** Ids are UUIDv7, so they sort by creation time. `afterCursor` + `cursorOrder`
give stable pages on `(createdAt desc, id desc)`, matching indexes like
`(org_id, created_at desc, id desc)` on runs. There's no `OFFSET`, so page 50 costs the same as page 1.

## 6. Steps

1. **Install** (above), then add scripts to `apps/api/package.json`:
   ```json
   "postinstall": "prisma generate",
   "build": "prisma generate && tsc",
   "db:generate": "prisma generate",
   "db:migrate": "prisma migrate deploy",
   "db:migrate:dev": "prisma migrate dev && prisma generate",
   "db:ensure": "tsx src/scripts/ensure-database.ts",
   "db:studio": "prisma studio"
   ```
   Two Prisma 7 behaviours found building the Playbook (2 Nov 2026):
   - `prisma migrate dev` **no longer runs `generate`**. Without the `&& prisma generate`, the client
     keeps its previous types, and every new model "doesn't exist" in `tsc`.
   - `prisma migrate dev` can **hang waiting on stdin** inside `pnpm run` or any script. For scripted
     or CI use, run `pnpm --filter api db:migrate:dev --name <slug> < /dev/null`.

   Every later phase that says "run `db:migrate:dev --name …`" relies on this script.

2. **env.ts / .env.example:**
   ```ts
   // postgresql://user:password@host:5432/db. Hosted (Neon): add ?sslmode=require.
   export const DATABASE_URL = getEnv("DATABASE_URL");
   ```
   ```
   DATABASE_URL=postgresql://promptlab:promptlab@localhost:5432/promptlab
   ```
   Phase 29 adds `DIRECT_DATABASE_URL` for Neon migrations, which run on the unpooled host.

3. **Copy** these files. `prisma.config.ts` reads `DATABASE_URL` with `?? ""`, so `generate` works
   without a database.
   - `prisma.config.ts`
   - `db/errors.ts` and `config/db.ts`
   - `utils/db/transaction.ts` and `utils/db/cursor.ts`
   - `scripts/ensure-database.ts`

4. **schema.prisma** (no models yet):
   ```prisma
   // Prompt Lab's data model on PostgreSQL. Every tenant-owned table carries `org_id` (a workspace is
   // an org); the tenant extension in src/db/prisma.ts scopes every query to the caller's workspace
   // (TENANT_MODELS there). Full target model: docs/reference/data-model.md.
   //
   // Conventions
   // - Ids are UUIDv7 (`uuid(7)`): unique and time-ordered, so (created_at, id) cursors stay cheap.
   // - Tables and columns are snake_case in the database; Prisma fields stay camelCase.
   // - Model cost is integer micro-dollars; running totals that can pass 2^31 are BigInt.
   // - Raw model output is stored exactly as returned. Nothing here repairs it.
   // - No TTL indexes: expiring rows carry expires_at, reads check it, purge-expired deletes them.
   // - Copied models keep PaperTrail's names. Rename nothing for style.

   generator client {
     provider     = "prisma-client"
     output       = "../src/generated/prisma"
     moduleFormat = "cjs"
   }

   datasource db {
     provider = "postgresql"
   }
   ```

5. **db/prisma.ts.** Copy PaperTrail's file, then change only:
   - the `TENANT_MODELS` set (above);
   - its comment: "User, Session, VerificationLink, Org, Membership and the global Model registry are
     not tenant-owned".

   Everything else stays identical: `WHERE_OPERATIONS`, `CREATE_OPERATIONS`, `tenantOrgId`,
   `scopeWhere`, `scopeData`, the extension, `createClient`, and the `Db`/`Tx`/`DbOrTx` types.

6. **utils/db/index.ts:**
   ```ts
   export * from "./transaction";
   export * from "./cursor";
   // Phase 17: money.ts (BigInt micro-dollar helpers for run totals and the workspace budget)
   ```

7. **Generate and baseline.**
   ```bash
   pnpm --filter api db:generate
   pnpm --filter api db:ensure
   pnpm --filter api exec prisma migrate dev --create-only --name init < /dev/null
   ```
   Prisma warns that the schema has no models; that's expected. If your Prisma build refuses to
   generate a client with zero models, do this step together with Phase 04's first models instead,
   and note it in `tasks/lessons.md`. The generated `migration.sql` is empty. Put one comment in it:
   ```sql
   -- Baseline. Tables arrive one phase at a time (docs/reference/data-model.md, "Which phase adds what").
   ```
   Then run `pnpm --filter api db:migrate` to record it in `_prisma_migrations`.

8. **Health and lifecycle.** In `app.ts`:
   ```ts
   app.get("/health", async (_req, res) => {
       const dbUp = await isDbHealthy();
       // Phases 06–07: redis and cache are reported here but never gate the status code.
       return res.status(dbUp ? 200 : 503).json(
           ok({ status: dbUp ? "ok" : "degraded", database: dbUp ? "up" : "down" })
       );
   });
   ```
   In `index.ts`, `await connectDB()` before `listen`, so a wrong `DATABASE_URL` fails at boot
   (`connectDB` runs `SELECT 1`). Make `await disconnectDB()` the **last** shutdown step, resolving the
   `// Phase 03:` comment.

9. **The tenant-rule test** (`src/db/prisma.test.ts`, run once Phase 28 adds Vitest):
   ```ts
   import { describe, expect, it } from "vitest";
   import { tenantOrgId } from "./prisma";
   import { runAsSystem, runWithRequestContext } from "../utils/requestContext";

   describe("tenant scope", () => {
       it("throws with no context: a forgotten scope must crash, not leak", () => {
           expect(() => tenantOrgId("Result.findMany")).toThrow(/Tenant scope missing/);
       });
       it("is null inside runAsSystem (explicit cross-workspace work)", () => {
           expect(runAsSystem(() => tenantOrgId("Run.findUnique"))).toBeNull();
       });
       it("is the request's org, lower-cased", () => {
           const id = "0193A2B4-0000-7000-8000-000000000001";
           expect(runWithRequestContext({ requestId: "t", orgId: id }, () => tenantOrgId("x"))).toBe(id.toLowerCase());
       });
   });
   ```
   The **real** cross-tenant tests (workspace A can't read, update or delete workspace B's runs) arrive
   with the first tenant tables in Phase 11. They run against a real database in Phase 28 (ADAPT of
   `@pt-api/test/tenancy.cross-org.int.test.ts`).

10. Commit: `feat(api): PostgreSQL + Prisma 7 with the tenant extension`.

### `withOrgScope` (used by Phases 22–23)

Next to `runAsSystem`, export a helper for code that already knows the org (a published run's
`orgId`, a CLI flag) and must stay tenant-scoped:

```ts
// utils/requestContext.ts
export const withOrgScope = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
    runWithRequestContext({ ...(getRequestContext() ?? {}), orgId, systemScope: false }, fn);
```

Scripts (`import-cases`, `bench`) call `runWithRequestContext({ orgId, requestId: "cli-<uuid>" }, main)`
so every Prisma call they make is scoped exactly like a request.

## 7. Verify

```bash
pnpm --filter api dev
# PostgreSQL connected successfully!
# Server is listening to the port: 5000

curl -s localhost:5000/health
# {"status":"success","data":{"status":"ok","database":"up"}}

docker stop promptlab-postgres && sleep 1 && curl -s -o /dev/null -w '%{http_code}\n' localhost:5000/health
# 503
docker start promptlab-postgres

docker exec promptlab-postgres psql -U promptlab -d promptlab -c 'select migration_name from _prisma_migrations;'
#  migration_name
# ----------------------
#  2026…_init

# A wrong URL fails at boot, not on the first request:
DATABASE_URL=postgresql://promptlab:wrong@localhost:5432/promptlab pnpm --filter api exec tsx src/index.ts
# failed to start … password authentication failed for user "promptlab"

for f in db/errors.ts config/db.ts utils/db/transaction.ts utils/db/cursor.ts scripts/ensure-database.ts; do
  diff -q ~/Code/paper-trail/apps/api/src/$f apps/api/src/$f; done
diff -q ~/Code/paper-trail/apps/api/prisma.config.ts apps/api/prisma.config.ts
# (no output)
diff ~/Code/paper-trail/apps/api/src/db/prisma.ts apps/api/src/db/prisma.ts | grep '^[<>]' | wc -l
# a small number: only the TENANT_MODELS lines and their comment

git status --short apps/api/src/generated | head -1
# (nothing: the generated client is gitignored)
```

## 8. Definition of done

- [ ] Prisma CLI, client and adapter are exactly 7.10.1 (`pnpm --filter api list prisma @prisma/client @prisma/adapter-pg`).
- [ ] `/health` reports the database and answers 503 when it's down.
- [ ] A bad `DATABASE_URL` stops the server at boot.
- [ ] The baseline migration is recorded in `_prisma_migrations`.
- [ ] `db/prisma.ts` differs from PaperTrail's only in `TENANT_MODELS` and its comment; the other
      copied files are identical.
- [ ] `prisma.test.ts` written (runs in Phase 28).
- [ ] `src/generated/` isn't committed. Committed; `tracker.md` updated.

## 9. Interview angle

*"How do you stop one workspace seeing another's benchmark results?"* Not by remembering to add
`orgId` to every query. The Prisma client is wrapped in an extension that adds the caller's workspace
to every query on a tenant table:
- A `findUnique` by run id becomes "by id and in this workspace", so someone else's run id is a 404.
- A create that names a different workspace is refused.
- A query with no workspace in context throws instead of returning everything.
- Background cell jobs carry the `orgId` and run inside the same context, so the worker is scoped too.

Only the model registry and published-page lookups opt out, explicitly, with `runAsSystem()`.

*"Why not SQLite, as the spec suggested? It's simpler."* Simpler to start, but then I'd test on one
database and ship on another. My integration tests start PostgreSQL 17 in a container and apply the
exact migrations a deploy applies. The aggregation queries use `percentile_disc` and `FILTER`, which
SQLite doesn't have. And the unique key on results is what makes a retried cell job harmless: the
second insert fails with `P2002`, and the worker treats that as "already done".
