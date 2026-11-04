# Phase 01 — API bootstrap: env, errors, envelope, `createApp`, health, shutdown

## 1. Goal

Turn the `apps/api` placeholder into a real Express 5 server with PaperTrail's foundation, before any
feature exists:
- environment validation **at import time**, so a missing secret stops the deploy;
- the error trio `AppError` / `appAssert` / `catchError`;
- the `ok()` / `fail()` envelope, used by every response, Zod errors included;
- `notFound` and one `errorHandler`, mounted last;
- three files:
  - `app.ts` with `createApp()`, which has no side effects;
  - `index.ts`, which only listens and shuts down;
  - `worker.ts`, the second entry point (empty for now);
- `GET /health`;
- an ordered graceful shutdown with a force-exit timer.

## 2. What I will understand after this phase

1. Why env is read when the module loads, not where a value is used.
2. How `appAssert`'s `asserts condition` signature narrows types after the call.
3. Why `catchError` still earns its place in Express 5, which forwards rejected promises itself.
4. Why the error handler takes four parameters and is mounted last.
5. Why `app.ts`, `index.ts` and `worker.ts` are three files, and why that matters more here than
   in most apps: a benchmark run is hundreds of slow model calls, and none of them should share a
   process with HTTP in production.
6. Why shutdown goes server → workers → pub/sub → cache → database, with a timer.

## 3. Prerequisites

- Phase 00 done (`pnpm build` green, containers healthy).
- Read `@pt-api/src/{app,index,worker}.ts` once end to end. You copy their *shape* now and their
  *contents* phase by phase.

## 4. Files

```
apps/api/
├── .env.example                         ADAPT  @pt-api/.env.example          (only the vars below)
├── package.json                         ADAPT  (+ express, helmet, cors, cookie-parser, dotenv; worker scripts)
└── src/
    ├── index.ts                         ADAPT  @pt-api/src/index.ts          (listen + shutdown; no DB/cache/workers yet)
    ├── app.ts                           ADAPT  @pt-api/src/app.ts            (helmet, cors, json, cookies, /health, 404, errors)
    ├── worker.ts                        NEW    (entry point; closeWorkers() is a no-op until Phase 08)
    ├── constants/
    │   ├── env.ts                       ADAPT  @pt-api/src/constants/env.ts  (getEnv + NODE_ENV, PORT, CORS_ORIGIN, CLIENT_URL, RUN_WORKERS_IN_API)
    │   ├── https.ts                     COPY   @pt-api/src/constants/https.ts
    │   └── appErrorCode.ts              ADAPT  @pt-api/src/constants/appErrorCode.ts (drop upload/file codes)
    ├── utils/
    │   ├── errors/{appError,appAssert,catchError,index}.ts   COPY  @pt-api/src/utils/errors/
    │   └── api/{apiEnvelope,index}.ts                         COPY  @pt-api/src/utils/api/
    └── middleware/
        ├── notFound.ts                  COPY   @pt-api/src/middleware/notFound.ts
        └── errorHandler.ts              ADAPT  @pt-api/src/middleware/errorHandler.ts (no Sentry until Phase 29; no cookie clearing until Phase 04)
```

Dependencies (PaperTrail's versions, so COPY files compile identically):

```bash
pnpm --filter api add express@^5.2.1 helmet@^8.3.0 cors@^2.8.6 cookie-parser@^1.4.7 dotenv@^17.4.2
pnpm --filter api add -D @types/express@^5.0.6 @types/cors@^2.8.19 @types/cookie-parser@^1.4.10
```

`morgan` isn't added: Phase 02's request logger replaces it.

## 5. Concepts

**Fail at boot.** `env.ts` calls `getEnv(key, default?)` for every variable at import time and throws
when one is missing and has no default. The alternative is reading `process.env.X` where it's used.
Then a missing `NVIDIA_API_KEY` is discovered 40 minutes into a benchmark, when the first cell for
that provider runs. Each later phase adds its own variables here and to `.env.example`, never earlier:
the server boots with exactly the config the current phase needs.

`CLIENT_URL` defaults to the first `CORS_ORIGIN` entry. It's used for links inside emails (verify,
reset, invite, "your run finished"). PaperTrail added it after a comma-joined origin list ended up
inside an email link.

