# Phase 08 — BullMQ and Gmail email

## 1. Goal

Copy PaperTrail's queue foundation:
- the Redis connection;
- the email queue, producer, worker and processor, already sending through the **Gmail API** with
  the "retry vs unrecoverable" policy;
- the Gmail OAuth sender and its one-time authorisation routes;
- the opt-in Bull Board dashboard;
- the worker entry point.

Verification and reset emails really send. The temporary producer goes. Phase 16 adds the run queues
on this base.

## 2. What I will understand after this phase

1. Queue / producer / worker / processor roles.
2. Deterministic job ids as idempotency.
3. Retry vs `UnrecoverableError`.
4. Why `worker.ts` runs inside the API in development and on its own in production.

## 3. Prerequisites

Phase 07 done. The Gmail sender setup from `~/Code/e-commerce/docs/gmail-api-email-sender.md`. Reuse
the same Google project and client; add the redirect URI for this app's port if it differs.

## 4. Files

```
apps/api/src/
├── jobs/redis/connection.ts                 COPY   @pt-api/src/jobs/redis/connection.ts
├── jobs/queues/email.queue.ts               COPY   @pt-api/src/jobs/queues/email.queue.ts
├── jobs/producers/email.producer.ts         ADAPT  @pt-api/src/jobs/producers/email.producer.ts   (drop invite/webhook methods; replaces the stub)
├── jobs/workers/email.worker.ts             ADAPT  @pt-api/src/jobs/workers/email.worker.ts       (only verify + reset cases)
├── jobs/processors/email.processor.ts       ADAPT  @pt-api/src/jobs/processors/email.processor.ts (only verify + reset)
├── jobs/interfaces/jobPayload.ts            NEW    (email payloads; Phase 16 appends run payloads)
├── jobs/dashboard/bull-board.ts             ADAPT  @pt-api/src/jobs/dashboard/bull-board.ts       (email queue; Phase 16 appends)
├── constants/queue.ts                       ADAPT  @pt-api/src/constants/queue.ts                 (EMAIL only for now)
├── config/gmail.ts                          COPY   @pt-api/src/config/gmail.ts
├── services/gmail.service.ts                COPY   @pt-api/src/services/gmail.service.ts
├── controllers/gmailAuth.controller.ts      COPY   @pt-api/src/controllers/gmailAuth.controller.ts
├── routes/gmail.route.ts                    COPY   @pt-api/src/routes/gmail.route.ts
├── utils/email/*                            ADAPT  @pt-api/src/utils/email/                       (branding: "Prompt Lab")
├── worker.ts                                ADAPT  @pt-api/src/worker.ts                          (email worker only; no relay/schedulers/observability)
├── app.ts · index.ts                        ADAPT  (queue dashboard, /api/auth/gmail, closeWorkers)
└── constants/env.ts                         ADAPT  (+ queue dashboard + GMAIL_* blocks, + RUN_WORKERS_IN_API)
```

```bash
pnpm --filter api add bullmq @bull-board/api @bull-board/express googleapis
```

## 5. Concepts

See PaperTrail's Phase 08 doc. The retry table carries straight over to Phase 16's model calls:

| Failure | Policy |
| --- | --- |
| malformed payload | `UnrecoverableError` |
| needs a human (not authorised, invalid grant, bad recipient) | `UnrecoverableError` |
| rate limit, 5xx, network | throw → backoff |
| nothing to do (user gone, already verified) | complete with `skipped` |

**`RUN_WORKERS_IN_API`.** Default `true`: `pnpm dev` runs everything in one process. In production the
API sets it to `false` and a separate worker service runs `node dist/worker.js` (Phase 27), so a
3,000-call run never competes with HTTP requests for the event loop. This is PaperTrail's final shape.

## 6. Steps

```bash
cd ~/Code/prompt-lab/apps/api/src; PT=~/Code/paper-trail/apps/api/src
mkdir -p jobs/{redis,queues,producers,workers,processors,interfaces,dashboard} utils/email
cp $PT/jobs/redis/connection.ts jobs/redis/ && cp $PT/jobs/queues/email.queue.ts jobs/queues/
cp $PT/jobs/producers/email.producer.ts jobs/producers/ && cp $PT/jobs/workers/email.worker.ts jobs/workers/
cp $PT/jobs/processors/email.processor.ts jobs/processors/ && cp $PT/jobs/dashboard/bull-board.ts jobs/dashboard/
cp $PT/config/gmail.ts config/ && cp $PT/services/gmail.service.ts services/
cp $PT/controllers/gmailAuth.controller.ts controllers/ && cp $PT/routes/gmail.route.ts routes/
cp $PT/utils/email/* utils/email/ && cp $PT/worker.ts . && cp $PT/constants/queue.ts constants/
```

Trim each ADAPT file to the email-only shape:
- remove `sendOrgInvite`, `WEBHOOK_DISABLED`, budget and quota emails and their processor cases;
- `constants/queue.ts` keeps `EMAIL` plus `VERIFY_EMAIL` / `PASSWORD_RESET`;
- `bull-board.ts` lists `emailQueue`;
- `jobPayload.ts` holds only the two email payloads;
- `worker.ts`: `closeWorkers()` closes `emailWorker` only, with no relay, schedulers,
  `setCallRecorder` or observability flush. Keep the `require.main === module` standalone block;
- branding: "PaperTrail" → "Prompt Lab" in subjects and templates.

`app.ts`: the queue-dashboard block exactly as in PaperTrail's `createApp`, and
`app.use("/api/auth/gmail", gmailRoutes)`. `index.ts`: import `closeWorkers` and conditionally start the
in-process workers with `RUN_WORKERS_IN_API`.

## 7. Verify

PaperTrail's Phase 08 checks:
- register → the email arrives (or, without a Gmail refresh token in development, the email is
  logged);
- a garbage refresh token → the job fails **once**, unrecoverable;
- the header-injection test on `/api/auth/gmail/test` → 400;
- the dashboard refuses to boot half-configured.

`diff -q` the COPY files.

## 8. Definition of done

- [ ] Emails send through Gmail via BullMQ; no stubs left.
- [ ] The worker runs in-process (dev) or standalone (`pnpm --filter api worker`).
- [ ] Commit: `feat(api): BullMQ and Gmail email`.

## 9. Interview angle

*"How do your background jobs fail?"* Transient problems back off with jitter. Problems that need a
human fail once with a clear reason. Deterministic job ids make enqueueing idempotent.
