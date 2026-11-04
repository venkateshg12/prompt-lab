# Phase 01 — API bootstrap: env, errors, envelope, createApp, health, shutdown

## 1. Goal

Copy PaperTrail's API foundation:
- the env loader that fails at boot;
- the `AppError` / `appAssert` / `catchError` trio;
- the `ok()` / `fail()` envelope (with Zod errors inside it);
- `createApp()` in `app.ts`, separate from `index.ts` (connect / listen / shutdown);
- 404 handling, `/health`, and ordered graceful shutdown.

No feature routes yet. The deep explanation of every file is in PaperTrail's Phase 01 doc
(`~/Code/paper-trail/docs/phases/phase-01-api-bootstrap.md`), which itself traces back to e-commerce.

## 2. What I will understand after this phase

1. Why env is validated at import time.
2. How `appAssert(...)` narrows types and keeps services readable.
3. Why the error handler is mounted last with four arguments.
4. Why `createApp()` has no side effects (Supertest in Phase 26).
5. The shutdown order: server → workers → cache → database.

## 3. Prerequisites

Phase 00 done; `cp apps/api/.env.example apps/api/.env`.

## 4. Files

```
apps/api/src/
├── index.ts                     ADAPT  @pt-api/src/index.ts       (remove instrument, relay, schedulers, call recorder — re-added later as noted)
├── app.ts                       ADAPT  @pt-api/src/app.ts         (only requestId-free core for now: helmet, cors, json, cookies, /health, notFound, errorHandler)
├── constants/env.ts             ADAPT  @pt-api/src/constants/env.ts  (NODE_ENV, PORT, CORS_ORIGIN, CLIENT_URL; the getEnv helper unchanged)
├── constants/https.ts           COPY   @pt-api/src/constants/https.ts
├── constants/appErrorCode.ts    ADAPT  @pt-api/src/constants/appErrorCode.ts  (keep auth + Gmail codes; drop document/upload ones)
├── utils/errors/*               COPY   @pt-api/src/utils/errors/
├── utils/api/*                  COPY   @pt-api/src/utils/api/
└── middleware/
    ├── errorHandler.ts          COPY   @pt-api/src/middleware/errorHandler.ts
    └── notFound.ts              COPY   @pt-api/src/middleware/notFound.ts
```

```bash
pnpm --filter api add express helmet cors cookie-parser dotenv zod
pnpm --filter api add -D @types/express @types/cors @types/cookie-parser
```

Use the same versions as `@pt-api/package.json` (they're already in your copied `package.json` if you
kept the list in Phase 00).

## 5. Concepts

- **Fail at boot**: a missing `CORS_ORIGIN` stops `pnpm dev`, not a user's first request three days
  later.
- **The envelope**: every JSON response is `{ status, data, meta?, errors? }`. The web's axios
  interceptor (Phase 09) depends on `errors[0].message` / `code`.
- **Zod errors inside the envelope** (`path`, `message`, `code: "VALIDATION_ERROR"`): PaperTrail's
  fix of e-commerce's one off-envelope response, inherited for free.
- **`createApp()` vs `index.ts`**: the factory registers middleware and routes; `index.ts` connects,
  listens and owns signals. Tests import the factory.

## 6. Steps

```bash
cd ~/Code/prompt-lab/apps/api/src; PT=~/Code/paper-trail/apps/api/src
mkdir -p constants utils/errors utils/api middleware
cp $PT/constants/https.ts constants/
cp $PT/utils/errors/* utils/errors/
cp $PT/utils/api/* utils/api/
cp $PT/middleware/{errorHandler,notFound}.ts middleware/
```

> If `errorHandler.ts` imports `clearAuthCookies` / `REFRESH_PATH` from `../utils/auth`, or the
> logger, which arrive in Phases 02/04: comment those lines with `// Phase 04` and restore them then,
> exactly as PaperTrail's guide did.

`constants/env.ts`: copy PaperTrail's file, then **delete** every export that isn't `NODE_ENV`, `PORT`,
`CORS_ORIGIN` or `CLIENT_URL`, along with the JWT entropy checks. Each later phase restores its block
from PaperTrail's file verbatim. Keep the `getEnv` helper byte-for-byte.

`app.ts`: from PaperTrail's `createApp`, keep helmet, cors, `express.json({ limit: "1mb" })`,
`cookieParser`, a `/health` returning `ok({ status: "ok" })`, `notFound` and `errorHandler`. Leave
comment markers where later phases mount things:

```ts
// Phase 02: app.use(requestId)              Phase 06: trust proxy, visitorId, globalLimiter
// Phase 03/07: /health reports mongo/redis   Phase 04+: routers
```

`index.ts`: PaperTrail's `main()` with `connectDB`, schedulers, the relay and the call recorder
removed (commented with their phase numbers). Keep the shutdown function and the
`unhandledRejection` / `uncaughtException` handlers verbatim.

## 7. Verify

```bash
pnpm --filter api dev
curl -s localhost:5000/health                      # {"status":"success","data":{"status":"ok"}}
curl -s localhost:5000/nope                        # 404 envelope "Route not Found: GET /nope"
CORS_ORIGIN= pnpm --filter api exec tsx src/index.ts   # "Missing Environment varaible CORS_ORIGIN"
# Ctrl-C → "[shutdown] SIGINT — closing" … "complete"
cd apps/api/src; PT=~/Code/paper-trail/apps/api/src
for f in constants/https.ts utils/errors/appError.ts utils/errors/appAssert.ts utils/errors/catchError.ts utils/api/apiEnvelope.ts middleware/notFound.ts; do diff -q $PT/$f $f; done
```

Add a throwaway `POST /_probe` with a Zod body (as in PaperTrail's Phase 01) to see a validation
error in the envelope, then delete it.

## 8. Definition of done

- [ ] Health, 404 and validation responses all use the envelope.
- [ ] A missing env var stops boot; Ctrl-C shuts down in order.
- [ ] COPY files diff-identical.
- [ ] Commit: `feat(api): bootstrap from PaperTrail`.

## 9. Interview angle

*"How is your API structured?"* route → controller → service → model. Typed errors from `appAssert`,
one error handler, one envelope, and an app factory with no side effects so it can be tested. The same
foundation runs my other two projects, so it's been exercised far beyond this one.