**The error trio.**
- `AppError(status, message, errorCode?)` is an `Error` with an HTTP status and a machine code.
- `appAssert(cond, status, message, code?)` is typed `asserts condition`. After
  `appAssert(run, NOT_FOUND, "Run not found")`, TypeScript knows `run` isn't null, so services read
  as a list of rules.
- `catchError(handler)`: Express 5 already forwards rejected promises, so this is belt-and-braces. It
  stays because every copied controller uses it, and it makes "errors go to the handler" explicit.

**The envelope.** Every JSON response is `{ status: "success" | "error", data, meta?, errors? }`.
PaperTrail fixed e-commerce's one exception: Zod failures are inside the envelope, with a `path` per
error. That matters here: a broken field rule in the task editor (Phase 11) shows its error next to
the rule that broke.

**Why three entry points.**
- `app.ts` exports `createApp()`, which builds the Express app with **no side effects**: no `listen`,
  no DB connection. Supertest imports it directly (Phase 28).
- `index.ts` connects, listens and shuts down. With `RUN_WORKERS_IN_API !== "false"` it also starts
  the workers in-process: one process in dev and on a free tier.
- `worker.ts` runs only the queue workers (`pnpm --filter api worker`). In production a run of 3,000
  cells calls models for many minutes, and those calls must never compete with HTTP requests for the
  event loop.

**Ordered shutdown.** A deploy sends `SIGTERM`, and the process closes things in this order:
1. Stop accepting connections and let in-flight requests finish.
2. Close the workers. Each finishes its current cell; BullMQ re-delivers anything unfinished, and the
   deterministic job id (Phase 17) keeps that safe.
3. Close pub/sub, then the cache.
4. Close the database last, because everything before it may still write.

A 10-second timer force-exits if a keep-alive client holds the server open. `unhandledRejection` and
`uncaughtException` go down the same path, logged.

## 6. Steps

1. **env.ts.** Copy PaperTrail's `getEnv` verbatim (including its message), then add only:
   ```ts
   export const NODE_ENV = getEnv("NODE_ENV");
   export const PORT = getEnv("PORT");
   export const CORS_ORIGIN = getEnv("CORS_ORIGIN");
   // Single origin for links inside emails; CORS_ORIGIN may list several.
   export const CLIENT_URL = getEnv("CLIENT_URL", CORS_ORIGIN.split(",")[0].trim());
   // "false" in production, where src/worker.ts runs as its own process.
   export const RUN_WORKERS_IN_API = getEnv("RUN_WORKERS_IN_API", "true");
   ```
   `.env.example`:
   ```
   NODE_ENV=development
   PORT=5000
   # The web app origin(s), comma-separated.
   CORS_ORIGIN=http://localhost:3000
   CLIENT_URL=http://localhost:3000
   RUN_WORKERS_IN_API=true
   ```

2. **Copy** `constants/https.ts`, `utils/errors/*`, `utils/api/*` and `middleware/notFound.ts`. Run
   `diff -q` against each source.

3. **appErrorCode.ts.** Keep these codes:
   - `InvalidAccessToken`, `Forbidden`, `TokenExpired`, `ValidationError`, `TooManyRequests`, `QuotaExceeded`;
   - `GmailNotConfigured`, `GmailAuthInvalid`, `GmailSendFailed`.

   Drop `UploadTooLarge` and `UnsupportedFileType`. Later phases append their own codes:
   `PromptFrozen` (13), `ProviderNotConfigured` (14), `ModelInactive`, `ModelUnprobed`,
   `OwnerRunsAdminOnly`, `RunNotCancellable`, `TestReused`, `BudgetExceeded` (17), `DemoKeyMissing`,
   `DemoKeyInvalid`, `DemoDailyCap` (23). Each is `PascalName = "UPPER_SNAKE"`, as in PaperTrail
   (`BudgetExceeded = "BUDGET_EXCEEDED"`).

