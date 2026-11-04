# Phase 07 — Response cache

## 1. Goal

Copy PaperTrail's cache-aside layer (e-commerce's cache, ported) onto the second Redis instance
(`redis-cache`, `volatile-lru`):
- versioned namespaces for O(1) invalidation;
- single-flight for concurrent misses;
- a circuit breaker;
- **never throws**: every failure reads as a miss.

Use it now for the one thing that exists: the **session check** in `authenticate`. Resolve Phase 05's
`// Phase 07:` comments so `authenticate.ts` matches PaperTrail's and `revokeSessions` clears the
cached state.

Then declare Prompt Lab's three versioned domains (`tasks | runs | published`) and say exactly who
reads and who bumps each one, so Phases 11–13, 17–18, 22 and 26 only fill in calls.

## 2. What I will understand after this phase

1. Why a cache must be allowed to evict and a queue must not, and why that takes two Redis instances.
2. Versioned namespaces vs deleting keys, and the stale-write race they close.
3. Single-flight: one database query per expired hot key, not one per request in flight.
4. Why the session check fails **closed** when Redis is down.
5. Why a **running** run's numbers are never cached, and a **completed** run's almost always are.
6. Why the cache's ioredis config gives up after 300 ms and disables the offline queue.

## 3. Prerequisites

- Phase 06 done (`config/redis.ts` with `getCacheRedisConfig`, `CACHE_REDIS_*` in `env.ts`).
- `docker compose up -d redis-cache` (`promptlab-redis-cache` on :6380).

## 4. Files

```
apps/api/src/
├── utils/cache/
│   ├── cache.ts                  ADAPT  @pt-api/src/utils/cache/cache.ts   (CacheDomain + its comment only)
│   └── index.ts                  COPY   @pt-api/src/utils/cache/index.ts
├── constants/env.ts              ADAPT  (+ CACHE_ENABLED; CACHE_REDIS_* came in Phase 06)
├── middleware/authenticate.ts    ADAPT  resolve the Phase 05 comment → PaperTrail's assertSessionActive
├── services/auth.service.ts      ADAPT  revokeSessions clears cache:session:<id> (as @pt-api/src/services/auth.service.ts)
├── app.ts                        ADAPT  /health reports `redis` from cache.ping() (as @pt-api/src/app.ts)
└── index.ts                      ADAPT  cache.close() in the shutdown sequence (as @pt-api/src/index.ts)
```

No new dependencies (ioredis came in Phase 06).

## 5. Concepts

**Two Redis instances.** The queue and limiter instance is `noeviction`: if BullMQ's keys were
evicted under memory pressure, cells of a run would vanish silently and the run would never finish. A
cache that can't evict grows until Redis refuses writes. One instance can't be both. `redis-cache`
runs `volatile-lru`, 256 MB, no persistence. It evicts only keys with a TTL, and every cache entry has
one. The version counters (`cache:ver:<domain>`) deliberately don't, so they're never evicted. An
empty cache after a restart is the correct state.

