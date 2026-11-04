# Phase 06 — Rate limiting (+ demo limiters)

## 1. Goal

Copy the full rate-limiting library:
- atomic Lua sliding windows (plain, punitive, dual-bucket);
- the Redis store with circuit breaker and in-memory fallback;
- trusted-proxy IP extraction and the `visitorId` cookie;
- the global limiter and the auth limiters.

Then replace PaperTrail's document/upload/invite/API-key limiters with Prompt Lab's:
- **run creation** per owner;
- **bring-your-own-key demo runs** per visitor **and** per IP (Phase 22);
- **published page** reads.

## 2. What I will understand after this phase

1. Why the check-and-commit is one Lua script.
2. Sliding vs fixed windows; punitive lockouts; the dual bucket.
3. How the circuit breaker keeps the API up when Redis is sick.
4. Why the demo limiter needs **two** axes (visitor cookie *and* IP).

## 3. Prerequisites

Phase 05 done; both Redis containers running.

## 4. Files

```
apps/api/src/
├── config/redis.ts                         COPY   @pt-api/src/config/redis.ts
├── config/rateLimiter.ts                   ADAPT  @pt-api/src/config/rateLimiter.ts      (keep global + auth + protectedApi; new Prompt Lab limiters)
├── constants/rateLimiter.constant.ts       ADAPT  @pt-api/src/constants/rateLimiter.constant.ts
├── types/rateLimiter.types.ts              COPY   @pt-api/src/types/rateLimiter.types.ts
├── utils/rateLimiter/*                     COPY   @pt-api/src/utils/rateLimiter/
├── middleware/{rateLimiter,visitorId}.ts   COPY   @pt-api/src/middleware/
├── routes/auth.route.ts                    ADAPT  (restore PaperTrail's limiter wiring)
├── constants/env.ts                        ADAPT  (+ REDIS_*, CACHE_REDIS_*, TRUSTED_PROXY_CIDRS, DEBUG_IP_ENDPOINT)
└── app.ts                                  ADAPT  (trust proxy, visitorId, globalLimiter, /debug-ip)
```

```bash
pnpm --filter api add ioredis ipaddr.js proxy-addr && pnpm --filter api add -D @types/proxy-addr
```

## 5. Concepts

The library's reasoning is in PaperTrail's Phase 06 doc and e-commerce's architecture reference §5.
What's new here:

**The demo is the attack surface.** A public page that runs models is an invitation to abuse:
- someone loops it with a stolen key (*their* bill, but *your* server's CPU and reputation);
- someone loops it with no key, hoping to hit *your* key.

Phase 22 guarantees the second can't happen (owner keys are never used for anonymous runs). This phase
caps the first:
- `demoRunVisitorLimiter`: per `visitorId` cookie, 5 runs / hour;
- `demoRunIpLimiter`: per client IP, 20 runs / hour. Clearing cookies gets a new visitor id, not a
  new IP; and a shared office IP still allows several visitors.
- both use the plain sliding window (not punitive): a lockout on an IP would punish an entire campus.

**Owner limits.** `runCreateLimiter`: per user, 20 runs / 10 min. A runaway UI loop can't enqueue
thousands of grids. (The provider-side pace is Phase 16's lease semaphore, a different limit.)

**Published pages** are cacheable reads. `publicReadLimiter` (per IP, 300 / 5 min) is enough to stop
scraping loops.

## 6. Steps

```bash
cd ~/Code/prompt-lab/apps/api/src; PT=~/Code/paper-trail/apps/api/src
mkdir -p utils/rateLimiter
cp $PT/config/redis.ts config/ && cp $PT/types/rateLimiter.types.ts types/
cp $PT/utils/rateLimiter/* utils/rateLimiter/
cp $PT/middleware/{rateLimiter,visitorId}.ts middleware/
cp $PT/config/rateLimiter.ts config/ && cp $PT/constants/rateLimiter.constant.ts constants/
```

`rateLimiter.constant.ts`: remove the upload, document, invite, API-key and org prefixes, and add:

```ts
export const RUN_CREATE_PREFIX = "rl:runs:create";
export const DEMO_RUN_VISITOR_PREFIX = "rl:demo:visitor";
export const DEMO_RUN_IP_PREFIX = "rl:demo:ip";
export const PUBLIC_READ_PREFIX = "rl:public";
```

`config/rateLimiter.ts`: delete `uploadPresignLimiter`, `documentWriteLimiter`, `inviteSourceLimiter`,
`inviteTargetLimiter`, `apiKeyLimiter` (and any org limiter). Keep the key resolvers, `globalLimiter`,
every auth limiter and `protectedApiLimiter`. Add:

```ts
export const runCreateLimiter = createRateLimiter({
    prefix: RUN_CREATE_PREFIX, windowMs: 10 * ONE_MINUTE_MS, max: 20,
    keyResolver: (req: Request) => `user:${req.userId}`,
});

/*
  Public demo runs with the visitor's own key (Phase 22). Two axes: the visitor cookie (fairness
  between people) and the IP (cookie clearing doesn't reset it). Plain windows, not punitive: an IP
  lockout would block a whole campus behind one NAT.
 */
export const demoRunVisitorLimiter = createRateLimiter({
    prefix: DEMO_RUN_VISITOR_PREFIX, windowMs: ONE_HOUR_MS, max: 5,
    keyResolver: (req: Request) => `v:${visitorKeyResolver(req)}`,
});
export const demoRunIpLimiter = createRateLimiter({
    prefix: DEMO_RUN_IP_PREFIX, windowMs: ONE_HOUR_MS, max: 20, keyResolver: ipKeyResolver,
});
export const publicReadLimiter = createRateLimiter({
    prefix: PUBLIC_READ_PREFIX, windowMs: FIVE_MINUTES_MS, max: 300, keyResolver: ipKeyResolver,
});
```

Restore the limiter wiring in `auth.route.ts` (copy PaperTrail's file again and keep it identical, if
nothing else differs). Mount `trust proxy`, `visitorIdMiddleware`, `globalLimiter` and the optional
`/debug-ip` in `app.ts` in PaperTrail's order. Restore the env block. Delete the Phase 05 stub.

## 7. Verify

Rate-limit headers on every response. The login lockout fires at attempt 11 (PaperTrail's loop). With
`redis` stopped, requests still succeed (memory fallback). `diff -q` the COPY files.

## 8. Definition of done

- [ ] The library is copied unchanged; Prompt Lab's limiters are declared (used in Phases 16/21/22).
- [ ] The API survives a Redis outage.
- [ ] Commit: `feat(api): rate limiting with demo limiters`.

## 9. Interview angle

*"How do you protect a public demo that runs paid APIs?"* Anonymous runs never touch my keys. They're
limited per visitor cookie and per IP with atomic Lua sliding windows, and the limiter fails over to
memory when Redis is down, so protection never becomes an outage.