4. **errorHandler.ts.** Copy it, then make these changes:
   - Remove the two Sentry lines (Phase 29 adds them back).
   - Remove the refresh-path cookie clearing. Phase 04 adds `clearAuthCookies`, and then this line
     comes back.
   - Keep the Zod branch exactly.
   - Until Phase 02, replace `logger.error` with `console.error`, marked `// Phase 02: logger`.

   Then add one branch after the Zod one. It's the only ADAPT beyond removals. Test-set imports and
   the public demo receive bodies you didn't write, and a malformed one must be a 400, not a 500:
   ```ts
   // express.json() rejects a malformed body with a SyntaxError typed "entity.parse.failed".
   if ((error as { type?: string })?.type === "entity.parse.failed") {
       return res.status(BAD_REQUEST).json(fail("Malformed JSON body", appErrorCode.ValidationError));
   }
   if ((error as { type?: string })?.type === "entity.too.large") {
       return res.status(413).json(fail("Request body too large", appErrorCode.ValidationError));
   }
   ```

5. **app.ts.**
   ```ts
   import express from "express";
   import helmet from "helmet";
   import cors from "cors";
   import cookieParser from "cookie-parser";
   import { CORS_ORIGIN, NODE_ENV } from "./constants/env";
   import { ok } from "./utils/api";
   import { notFound } from "./middleware/notFound";
   import { errorHandler } from "./middleware/errorHandler";

   /*
     Builds the Express app with no side effects: no listen, no DB connection. index.ts runs it;
     the integration tests (Phase 28) call it directly with Supertest.
    */
   export const createApp = () => {
       const app = express();

       // Phase 02: requestId first. Phase 06: trust proxy + limiters.
       app.use(
           helmet({
               crossOriginResourcePolicy: { policy: "cross-origin" },
               hsts: NODE_ENV === "production" ? undefined : false,
           })
       );

       const corsOrigin = CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
       app.use(cors({ origin: corsOrigin, credentials: true }));

       // 256 kB covers every JSON request this API takes. The test-set import route (Phase 12)
       // mounts its own larger parser for JSONL/CSV files, so only that route accepts big bodies.
       app.use(express.json({ limit: "256kb" }));
       app.use(cookieParser());

       // Health first, so routers that call router.use(authenticate) can never shadow it.
       app.get("/health", (_req, res) => {
           // Phase 03: database. Phases 06–07: redis, cache.
           res.status(200).json(ok({ status: "ok" }));
       });

       // Routes are registered here, phase by phase.

       app.use(notFound);
       app.use(errorHandler);
       return app;
   };
   ```

6. **worker.ts.**
   ```ts
   import "dotenv/config";

   /*
     The queue workers' entry point. Phase 08 adds the email and maintenance workers, Phase 17 the
     run-cell and run-finalize workers. index.ts imports initSchedulers/closeWorkers when it runs
     them in-process (RUN_WORKERS_IN_API=true).
    */
   export const initSchedulers = async () => {};
   export const closeWorkers = async () => {};

   if (require.main === module) {
       console.log("worker started (no workers until Phase 08)"); // Phase 02: logger
   }
   ```
   There's no `startRelay()` as in the Enquiry Assistant: Prompt Lab has no outbox
   ([inherited-architecture.md](../reference/inherited-architecture.md), "not copied").

7. **index.ts.** Adapt PaperTrail's. Keep:
   - `main()`;
   - the `RUN_WORKERS_IN_API` branch, calling the no-op `initSchedulers()`;
   - `app.listen(PORT, "0.0.0.0")`;
   - the whole shutdown block, with `SHUTDOWN_GRACE_MS = 10_000`.

   Remove `instrument`, `connectDB`/`disconnectDB`, `cache`, `closePubSub`, the outbox relay and
   `flushObservability`. Leave a comment where each one returns:
   ```ts
   // Phase 03: await connectDB() / disconnectDB()
   // Phase 07: await cache.close()
   // Phase 17: await closePubSub()
   // Phase 29: import "./instrument" first; await flushObservability()
   ```
   The worker import must stay **dynamic** (`await import("./worker")` inside the
   `RUN_WORKERS_IN_API` branch). A static `import "./worker"` would start the workers even with
   `RUN_WORKERS_IN_API=false` (found while reconciling the Enquiry plan).

