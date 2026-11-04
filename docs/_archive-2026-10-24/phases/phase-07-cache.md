# Phase 07 — Response cache

## 1. Goal

Replace the Phase 04 stub with the real versioned cache: cache-aside over `redis-cache`, never
throwing, with single-flight and a breaker. In Prompt Lab it serves:
- the session check;
- **run aggregates** (the results table: `$group` over thousands of results);
- **published pages**, read by anyone.

## 2. What I will understand after this phase

1. Versioned namespaces vs deleting keys.
2. Why finished runs are perfect cache material (results stop changing).
3. Why a cache miss must cost no more than the query it saves.

## 3. Prerequisites

Phase 06 done.

## 4. Files

```
apps/api/src/
├── utils/cache/cache.ts      ADAPT  @pt-api/src/utils/cache/cache.ts   (CacheDomain values only)
├── utils/cache/index.ts      COPY   @pt-api/src/utils/cache/index.ts
├── constants/env.ts          ADAPT  (+ CACHE_ENABLED)
├── app.ts                    ADAPT  (/health reports redis)
└── index.ts                  ADAPT  (cache.close() on shutdown)
```

## 5. Concepts

**Domains in Prompt Lab:**

| Domain | Bumped when | Cached reads |
| --- | --- | --- |
| `results` | a cell result is written, a run is re-scored (Phase 17), a run is cancelled | the run aggregate table, error-browser facets |
| `published` | a run is published or unpublished | public run pages by slug |

**Finished runs.** While a run is in progress, its aggregate changes with every cell, so it gets a
short TTL (10 s) and the SSE progress invalidates it often. Once completed it never changes (unless
re-scored, which bumps `results`), so it gets a long TTL (1 h). `getOrSet` takes a TTL function for
exactly this: `(value) => value.status === "completed" ? 3600 : 10`.

Everything else (versioned keys, single-flight, fail-as-miss, the fast-fail Redis config) is
PaperTrail's and e-commerce's, unchanged.

## 6. Steps

```bash
cd ~/Code/prompt-lab/apps/api/src; PT=~/Code/paper-trail/apps/api/src
cp $PT/utils/cache/{cache,index}.ts utils/cache/
```

In `cache.ts`, change only the domain type and its comment:

```ts
/*
  Prompt Lab's domains. `results` backs run aggregates and the error browser and is bumped by every
  result write and re-score; `published` backs public pages and is bumped on publish/unpublish.
  Sessions are per-entity keys, not a domain.
 */
export type CacheDomain = "results" | "published";
```

Restore `CACHE_ENABLED`, put PaperTrail's `/health` (with the Redis line) back, and add
`cache.close()` to shutdown.

## 7. Verify

`/health` → `redis: "up"`. Session keys appear on `/auth/me` and disappear on logout. Stop
`redis-cache` → the app works and `/health` says `redis: "down"`. `diff` shows only the domain block
changed.

## 8. Definition of done

- [ ] The real cache is in; the stub is gone; domains are set.
- [ ] Commit: `feat(api): versioned cache`.

## 9. Interview angle

*"What do you cache?"* Aggregates over thousands of results. They're stable once a run finishes, so
the TTL depends on the run's status, and invalidation is an O(1) version bump.
