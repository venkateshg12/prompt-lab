# Phase 08 — BullMQ, DLQ and system email on the Gmail API

## 1. Goal

Copy PaperTrail's queue foundation and its system email sender:
- one ioredis connection for BullMQ on the `noeviction` instance;
- the queue / producer / worker / processor split, with deterministic job ids;
- the email queue sending verification and password-reset mail through the **Gmail API**;
- an in-memory **dev mailbox**, so sign-up works before Gmail is authorized;
- a **dead-letter queue** and the generic `onFinalFailure` hook, so a job that used all its attempts is
  kept with everything needed to replay it;
- a **maintenance** queue with `purge-expired` (hourly), registered with `upsertJobScheduler`;
- Bull Board behind Basic auth, off unless switched on;
- `worker.ts`, imported by the API in dev (`RUN_WORKERS_IN_API=true`) and run on its own in
  production.

Then resolve Phases 04–05's `// Phase 08:` comments: registration, resend-verification and
forgot-password enqueue their emails instead of logging the link.

Two email kinds come later, each in the phase that owns its data: workspace invites (Phase 10) and
"your run finished" (Phase 17). The DLQ **endpoints** (list, replay, discard) come in Phase 17 with the
run cells, the only jobs worth replaying by hand.

## 2. What I will understand after this phase

1. Queue, producer, worker, processor: what each owns and why they're separate files.
2. Deterministic job ids, and why a token never appears in one.
3. Retryable vs `UnrecoverableError`: which Gmail failures deserve five attempts and which deserve one.
4. Why job payloads carry ids, never content (prompts, outputs, postings).
5. Why PostgreSQL needs a purge job, and why reads never depend on it having run.
6. How one `worker.ts` serves both "inside the API" and "its own process".
7. Why custom BullMQ job ids never contain `:`.

## 3. Prerequisites

- Phase 07 done.
- The Gmail sender setup in `~/Code/e-commerce/docs/gmail-api-email-sender.md`. Reuse the existing
  Google Cloud project and OAuth client: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
  `GMAIL_REDIRECT_URI`, and after the one-time authorization below, `GMAIL_REFRESH_TOKEN`.

## 4. Files