8. **Scripts.** In `apps/api/package.json` add `"worker": "tsx watch src/worker.ts"` and
   `"start:worker": "node dist/worker.js"`.

9. `cp apps/api/.env.example apps/api/.env`, run it, verify, and commit
   `feat(api): bootstrap (env, errors, envelope, createApp, health, shutdown)`.

## 7. Verify

```bash
pnpm --filter api dev
# Server is listening to the port: 5000

curl -s localhost:5000/health
# {"status":"success","data":{"status":"ok"}}

curl -s localhost:5000/nope
# {"status":"error","data":null,"errors":[{"message":"Route not Found: GET /nope"}]}

curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:5000/health -H 'content-type: application/json' -d '{bad'
# 400
curl -s -X POST localhost:5000/health -H 'content-type: application/json' -d '{bad'
# {"status":"error","data":null,"errors":[{"message":"Malformed JSON body","code":"VALIDATION_ERROR"}]}

head -c 300000 /dev/zero | tr '\0' 'a' | sed 's/^/{"x":"/; s/$/"}/' > /tmp/big.json
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:5000/health -H 'content-type: application/json' --data @/tmp/big.json
# 413

curl -sI localhost:5000/health | grep -i -E "x-content-type-options|x-frame-options"
# X-Content-Type-Options: nosniff
# X-Frame-Options: SAMEORIGIN

# Fail at boot:
CORS_ORIGIN= pnpm --filter api exec tsx src/index.ts
# Error: Missing Environment varaible CORS_ORIGIN

# Ordered shutdown (Ctrl-C in the dev terminal):
# [shutdown] SIGINT — closing
# [shutdown] complete

for f in constants/https.ts utils/errors/appError.ts utils/errors/appAssert.ts utils/errors/catchError.ts \
         utils/api/apiEnvelope.ts middleware/notFound.ts; do
  diff -q ~/Code/paper-trail/apps/api/src/$f apps/api/src/$f; done
# (no output)
```

## 8. Definition of done

- [ ] `/health` answers in the envelope; unknown routes return 404 in the envelope.
- [ ] Malformed JSON is a 400 and an oversized body a 413, both in the envelope.
- [ ] Removing a required env var stops the server at startup with a clear message.
- [ ] `createApp()` has no side effects (importing `app.ts` doesn't listen or connect).
- [ ] `worker.ts` runs on its own (`pnpm --filter api worker`) and exits cleanly; the API imports it
      dynamically.
- [ ] Ctrl-C prints the shutdown lines; a hung request is cut off after 10 s.
- [ ] Every COPY file is identical to its PaperTrail source, and every removed line has a
      `// Phase NN:` comment.
- [ ] `pnpm typecheck && pnpm lint` green. Committed; `tracker.md` updated.

## 9. Interview angle

*"Walk me through how an error becomes a response."*
1. A service calls `appAssert(prompt.frozenAt === null, CONFLICT, "Prompt is frozen", PromptFrozen)`,
   which throws an `AppError` carrying a status and a code.
2. The controller is wrapped in `catchError`, which forwards the error to `next`.
3. The single error handler at the end of the chain maps it:
   - `ZodError` → 400 with field paths;
   - `AppError` → its own status and code;
   - anything else → a 500 that's logged but never leaks a stack trace.

Every response, validation failures included, has the same envelope, so the web app has one error
path.

*"Why does a benchmarking tool need a separate worker process?"* A run is thousands of model calls,
each taking seconds. In one process, every slow call competes with HTTP requests for the same event
loop, and the results page stutters while a run is going. `createApp()` is side-effect free for tests,
`index.ts` is process lifecycle, and `worker.ts` is the process that talks to models. In dev they
share one process for convenience. In production they're separate.
