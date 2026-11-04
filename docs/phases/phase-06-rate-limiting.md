# Phase 06 — Rate limiting (+ demo and public limiters)

## 1. Goal

Copy PaperTrail's rate limiter, which is e-commerce's limiter unchanged. It's effectively a small
library:
- three atomic Lua scripts (sliding window, punitive lockout, dual bucket);
- a Redis store with a circuit breaker and an in-memory fallback;
- trusted-proxy client-IP extraction;
- an anonymous `visitorId` cookie;
- a global dual-bucket limiter and the auth limiters.

Then **declare** the limiters Prompt Lab's own endpoints will attach later, so their numbers are
decided once, in one file:

| Limiter | Protects | Attached in |
| --- | --- | --- |
| `runCreateLimiter` | `POST /orgs/:orgId/runs` (a runaway UI loop can't enqueue thousands of cells) | 17 |
| `demoDualLimiter` | `POST /demo/run`: visitor 5 / hour **and** IP 20 / hour | 23 |
| `demoDailyCapLimiter` | the whole demo: 500 runs / 24 h, all visitors together | 23 |
| `publicReadLimiter` | `GET /public/runs/:slug…`: 300 / 5 min per IP | 22 |
| `inviteSourceLimiter`, `inviteTargetLimiter` | `POST /orgs/:orgId/invites` (kept from PaperTrail) | 10 |

Finally, replace Phase 05's `// Phase 06:` placeholders in `auth.route.ts` with PaperTrail's exact
limiter chains.

## 2. What I will understand after this phase

1. Why the check must be a Lua script (atomic), not `INCR` + `EXPIRE` from Node.
2. Sliding window vs fixed window, and why the sliding window uses a sorted set.
3. Punitive lockout vs plain window, and why neither the login *account* axis nor the demo is punitive.
4. How the dual bucket charges both buckets or neither.
5. How the circuit breaker keeps the API up when Redis is sick.
6. Why the public demo is the attack surface of this app, and why its limits are what they are.
7. Why the demo's visitor key is a header, not the `visitorId` cookie.

## 3. Prerequisites

- Phase 05 done (`authenticate`, `/auth/me`, device sessions, Google sign-in).
- `docker compose up -d redis` (`promptlab-redis` on :6379, `noeviction`, from Phase 00). The
  container names in this guide assume Phase 00's `promptlab-*` prefix. Check `docker compose ps`.

## 4. Files

```
apps/api/src/
├── config/
│   ├── redis.ts                      COPY   @pt-api/src/config/redis.ts            (all three ioredis configs; the cache one is used in Phase 07)
│   └── rateLimiter.ts                ADAPT  @pt-api/src/config/rateLimiter.ts      (drop upload/document/api-key/org limiters; add run/demo/public)
├── constants/
│   ├── rateLimiter.constant.ts       ADAPT  @pt-api/src/constants/rateLimiter.constant.ts  (drop 4 prefixes; + RUN_/DEMO_/PUBLIC_ prefixes)
│   └── env.ts                        ADAPT  (+ REDIS_*, CACHE_REDIS_*, TRUSTED_PROXY_CIDRS, DEBUG_IP_ENDPOINT, DEMO_DAILY_CAP)
├── types/rateLimiter.types.ts        COPY   @pt-api/src/types/rateLimiter.types.ts
├── utils/rateLimiter/
│   ├── circuitBreaker.ts             COPY   @pt-api/src/utils/rateLimiter/circuitBreaker.ts
│   ├── ipExtractor.ts                COPY   @pt-api/src/utils/rateLimiter/ipExtractor.ts
│   ├── luaScript.ts                  COPY   @pt-api/src/utils/rateLimiter/luaScript.ts
│   ├── memoryStore.ts                COPY   @pt-api/src/utils/rateLimiter/memoryStore.ts
│   ├── redisStore.ts                 COPY   @pt-api/src/utils/rateLimiter/redisStore.ts
│   └── index.ts                      COPY   @pt-api/src/utils/rateLimiter/index.ts
├── middleware/
│   ├── rateLimiter.ts                COPY   @pt-api/src/middleware/rateLimiter.ts
│   └── visitorId.ts                  COPY   @pt-api/src/middleware/visitorId.ts
├── types/express.d.ts                ADAPT  (resolve Phase 04's comment: + visitorId?: string)
├── routes/auth.route.ts              ADAPT  (= @pt-api/src/routes/auth.route.ts limiter wiring; replaces the Phase 05 placeholders)
├── app.ts                            ADAPT  (trust proxy, visitorId, globalLimiter, /debug-ip; CORS allows X-Lab-Visitor — as @pt-api/src/app.ts)
└── index.ts                          ADAPT  (production warning when TRUSTED_PROXY_CIDRS is empty — as @pt-api/src/index.ts)
```

All COPY sources are themselves byte-identical to `@ec-api/src/utils/rateLimiter/*` and
`@ec-api/src/middleware/{rateLimiter,visitorId}.ts`; PaperTrail only added comments. Diff against
`@pt-api`, because its imports match this repo.

```bash
pnpm --filter api add ioredis@^5.11.1 ipaddr.js@^2.5.0 proxy-addr@^2.0.8
pnpm --filter api add -D @types/proxy-addr@^2.0.3
```

## 5. Concepts

**Atomic or wrong.** "Read the count, compare, increment" from Node is three round trips. Two
requests can both read 9 under a limit of 10 and both pass. Each Lua script runs as one command
inside Redis, so the check and the write can't interleave.

**Sliding window.** A fixed window (`INCR` a per-minute key) lets 2× the limit through at a minute
boundary. The sliding window keeps a sorted set of hit timestamps per key, drops those older than the
window, counts the rest and adds the new hit only if allowed. Exact, at the cost of one set member
per hit, which is fine at these limits.

**Punitive.** Past the limit, a lock key is set with a TTL and every request is rejected until it
expires. Right for an IP walking a password list. Wrong for a key anyone can choose: the login
**account** limiter is a plain window, because anyone can type a victim's email, and a lockout there
would let anyone lock anyone out.

**Dual bucket.** One script checks a visitor bucket and an IP bucket together. If either rejects,
**neither is charged**, so a visitor blocked by a noisy neighbour's IP bucket doesn't also burn their
own budget.

**Circuit breaker.** After 10 Redis failures the store goes `OPEN` and serves from an in-memory store
with the same semantics for 30 s, then `HALF_OPEN` sends one probe. During an outage limits are per
process: looser, never off. A sick Redis never blocks traffic.

**Client IP.** `CF-Connecting-IP` is believed only when the TCP peer is in `TRUSTED_PROXY_CIDRS`.
Otherwise `proxy-addr` walks `X-Forwarded-For` from the right and stops at the first untrusted hop.
Express's `trust proxy` uses the same function, so `req.ip` and the limiter agree on who the client is.

### The demo is the attack surface

Prompt Lab has exactly one endpoint that makes model calls for strangers: `POST /demo/run`
(Phase 23). It uses the **visitor's own** key, and the owner's key is never a fallback. So the abuse
isn't "spend my money". It's:
- someone loops the demo with a stolen key, using this server as a free proxy (their victim's bill,
  my CPU and my server's reputation with the provider);
- someone hammers it to make the API slow for everyone else.

The limits:

| Limiter | Window | Why this size |
| --- | --- | --- |
| `demoDualLimiter`: visitor 5 + IP 20 | 1 hour | A real visitor tries the demo two or three times. Twenty per IP lets a classroom behind one NAT have a go |
| `demoDailyCapLimiter`: 500 | 24 h, one key for everyone | Caps the worst case (a botnet, many IPs) at a known number of tiny runs a day |

Both are **plain windows, not punitive**: an IP lockout would block a whole campus for one student's
script. Each demo run is itself tiny (≤ 10 examples, 1 prompt × 1 model; Phase 23), so 500 runs is at
most 5,000 calls, all on visitors' keys.

**The visitor key for the demo.** The web app (Vercel) calls the API (Render) cross-site, where the
API's `visitorId` cookie is a **third-party cookie**: Safari and Firefox block it and Chrome restricts
it. So the demo's visitor key is, in order: an `X-Lab-Visitor` header (a random id the web app keeps
in `localStorage`, Phase 23), else the cookie, else the IP. The header is trivially spoofable, and
that's fine: it's a **fairness** key, so one person's retries don't eat their neighbour's budget. The
IP bucket next to it is what a spoofer can't escape, and the dual-bucket script charges both or
neither.

**Owner limits.** `runCreateLimiter` (per user, 20 runs / 10 min) stops a runaway client loop from
enqueuing thousands of grids. The provider-side pace (requests per second to NVIDIA or OpenAI) is a
different limit: the runner's per-provider concurrency in Phase 17.

**Public pages.** Published runs (`/public/runs/:slug`, Phase 22) are cached reads. `publicReadLimiter`
(per IP, 300 / 5 min) only stops scraping loops.

## 6. Steps

1. Copy the COPY files and `diff` each against its source (expect no output):
   ```bash
   cd ~/Code/prompt-lab/apps/api/src; PT=~/Code/paper-trail/apps/api/src
   mkdir -p utils/rateLimiter
   for f in utils/rateLimiter/{circuitBreaker,ipExtractor,luaScript,memoryStore,redisStore,index}.ts \
            middleware/{rateLimiter,visitorId}.ts types/rateLimiter.types.ts config/redis.ts; do
     cp $PT/$f $f && diff -q $PT/$f $f; done
   ```
   Keep `GLOBAL_VISITOR_PREFIX` and `GLOBAL_IP_PREFIX` in the constants file: the copied
   `middleware/rateLimiter.ts` imports them and reads `req.visitorId` in its fallback (the Playbook
   build deleted them once and the COPY file stopped compiling).
2. `env.ts`: add after the JWT block:
   ```ts
   export const TRUSTED_PROXY_CIDRS = getEnv("TRUSTED_PROXY_CIDRS", "");
   export const DEBUG_IP_ENDPOINT = getEnv("DEBUG_IP_ENDPOINT", "false");
   export const REDIS_HOST = getEnv("REDIS_HOST");
   export const REDIS_PORT = getEnv("REDIS_PORT");
   export const REDIS_USERNAME = getEnv("REDIS_USERNAME", "");
   export const REDIS_PASSWORD = getEnv("REDIS_PASSWORD", "");
   // Demo runs (all visitors together) per 24 h. Each run is ≤ 10 calls on the visitor's own key.
   export const DEMO_DAILY_CAP = getEnv("DEMO_DAILY_CAP", "500");
   ```
   `config/redis.ts` imports `CACHE_REDIS_*` too, so add those four lines now, exactly as in
   `@pt-api/src/constants/env.ts` (cache host defaulting to `REDIS_HOST`, port `6380`). The cache
   itself is Phase 07. `.env.example` gains `REDIS_HOST=localhost`, `REDIS_PORT=6379`.
3. `constants/rateLimiter.constant.ts`: start from PaperTrail's file. Delete `UPLOAD_PRESIGN_PREFIX`,
   `DOCUMENT_WRITE_PREFIX`, `API_KEY_PREFIX` and `ORG_PREFIX`. Keep everything else, including both
   invite prefixes. Add:
   ```ts
   export const RUN_CREATE_PREFIX = "rl:runs:create";
   export const DEMO_VISITOR_PREFIX = "rl:demo:visitor";
   export const DEMO_IP_PREFIX = "rl:demo:ip";
   export const DEMO_DAILY_PREFIX = "rl:demo:daily";
   export const PUBLIC_READ_PREFIX = "rl:public";
   export const TEN_MINUTES_MS = 10 * 60 * 1000;
   ```
4. `config/rateLimiter.ts`: start from PaperTrail's file. Delete `callerKeyResolver`,
   `uploadPresignLimiter`, `documentWriteLimiter`, `apiKeyLimiter` and `orgApiLimiter`. Keep the key
   resolvers, `globalLimiter`, every auth limiter, `protectedApiLimiter` and both invite limiters.
   Append:
   ```ts
   /*
     Owner side (Phase 17). Starting a run enqueues every cell of the grid; a client stuck in a loop
     must not be able to enqueue thousands of grids. Per user, not per IP.
    */
   export const runCreateLimiter = createRateLimiter({
       prefix: RUN_CREATE_PREFIX,
       windowMs: TEN_MINUTES_MS,
       max: 20,
       keyResolver: (req: Request) => `user:${req.userId}`,
   });

   /*
     The public demo (Phase 23) runs on the VISITOR's key, never the owner's. These limits stop it
     from being used as a free proxy for someone else's (possibly stolen) key, and stop one visitor
     from crowding out the rest. The web app calls the API cross-site, where the visitorId cookie is a
     blocked third-party cookie, so the web app sends its own random id. It's a fairness key, not a
     security boundary: the IP bucket beside it is what a spoofer can't escape.
     Plain windows, never punitive: an IP lockout would punish a whole campus behind one NAT.
    */
   const VISITOR_HEADER_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
   const demoVisitorKeyResolver = (req: Request): string => {
       const header = req.get("x-lab-visitor");
       if (header && VISITOR_HEADER_PATTERN.test(header)) return `h:${header}`;
       return visitorKeyResolver(req);
   };

   export const demoDualLimiter = createDualRateLimiter({
       visitorPrefix: DEMO_VISITOR_PREFIX,
       ipPrefix: DEMO_IP_PREFIX,
       windowMs: ONE_HOUR_MS,
       visitorLimit: 5,
       ipLimit: 20,
       visitorKeyResolver: demoVisitorKeyResolver,
       ipKeyResolver: (req: Request) => extractClientIp(req),
   });

   // One bucket for every visitor: the worst case per day is a known number of tiny runs.
   export const demoDailyCapLimiter = createRateLimiter({
       prefix: DEMO_DAILY_PREFIX,
       windowMs: ONE_DAY_MS,
       max: Number(DEMO_DAILY_CAP),
       keyResolver: () => "all",
   });

   // Published result pages (Phase 22): cached reads, so only scraping loops need stopping.
   export const publicReadLimiter = createRateLimiter({
       prefix: PUBLIC_READ_PREFIX,
       windowMs: FIVE_MINUTES_MS,
       max: 300,
       keyResolver: ipKeyResolver,
   });
   ```
   Check the option names against `types/rateLimiter.types.ts` (`RateLimiterOptions`,
   `DualRateLimiterOptions`): the COPY file is the authority, and `createDualRateLimiter`'s resolver
   option names must match it exactly. Route order (Phase 23): `demoDailyCapLimiter`,
   `demoDualLimiter`, then the handler.
5. `types/express.d.ts`: replace Phase 04's `// Phase 06: visitorId.` with `visitorId?: string;`
   (optional: requests before `visitorIdMiddleware`, and every job, have none). Keep any
   `// Phase 10:` part of the comment.
6. `routes/auth.route.ts`: replace each `// Phase 06:` placeholder with PaperTrail's limiter chain,
   route for route (`@pt-api/src/routes/auth.route.ts`):
   - register: `registerSourceLimiter, registerLimiter`;
   - login: `loginSourceLimiter, loginAccountLimiter, loginLimiter` (source, account, pair);
   - refresh: `refreshTokenSourceLimiter, refreshTokenLimiter`;
   - verify: `verifyEmailLimiter`; resend: `resendVerificationSourceLimiter, resendVerificationAccountLimiter`;
   - forgot: `forgotPasswordSourceLimiter, forgotPasswordAccountLimiter, forgotPasswordLimiter`;
   - reset: `resetPasswordLimiter`; Google: `loginSourceLimiter`;
   - `/me` and friends: `authenticate, protectedApiLimiter`.

   Then `diff` against PaperTrail's file. Only routes this project changed in Phases 04–05 may differ.
7. `app.ts` (as `@pt-api/src/app.ts`):
   ```ts
   app.set("trust proxy", trustProxy);          // before anything reads req.ip
   // … requestId, helmet, cors, cookieParser, json …
   app.use(visitorIdMiddleware);
   app.use(globalLimiter);
   // PaperTrail's /debug-ip block, verbatim (resolvedIp, expressReqIp, tcpPeer, peerIsTrustedProxy,
   // visitorId, the proxy headers), declared before the routers and only when DEBUG_IP_ENDPOINT=true.
   ```
   `globalLimiter` goes after `cookieParser` (it reads the cookie) and before every router. Add
   `"X-Lab-Visitor"` to the CORS `allowedHeaders` now, so Phase 23 doesn't hit a preflight failure.
   Phase 10 adds `X-Org-Id`, Phase 23 `X-Provider-Key`.
8. `index.ts`: copy PaperTrail's production warning for an empty `TRUSTED_PROXY_CIDRS` (the
   `NODE_ENV === "production" && !TRUSTED_PROXY_CIDRS.trim()` block). Behind Render's proxy, an empty
   list means every request seems to come from the proxy, and every IP bucket becomes one global bucket.
   Use `/debug-ip` once after the first deploy (Phase 29) to set the list, then turn it off.