```
apps/api/src/
├── constants/
│   ├── queue.ts                          ADAPT  @pt-api/src/constants/queue.ts      (EMAIL, DEAD_LETTER, MAINTENANCE only)
│   └── env.ts                            ADAPT  (+ GMAIL_*, ENABLE_QUEUE_DASHBOARD, QUEUE_DASHBOARD_*, RUN_WORKERS_IN_API, WORKER_PORT)
├── config/gmail.ts                       COPY   @pt-api/src/config/gmail.ts
├── services/gmail.service.ts             COPY   @pt-api/src/services/gmail.service.ts
├── controllers/gmailAuth.controller.ts   COPY   @pt-api/src/controllers/gmailAuth.controller.ts
├── routes/gmail.route.ts                 COPY   @pt-api/src/routes/gmail.route.ts  (mounted at /api/auth/gmail, as PaperTrail)
├── utils/email/
│   ├── emailTemplates.ts                 ADAPT  @pt-api/src/utils/email/emailTemplates.ts  (verify + reset only; product name)
│   ├── html_templates.ts                 ADAPT  @pt-api/src/utils/email/html_templates.ts  (product name)
│   ├── devMailbox.ts                     COPY   @pt-api/src/utils/email/devMailbox.ts
│   └── index.ts                          COPY   @pt-api/src/utils/email/index.ts
├── jobs/
│   ├── redis/connection.ts               COPY   @pt-api/src/jobs/redis/connection.ts
│   ├── interfaces/jobPayload.ts          ADAPT  @pt-api/src/jobs/interfaces/jobPayload.ts   (VerifyEmail + PasswordReset only)
│   ├── queues/email.queue.ts             COPY   @pt-api/src/jobs/queues/email.queue.ts
│   ├── queues/deadLetter.queue.ts        COPY   @pt-api/src/jobs/queues/deadLetter.queue.ts
│   ├── queues/maintenance.queue.ts       COPY   @pt-api/src/jobs/queues/maintenance.queue.ts
│   ├── producers/email.producer.ts       ADAPT  @pt-api/src/jobs/producers/email.producer.ts  (hashed job ids)
│   ├── processors/email.processor.ts     ADAPT  @pt-api/src/jobs/processors/email.processor.ts (verify + reset)
│   ├── processors/purgeExpired.processor.ts  ADAPT  @pt-api/src/jobs/processors/purgeExpired.processor.ts (sessions + links)
│   ├── workers/email.worker.ts           ADAPT  @pt-api/src/jobs/workers/email.worker.ts
│   ├── workers/maintenance.worker.ts     ADAPT  @pt-api/src/jobs/workers/maintenance.worker.ts (PURGE_EXPIRED only)
│   ├── deadLetter.ts                     ADAPT  @pt-api/src/jobs/deadLetter.ts      (generic half: copy to the DLQ; no document logic)
│   └── dashboard/bull-board.ts           ADAPT  @pt-api/src/jobs/dashboard/bull-board.ts  (this project's queues)
├── services/auth.service.ts              ADAPT  resolve the Phase 04/05 `// Phase 08:` comments
├── routes/auth.route.ts                  ADAPT  + GET /auth/dev/latest-link (non-production only, as PaperTrail)
├── worker.ts                             ADAPT  @pt-api/src/worker.ts  (email + maintenance; initSchedulers; health server)
├── index.ts                              ADAPT  dynamic import of ./worker unless RUN_WORKERS_IN_API=false; close on shutdown
└── app.ts                                ADAPT  Bull Board at /admin/queues behind Basic auth (as @pt-api/src/app.ts)
apps/api/package.json                     ADAPT  + "worker": "tsx watch src/worker.ts", "start:worker": "node dist/worker.js"
```

```bash
pnpm --filter api add bullmq@^5.80.9 googleapis@^184 @bull-board/api@^8.1.2 @bull-board/express@^8.1.2
```

`googleapis` stays on PaperTrail's `^184` so the COPY files compile unchanged (npm's current major is
189). Upgrade later on purpose, against the sender's tests.

## 5. Concepts

**Four files per job type.**
- The **queue** declares a name and default options (attempts, backoff, retention of finished jobs).
- The **producer** is the only thing services call. It knows job names and ids.
- The **worker** pulls jobs and routes by `job.name`, with concurrency and a rate limit (2 emails/s,
  inside Gmail's sending limits).
- The **processor** does the work and decides whether a failure is worth retrying.

A service never imports BullMQ, so a test can swap the producer for a spy.

**Deterministic job ids.** `jobId: reset-<userId>-<sha256(token) prefix>`. BullMQ ignores an `add`
whose id already exists, so a double-clicked "send reset link" queues one email. PaperTrail keys on
the raw token; here the id uses a **hash** of the token, because job ids are visible in Bull Board and
in Redis key names. The payload still has to carry the raw token (the processor builds the link), which
is exactly why the dashboard is guarded.

**No `:` in custom ids.** BullMQ builds its own Redis keys with `:` and rejects most custom ids that
contain one (the Playbook build hit this with `<broadcastId>:<subscriberId>`). Every id in this project
joins its parts with `-`: `reset-…`, `verify-…`, `invite-<inviteId>` (Phase 10),
`cell-<runId>-<16-hex hash>` and `finalize-<runId>` (Phase 17), `dead-<id>`.

**Retry or give up.** The processor rethrows what a later attempt can fix: Gmail 429 or 5xx, network
errors. BullMQ backs off exponentially (3 s, 6 s, 12 s, …, 5 attempts). It throws `UnrecoverableError`
for what needs a human: `invalid_grant` (the refresh token was revoked or expired), Gmail not
configured, a malformed payload, a rejected address. A bad token fails one job once, instead of five
times for every queued email.

**Idempotent processors.** A retry can run after a first attempt that succeeded but didn't report
back. The verify processor re-reads the user and skips if already verified; the reset processor skips
if the user is gone. Gmail has no idempotency key, so "skip if done" is the guard.

**The dead-letter queue.** Only the **last** attempt counts. `onFinalFailure(job, err)` runs from every
worker's `failed` event and returns early unless `attemptsMade >= attempts` or the error is
unrecoverable. Then it copies `{queue, name, jobId, data, failedReason, failedAt}` into
`dead-letter-queue` with `jobId: dead-<id>`, never removed automatically. PaperTrail's version also
marks a document failed and emits an outbox event. Here the business step belongs to the runner
(Phase 17: a dead cell becomes a `Result` with `status: "error"` so the run can still finish). So this
phase copies the generic half and leaves a `// Phase 17:` hook.