**Cache-aside that never throws.** `getOrSet(key, fetcher, ttl)` reads Redis. On a miss it runs the
fetcher, writes the result without awaiting it, and returns it. Redis down, slow, not yet connected,
or `CACHE_ENABLED=false` all mean "miss", and the caller reads Postgres as if there were no cache. The
circuit breaker (the limiter's `RedisCircuitBreaker`, reused) stops a hung Redis from adding its
timeout to every request.

**Why 300 ms and no offline queue.** A miss costs one Postgres query, a few milliseconds. Waiting a
second for a sick Redis is worse than the query. With the offline queue on, commands issued while
disconnected pile up and replay on reconnect, so a request would wait for Redis to come back. With it
off they fail instantly, which here means "miss".

**Versioned namespaces.** Each domain has a counter. `versionedKey(["runs"], "org:<id>:list")` reads
the counters and produces `cache:runs.7:org:<id>:list`. A write calls `cache.bump("runs")` **after**
it commits. The counter becomes 8, nobody reads `runs.7` keys again, and they age out by TTL. That's
O(1) however many keys exist. It also closes a race: a slow request that read old rows just before the
write, and stores them just after it, stores them under `runs.7`, which nobody reads.

**Per-entity keys** are for things you can name and delete directly: `cache:session:<sessionId>`, and
Phase 10's `cache:membership:<orgId>:<userId>`.

**Session check.** A valid JWT only proves the token was issued. `authenticate` also checks the
session row still exists, so logout and "sign out this device" work immediately. The confirmed-active
state is cached for 60 s under `cache:session:<id>`, so most requests skip Postgres. Two things keep
that safe:
- **Every revocation goes through `revokeSessions`.** It deletes by id, then deletes each session's
  cache key. A direct `prisma.session.deleteMany` would leave `authenticate` trusting its cache for up
  to a minute.
- **It fails closed.** With Redis down, `cache.get` is a miss, so every request checks Postgres.
  Slower, never less safe.

### Prompt Lab's domains

```ts
export type CacheDomain = "tasks" | "runs" | "published";
```

| Domain | What's cached (key suffix) | TTL | Read by | Bumped by |
| --- | --- | --- | --- | --- |
| `tasks` | the task list with per-split / per-tag example counts and prompt-version counts (`org:<orgId>:list`), one task's header (`org:<orgId>:task:<id>`) | 5 min | Phases 11, 19 | task writes (11), example import/edit/delete/split (12), prompt create/freeze (13) |
| `runs` | the run list (`org:<orgId>:list`) and a **completed** run's summary per tag (`org:<orgId>:run:<id>:summary:<tag or *>`) | 10 min | Phases 18, 21 | run created, finalized, cancelled or deleted (17–18), judge results written (26), publish changes (22) |
| `published` | a published run's public payload (`slug:<slug>`) and its result pages (`slug:<slug>:results:<cursor>`) | 10 min | Phase 22 | publish / unpublish (22), run deleted (17), judge (26) |

**Running runs are never cached.** While cells are completing, the summary changes every second and
the UI gets live numbers over SSE (Phase 17). Only a `completed` run's summary goes through
`getOrSet`; the service checks `run.status === "completed"` before using the cache at all. A
completed run is effectively immutable, so its entry is hit almost every time the results page is
opened. That's the case the cache exists for: the aggregation over thousands of result rows (Phase 18)
is the most expensive query in the app.

**Published pages** get their own domain because they're public and read by strangers. A bump there
never touches the owner's run list, and an unpublish takes effect on the next request.

## 6. Steps

1. Copy `utils/cache/index.ts`. Copy `cache.ts` and change only the domain type and its comment:
   ```ts
   /*
     Prompt Lab's domains. Every key's suffix starts with `org:<orgId>` (or `slug:<slug>` for public
     pages), so one workspace never reads another's entry.
     - tasks: task lists, task headers, example and prompt counts (Phases 11–13, 19);
     - runs: run lists and COMPLETED runs' summaries (Phases 17–18, 21). Running runs are never cached;
     - published: public run pages by slug (Phase 22).
     Sessions (`cache:session:<id>`) and memberships (`cache:membership:<orgId>:<userId>`, Phase 10)
     are per-entity keys, not domains.
    */
   export type CacheDomain = "tasks" | "runs" | "published";
   ```
   Then `diff` against PaperTrail's: only those lines differ.
2. `env.ts`: `export const CACHE_ENABLED = getEnv("CACHE_ENABLED", "true");` with PaperTrail's comment
   (the emergency off-switch). `.env.example`: `CACHE_REDIS_HOST=localhost`, `CACHE_REDIS_PORT=6380`.
3. `middleware/authenticate.ts`: Phase 05 left the session lookup reading Postgres on every request,
   with a `// Phase 07:` comment. Replace it with PaperTrail's `assertSessionActive`:
   `SESSION_CACHE_TTL_SECONDS = 60`, `cache.get(sessionCacheKey(id))` first, then the `isUuid` +
   `prisma.session.count({ where: { id, expiresAt: { gt: new Date() } } })` check, then
   `void cache.set(key, "1", SESSION_CACHE_TTL_SECONDS)`. If Phase 05 added a
   `setRequestContext({ userId })` line for log context, keep it with a one-line comment
   (`// ADAPT: log context (Phase 05); otherwise identical to PaperTrail`). `diff` against
   `@pt-api/src/middleware/authenticate.ts` then shows that hunk and nothing else. The Playbook and
   the Enquiry plan made the same documented exception.
4. `services/auth.service.ts`: `revokeSessions` gains the cache clear (PaperTrail's version):
   ```ts
   export const revokeSessions = async (where: Prisma.SessionWhereInput) => {
       const sessions = await prisma.session.findMany({ where, select: { id: true } });
       if (sessions.length === 0) return 0;
       const ids = sessions.map((session) => session.id);
       // By id, not by the original filter: a session created after the find is not part of this revocation.
       await prisma.session.deleteMany({ where: { id: { in: ids } } });
       await cache.del(...ids.map(sessionCacheKey));
       return ids.length;
   };
   ```
   Then `rg "session\.(delete|deleteMany)" apps/api/src`. The only hits allowed are inside
   `revokeSessions` and Phase 08's `purge-expired`. An expired row can't keep a live cache entry for
   longer than the 60 s TTL, and `authenticate` re-checks `expiresAt` on every miss.
5. `/health` (as PaperTrail):
   ```ts
   app.get("/health", async (_req, res) => {
       const [dbUp, redisReady] = await Promise.all([isDbHealthy(), cache.ping()]);
       return res.status(dbUp ? 200 : 503).json(ok({
           status: dbUp ? "ok" : "degraded",
           database: dbUp ? "up" : "down",
           redis: redisReady ? "up" : "down",
       }));
   });
   ```
   Only the database decides the status code. The app works without the cache.
6. `index.ts` shutdown order: stop accepting connections → close workers (Phase 08) → `cache.close()`
   → `disconnectDB()`, with PaperTrail's force-exit timer.
7. Leave a `// Phase NN: cache.bump("<domain>")` comment where each domain will be bumped, in the
   service files of Phases 11–13 and 17 when they are written. Nothing to add now: no task, run or
   publish code exists yet.

**Two behaviours of the copied client** (seen building the Playbook, 2 Nov 2026):
- A fresh process's first cache calls are **misses**. Until the client is `ready`, reads fall through
  by design. A script or test that asserts cache behaviour must `await cache.ping()` first.
- Behind a TCP proxy (Docker Desktop's port forwarder locally, a hosted Redis's load balancer in
  production), a **restarted** Redis can leave ioredis "ready" on a dead socket, and the breaker keeps
  the cache off until the API restarts. That's safe here (every read falls through to Postgres, and
  the session check fails closed), so the file stays as copied. When `/health` says `redis: down`
  after a Redis restart, restart the API.

## 7. Verify

```bash
docker compose up -d && pnpm --filter api dev
curl -s localhost:5000/health
# {"status":"success","data":{"status":"ok","database":"up","redis":"up"}}

# Log in with the Phase 04 account (cookies in a.txt), then:
curl -s -b a.txt localhost:5000/auth/me > /dev/null
docker exec promptlab-redis-cache redis-cli --scan --pattern 'cache:session:*'
# cache:session:0193…
docker exec promptlab-redis-cache redis-cli TTL "cache:session:<id>"
# (integer) 5x                          (≤ 60)

# Log out (the verb Phase 04 kept from PaperTrail):
curl -s -b a.txt localhost:5000/auth/logout > /dev/null
docker exec promptlab-redis-cache redis-cli EXISTS "cache:session:<id>"
# (integer) 0                           (cleared by revokeSessions)
curl -s -o /dev/null -w "%{http_code}\n" -b a.txt localhost:5000/auth/me
# 401                                   (immediately, not after 60 s)

# Fail closed: stop the cache; a live session (b.txt, a second login) still works, from Postgres.
docker stop promptlab-redis-cache
curl -s localhost:5000/health          # … "redis":"down"  (HTTP 200)
curl -s -o /dev/null -w "%{http_code}\n" -b b.txt localhost:5000/auth/me     # 200
docker start promptlab-redis-cache     # then restart the API if /health still says down (see §6)

# Versioning, from a scratch script:
pnpm --filter api exec tsx -e 'import("./src/utils/cache").then(async ({ cache }) => {
  await cache.ping();
  const k1 = await cache.versionedKey(["runs"], "org:x:list"); await cache.bump("runs");
  const k2 = await cache.versionedKey(["runs"], "org:x:list");
  console.log(k1, "→", k2); await cache.close(); process.exit(0) })'
# cache:runs.0:org:x:list → cache:runs.1:org:x:list

diff ~/Code/paper-trail/apps/api/src/utils/cache/cache.ts apps/api/src/utils/cache/cache.ts   # only CacheDomain + comment
diff ~/Code/paper-trail/apps/api/src/middleware/authenticate.ts apps/api/src/middleware/authenticate.ts   # at most the log-context hunk
pnpm --filter api typecheck
```

Check `versionedKey`'s exact signature in the copied `cache.ts` before running the script. The copy is
the authority; adjust the call, not the file.

## 8. Definition of done

- [ ] `cache.ts` differs from PaperTrail's only in `CacheDomain` and its comment; `index.ts` is COPY.
- [ ] `authenticate.ts` matches PaperTrail's apart from the documented log-context line; no
      `// Phase 07:` comments remain.
- [ ] `revokeSessions` is the only code that deletes live sessions, and it clears `cache:session:*`.
- [ ] `/health` reports `redis`; the status code depends only on the database.
- [ ] The app works with `redis-cache` stopped (sessions checked against Postgres).
- [ ] The domain table above is in `cache.ts`'s comment, so Phases 11–26 know what to bump.
- [ ] Commit: `feat(api): versioned cache and cached session checks`.

## 9. Interview angle

*"What do you cache in a benchmarking tool, where numbers must be exact?"* Only things that can't
change under you. A completed run's results table is the expensive query in the app (thousands of
result rows aggregated per prompt, model and tag), and once a run finishes it's effectively immutable,
so it's cached. A running run is never cached: its numbers come live over SSE. And a cache miss is
always correct, just slower, so the cache can only cost speed, never truth.

*"How do you invalidate without deleting keys?"* Versioned namespaces. Each domain has a counter baked
into every key. A write bumps the counter after it commits, so old keys are never read again and expire
on their own. That's O(1), and it closes the race where a slow reader writes stale data back after an
invalidation: it writes under the old version, which nobody reads.

*"You cache the session check. Doesn't that delay logout?"* No. Revocation has one door,
`revokeSessions`, and it deletes the cache key along with the row. If Redis is down, every request reads
Postgres: the check fails closed, never open.