## 7. Verify

```bash
docker compose up -d redis && pnpm --filter api dev
curl -si -X POST localhost:5000/auth/login -H 'content-type: application/json' \
  -d '{"email":"a@b.co","password":"wrong-password-1"}' | grep -i x-ratelimit
# X-RateLimit-Limit: 10
# X-RateLimit-Remaining: 9

for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:5000/auth/login \
  -H 'content-type: application/json' -d '{"email":"a@b.co","password":"wrong-password-1"}'; done; echo
# 401 401 401 401 401 401 401 401 401 401 429     (the 11th: locked out)

DEBUG_IP_ENDPOINT=true pnpm --filter api dev     # restart with the flag, then:
curl -s localhost:5000/debug-ip
# {"status":"success","data":{"resolvedIp":"::1","expressReqIp":"::1","tcpPeer":"::1","peerIsTrustedProxy":false,"visitorId":"…",…}}

# Circuit breaker: stop Redis, the API keeps answering (memory fallback).
docker stop promptlab-redis
curl -s -o /dev/null -w "%{http_code}\n" localhost:5000/health     # 200
docker start promptlab-redis      # if /health still reports the limiter store degraded, restart the API (see memory.md: dead socket behind Docker Desktop's proxy)

# The demo limiters, before their route exists: mount them on a throwaway route in a scratch script.
pnpm --filter api exec tsx -e '
import express from "express"; import { demoDualLimiter } from "./src/config/rateLimiter";
const app = express(); app.set("trust proxy", true);
app.post("/t", demoDualLimiter, (_q, r) => { r.sendStatus(204); });
const s = app.listen(5999, async () => {
  const codes = []; for (let i = 0; i < 7; i++) codes.push((await fetch("http://localhost:5999/t",
    { method: "POST", headers: { "x-lab-visitor": "visitor-abcdefghijkl" } })).status);
  console.log(codes.join(" ")); s.close(); process.exit(0); });'
# 204 204 204 204 204 429 429      (visitor bucket: 5 / hour)
docker exec promptlab-redis redis-cli --scan --pattern 'rl:demo:*'
# rl:demo:visitor:h:visitor-abcdefghijkl  rl:demo:ip:…     (both buckets charged for the first 5 only)

pnpm --filter api typecheck && pnpm --filter api lint
```