**Payloads carry ids, never content.** Job data sits in Redis and shows in Bull Board. Auth emails
carry a user id, an address and a token, which is unavoidable. No later job carries a prompt, a posting
or a model output: run-cell jobs carry `runId`, `variantId`, `exampleId`, `repeat` and read the rest
from Postgres (architecture.md §5). Postings may be third-party text; they stay in the database.

**Purge.** PostgreSQL has no TTL indexes. `purge-expired` runs hourly at :15 and deletes expired
`sessions` and `verification_links` inside `runAsSystem()`. Phase 10 adds expired invites. Correctness
never depends on it: every read of these rows already filters on `expiresAt`. The purge only keeps the
tables small.

**Schedulers.** `queue.upsertJobScheduler(id, repeat, template)` is idempotent: the API and the
standalone worker can both call it on boot without creating duplicates. It replaces the older `repeat`
option on `add`.

**One worker module, two ways to run it.** `index.ts` loads `./worker` with a **dynamic** import and
calls `initSchedulers()` unless `RUN_WORKERS_IN_API=false`, so `pnpm dev` is one process. In production
the API sets it to `false` and `pnpm start:worker` runs `worker.ts` directly; only then
(`require.main === module`) does it connect the database, start a small health server on
`WORKER_PORT`, and own the signal handlers. The import must be dynamic: workers start when the module
loads, so a static `import "./worker"` would start them even with the flag off (found building the
Playbook, 2 Nov 2026).

**Bull Board.** Payloads include reset and verification tokens. The dashboard mounts only when
`ENABLE_QUEUE_DASHBOARD=true`, boot fails if it's on without `QUEUE_DASHBOARD_USER`/`PASSWORD`, and it
sits behind Basic auth compared with a timing-safe digest. It's mounted **before** `globalLimiter` and
the JSON parser, as in PaperTrail.

## 6. Steps

1. **Constants.** `constants/queue.ts`:
   ```ts
   export const QUEUE_NAMES = {
       EMAIL: 'email-queue',
       DEAD_LETTER: 'dead-letter-queue',
       MAINTENANCE: 'maintenance-queue',
       // Phase 17: RUN_CELL: 'run-cell-queue', RUN_FINALIZE: 'run-finalize-queue'
   } as const;

   export const JOB_NAMES = {
       EMAIL: {
           VERIFY_EMAIL: 'send_verify_email',
           PASSWORD_RESET: 'send_password_reset',
           // Phase 10: ORG_INVITE · Phase 17: RUN_FINISHED
       },
       MAINTENANCE: {
           PURGE_EXPIRED: 'purge-expired',
           // Phase 17: SWEEP_STALE_RUNS
       },
   } as const;
   ```
2. **Env.** Copy PaperTrail's Gmail block (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`,
   `GMAIL_REDIRECT_URI`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER_NAME`, `GMAIL_OAUTH_SETUP`; all optional
   so the server boots before authorization), the queue-dashboard block, and
   `RUN_WORKERS_IN_API = getEnv("RUN_WORKERS_IN_API", "true")`, `WORKER_PORT = getEnv("WORKER_PORT", "8080")`.
   `.env.example`: `GMAIL_SENDER_NAME="Prompt Lab"`.
3. **Gmail.** Copy `config/gmail.ts`, `services/gmail.service.ts`, the controller and the route
   unchanged, and mount `app.use("/api/auth/gmail", gmailRoutes)` as PaperTrail does. The authorize
   routes exist outside production only (or with `GMAIL_OAUTH_SETUP=true`); the test-send route never
   exists in production. Do the one-time authorization: open `http://localhost:5000/api/auth/gmail`,
   consent, and copy the refresh token from the server log into `.env`. The sender **address** is a
   constant in `config/gmail.ts` on purpose, so no caller can choose it.
4. **Templates.** `emailTemplates.ts`: keep `getVerificationEmail` and `getPasswordResetEmail`. Delete
   the invite, webhook, budget and quota templates (Phase 10 adds the invite one back; Phase 17 adds
   "run finished"). Change the product name in both files. Links must match the web routes Phase 09
   copies from PaperTrail: `${CLIENT_URL}/auth/verify/<token>` and the reset page link exactly as
   Phase 05 defined it. Check Phase 05's `resetUrl` before editing; don't invent a second format.