Clear the scratch keys afterwards: `docker exec promptlab-redis redis-cli --scan --pattern 'rl:demo:*' | xargs -r docker exec -i promptlab-redis redis-cli del`.

## 8. Definition of done

- [ ] Every COPY file is identical to `@pt-api` (`diff -q` prints nothing).
- [ ] `auth.route.ts` has PaperTrail's limiter chains; no `// Phase 06:` comments remain.
- [ ] `globalLimiter` and `visitorIdMiddleware` are mounted; `trust proxy` uses `trustProxy`.
- [ ] `runCreateLimiter`, `demoDualLimiter`, `demoDailyCapLimiter`, `publicReadLimiter` exist and
      compile; the demo dual bucket answers 429 on the 6th call from one visitor.
- [ ] CORS allows `X-Lab-Visitor`.
- [ ] With Redis stopped, the API still serves requests.
- [ ] `.env.example` lists every new variable.
- [ ] Commit: `feat(api): rate limiting with run, demo and public-page limiters`.

## 9. Interview angle

*"Your public demo calls LLMs. How do you stop abuse?"* First, it never uses my key: the visitor
brings their own, so nobody can run up my bill. Then two limits: a dual bucket per visitor and per IP
(five and twenty an hour), and a global daily cap, so even a botnet gets a known number of tiny runs.
They're plain windows, not lockouts, because one student's script shouldn't lock out the whole
campus behind the same IP.

*"Why is the limit check a Lua script?"* Because "read, compare, increment" from Node is three round
trips, and two requests can both see 9 under a limit of 10. Lua runs atomically inside Redis. The dual
bucket checks both buckets in one script and charges both or neither.

*"What happens when Redis goes down?"* A circuit breaker flips the store to an in-memory one with the
same rules for 30 seconds, then probes. Limits become per process, looser but never off, and Redis
trouble never turns into an outage.