5. **Jobs.** Copy `redis/connection.ts` and the three queue files. ADAPT:
   - `jobPayload.ts`: `VerifyEmailPayload`, `PasswordResetPayload` only.
   - `email.producer.ts`: `sendVerifyEmail` (and PaperTrail's `sendVerifyMail` alias) and
     `sendPasswordReset`, with hashed ids:
     ```ts
     import { createHash } from "node:crypto";
     // Job ids are visible in Bull Board and in Redis key names, so they carry a hash of the token.
     const tokenId = (token: string) => createHash("sha256").update(token).digest("hex").slice(0, 32);

     static async sendPasswordReset(payload: PasswordResetPayload) {
         return emailQueue.add(JOB_NAMES.EMAIL.PASSWORD_RESET, payload, {
             jobId: `reset-${payload.userId}-${tokenId(payload.resetToken)}`,
         });
     }
     static async sendVerifyEmail(payload: VerifyEmailPayload) {
         return emailQueue.add(JOB_NAMES.EMAIL.VERIFY_EMAIL, payload, {
             jobId: `verify-${payload.userId}-${tokenId(payload.verificationToken)}`,
         });
     }
     ```
   - `email.processor.ts`: keep `deliver()` (dev-mailbox fallback, the retry/unrecoverable split),
     `processVerifyEmail`, `processPasswordReset`. Delete the other processors.
   - `email.worker.ts`: the two cases; keep `concurrency: 5`, `limiter: { max: 2, duration: 1000 }`;
     add `emailWorker.on("failed", (job, err) => void onFinalFailure(job, err))`.
   - `purgeExpired.processor.ts`:
     ```ts
     export async function processPurgeExpired(now = new Date()) {
         return runAsSystem(async () => {
             const [sessions, verificationLinks] = await Promise.all([
                 prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
                 prisma.verificationLink.deleteMany({ where: { expiresAt: { lt: now } } }),
                 // Phase 10: expired invites
             ]);
             return { sessions: sessions.count, verificationLinks: verificationLinks.count };
         });
     }
     ```
     Deleting expired sessions directly (not via `revokeSessions`) is the one allowed exception: an
     expired session already fails `authenticate`'s database check, and its cache key lives ≤ 60 s.
   - `maintenance.worker.ts`: the `PURGE_EXPIRED` case only, `concurrency: 1`.
   - `deadLetter.ts`:
     ```ts
     /** Called from every worker's "failed" event. Only the LAST attempt counts: earlier ones are backoff. */
     export const onFinalFailure = async (job: Job | undefined, err: Error): Promise<void> => {
         if (!job) return;
         const isUnrecoverable = err.name === "UnrecoverableError";
         if (!isUnrecoverable && job.attemptsMade < (job.opts.attempts ?? 1)) return;
         // Phase 17: for run-cell jobs, first write the cell's Result with status "error" so the run can finish.
         await deadLetterQueue.add("dead", {
             queue: job.queueName, name: job.name, jobId: job.id, data: job.data,
             failedReason: err.message.slice(0, 2000), failedAt: new Date().toISOString(),
         }, { jobId: `dead-${job.id}` });
     };
     ```
   - `bull-board.ts`: the email, dead-letter and maintenance queues.
6. **`worker.ts`.** Start from PaperTrail's and keep:
   - `initSchedulers()` with only
     `maintenanceQueue.upsertJobScheduler("purge-expired", { pattern: "15 * * * *" }, { name: JOB_NAMES.MAINTENANCE.PURGE_EXPIRED })`;
   - `closeWorkers()` for the email and maintenance workers;
   - `createHealthServer()` reporting database, redis and `workers: { email, maintenance }`;
   - the `require.main === module` block.

   Remove the outbox relay, pub/sub, call recorder and Sentry lines: Prompt Lab doesn't copy the
   outbox (inherited-architecture.md), pub/sub is Phase 17, Sentry Phase 29.
7. **`index.ts`.** After `connectDB()`:
   ```ts
   let workers: typeof import("./worker") | null = null;
   if (RUN_WORKERS_IN_API !== "false") {
       // Dynamic on purpose: workers start when ./worker loads. A static import would start them
       // even with RUN_WORKERS_IN_API=false (found building the Playbook, 2 Nov 2026).
       workers = await import("./worker");
       await workers.initSchedulers();
       logger.info("[startup] in-process workers and schedulers initialized");
   } else {
       logger.info("[startup] RUN_WORKERS_IN_API=false — workers run in the standalone process");
   }
   ```
   Shutdown: `server.close` → `workers?.closeWorkers()` → `cache.close()` → `disconnectDB()`. `rg
   "from \"./worker\"" apps/api/src` must find nothing.
8. **Auth.** Replace each `// Phase 08:` comment in `auth.service.ts`: registration and
   resend-verification call `EmailProducer.sendVerifyEmail(...)`; forgot-password calls
   `EmailProducer.sendPasswordReset(...)`. Each call goes **after** the database write commits, never
   inside a transaction: a job queued for a rolled-back user would email a link that can't work. Add
   PaperTrail's non-production `GET /auth/dev/latest-link?email=` to `auth.route.ts`; Phase 28's tests
   and Playwright read links from it.
9. **Bull Board.** Copy PaperTrail's `queueDashboardAuth`, `matchesSecret` and the mount block into
   `createApp()`, before `requestId`.
10. `package.json`: `"worker": "tsx watch src/worker.ts"`, `"start:worker": "node dist/worker.js"`.

### Redis accessors (used by Phase 28's tests)

`config/redis.ts` exports `getQueueRedis()` and `getCacheRedis()`, returning the shared ioredis
instances (created lazily), so tests can flush or scan exactly the instance a feature uses instead of
building new connections with copied options.

## 7. Verify

```bash
docker compose up -d && pnpm --filter api dev
# [startup] in-process workers and schedulers initialized

# 1. Without GMAIL_REFRESH_TOKEN (dev): the email lands in the dev mailbox.
curl -s -X POST localhost:5000/auth/register -H 'content-type: application/json' \
  -d '{"name":"Ravi","email":"ravi@example.com","password":"correct-horse-9","confirmPassword":"correct-horse-9"}' > /dev/null
curl -s "localhost:5000/auth/dev/latest-link?email=ravi@example.com" | jq -r .email.link
# http://localhost:3000/auth/verify/<token>
# API log: [dev] email not sent (Gmail not authorized)

# 2. Deterministic ids: re-adding the same job is a no-op, and no token in the id.
pnpm --filter api exec tsx -e 'import("./src/jobs/producers/email.producer").then(async ({ EmailProducer }) => {
  const p = { userId: "00000000-0000-7000-8000-000000000001", email: "a@example.com", resetToken: "t".repeat(64) };
  const a = await EmailProducer.sendPasswordReset(p); const b = await EmailProducer.sendPasswordReset(p);
  console.log(a.id === b.id, a.id); process.exit(0) })'
# true reset-00000000-0000-7000-8000-000000000001-<32 hex>

# 3. Real Gmail (GMAIL_REFRESH_TOKEN set): the email arrives; Bull Board shows the job completed.
ENABLE_QUEUE_DASHBOARD=true QUEUE_DASHBOARD_USER=admin QUEUE_DASHBOARD_PASSWORD=change-me pnpm --filter api dev
curl -s -o /dev/null -w "%{http_code}\n" localhost:5000/admin/queues                      # 401
curl -s -o /dev/null -w "%{http_code}\n" -u admin:change-me localhost:5000/admin/queues/  # 200

# 4. Unrecoverable: GMAIL_REFRESH_TOKEN=garbage, request a reset.
#    Bull Board: the job failed after 1 attempt (not 5); dead-letter-queue holds dead-<id>.

# 5. Purge: expire a session by hand, run the processor once.
docker exec -it promptlab-postgres psql -U promptlab -d promptlab \
  -c "update sessions set expires_at = now() - interval '1 day' where id = '<id>';"
pnpm --filter api exec tsx -e 'import("./src/jobs/processors/purgeExpired.processor").then(async m => { console.log(await m.processPurgeExpired()); process.exit(0) })'
# { sessions: 1, verificationLinks: 0 }

# 6. Standalone worker.
RUN_WORKERS_IN_API=false pnpm --filter api dev      # "workers run in the standalone process"
pnpm --filter api worker                            # health server on :8080
curl -s localhost:8080/health | jq .workers         # { "email": true, "maintenance": true }

# 7. COPY files unchanged.
for f in config/gmail.ts services/gmail.service.ts controllers/gmailAuth.controller.ts routes/gmail.route.ts \
         utils/email/devMailbox.ts jobs/redis/connection.ts jobs/queues/{email,deadLetter,maintenance}.queue.ts; do
  diff -q ~/Code/paper-trail/apps/api/src/$f apps/api/src/$f; done
pnpm --filter api typecheck && pnpm --filter api lint
```

Check the Postgres container, user and database names against Phase 00's `docker-compose.yml`; the
ones above assume `promptlab`.

## 8. Definition of done

- [ ] Verification and reset emails go through the queue; nothing in `auth.service.ts` sends mail inline.
- [ ] No `// Phase 08:` comments remain.
- [ ] Token-email job ids contain a hash of the token, never the token; no custom id contains `:`.
- [ ] A revoked Gmail token fails a job once and lands it in the dead-letter queue.
- [ ] `purge-expired` is scheduled with `upsertJobScheduler` and deletes expired sessions and links.
- [ ] Bull Board is off by default, refuses to boot half-configured, and asks for Basic auth.
- [ ] `RUN_WORKERS_IN_API=false` + `pnpm worker` runs the same jobs in a separate process; `index.ts`
      has no static import of `./worker`.
- [ ] COPY files are identical to PaperTrail's.
- [ ] Commit: `feat(api): BullMQ, dead-letter queue, system email via Gmail, purge job`.

## 9. Interview angle

*"Why does a benchmarking tool need a job queue at all?"* Two reasons. Email shouldn't block a request
or fail it when Gmail hiccups. And a benchmark run is thousands of model calls (Phase 17), each its own
job with a deterministic id, so a crashed worker or a double click can't produce duplicate results, and
a failure that used all its retries lands in a dead-letter queue instead of disappearing. This phase
builds that foundation with the boring job, email, first.

*"What's in your job payloads?"* Ids, plus the unavoidable token for an auth email. Never a prompt, a
posting or a model output. Redis and the queue dashboard are readable by more tools than the database,
so content stays in Postgres and jobs read it by id.

*"How does the worker run in production?"* As its own process from the same codebase. In development
the API loads it with a dynamic import, so `pnpm dev` is one process. I learned the hard way that a
static import starts the workers even when the flag says not to.
