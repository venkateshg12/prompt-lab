# Copy map

Every file a phase creates or changes, with its tag, source and phase. Generated from the **Files**
section of every phase by `scripts/copymap.py` (`python3 scripts/copymap.py . > /tmp/map.md`); regenerate
it after changing a phase's Files tree. Shorthands: [inherited-architecture.md](inherited-architecture.md).

**COPY** = identical apart from import paths (`diff` it). **ADAPT** = only the listed changes.
**NEW** = full code in the phase. A file listed twice is created in one phase and extended in a later one.

## root and other

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `.nvmrc` | NEW | — | 00 |
| `package.json` | ADAPT | `@pt-root/package.json` | 00 |
| `pnpm-workspace.yaml` | COPY | `@pt-root/pnpm-workspace.yaml` | 00 |
| `turbo.json` | COPY | `@pt-root/turbo.json` | 00 |
| `.prettierrc` | COPY | `@pt-root/.prettierrc` | 00 |
| `.gitignore` | COPY | `@pt-root/.gitignore` | 00 |
| `Makefile` | ADAPT | `@pt-root/Makefile` | 00 |
| `docker-compose.yml` | ADAPT | `@pt-root/docker-compose.yml` | 00 |
| `.dockerignore` | COPY | `@pt-root/.dockerignore` | 29 |
| `docker-compose.yml` | ADAPT | — | 29 |
| `docs/DEPLOY.md` | NEW | `@pb-root/docs/DEPLOY.md` | 29 |
| `README.md` | ADAPT | — | 30 |
| `docs/adr/0001-postgresql-not-sqlite-or-mongodb.md` | NEW | — | 30 |
| `docs/adr/0002-one-job-per-cell.md` | NEW | — | 30 |
| `docs/adr/0003-never-repair-model-output.md` | NEW | — | 30 |
| `docs/adr/0004-workspace-is-an-org.md` | NEW | — | 30 |
| `docs/adr/0005-nvidia-default-plus-three-adapters.md` | NEW | — | 30 |
| `docs/adr/0006-playbook-export-contract.md` | NEW | — | 30 |
| `docs/adr/0007-no-fallback-model-in-a-benchmark.md` | NEW | — | 30 |
| `docs/LIMITATIONS.md · docs/INTERVIEW.md · docs/DATA-HANDLING.md · docs/demo-script.md` | NEW | — | 30 |
| `docs/linkedin-post.md` | NEW | — | 30 |
| `LICENSE` | NEW | — | 30 |

## packages

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `packages/typescript-config/` | COPY | `@pt-root/packages/typescript-config/` | 00 |
| `packages/eslint-config/` | COPY | `@pt-root/packages/eslint-config/` | 00 |
| `packages/types/package.json` | COPY | `@pt-root/packages/types/package.json` | 00 |
| `packages/types/tsconfig.json` | COPY | `@pt-root/packages/types/tsconfig.json` | 00 |
| `packages/types/src/index.ts` | NEW | — | 00 |
| `packages/types/src/api.ts` | COPY | `@pt-root/packages/types/src/api.ts` | 00 |
| `packages/types/src/id.ts` | COPY | `@pt-root/packages/types/src/id.ts` | 00 |
| `packages/types/src/pagination.ts` | COPY | `@pt-root/packages/types/src/pagination.ts` | 00 |
| `packages/scoring/package.json` | ADAPT | `@pt-root/packages/types/package.json` | 00 |
| `packages/scoring/tsconfig.json` | COPY | `@pt-root/packages/types/tsconfig.json` | 00 |
| `packages/scoring/src/index.ts` | NEW | — | 00 |
| `packages/types/src/user.ts` | ADAPT | `@pt-root/packages/types/src/user.ts` | 04 |
| `packages/types/src/cookie.ts` | COPY | `@pt-root/packages/types/src/cookie.ts` | 04 |
| `packages/types/src/index.ts` | ADAPT | — | 04 |
| `packages/types/src/user.ts` | ADAPT | — | 05 |
| `packages/types/src/org.ts` | ADAPT | `@pt-root/packages/types/src/org.ts` | 10 |
| `packages/types/src/fieldRules.ts` | NEW | — | 11 |
| `packages/types/src/task.ts` | NEW | — | 11 |
| `packages/types/src/index.ts` | ADAPT | — | 11 |
| `packages/types/src/caseLine.ts` | NEW | — | 12 |
| `packages/types/src/index.ts` | ADAPT | — | 12 |
| `packages/types/src/prompt.ts` | NEW | — | 13 |
| `packages/types/src/index.ts` | ADAPT | — | 13 |
| `packages/types/src/model.ts` | NEW | — | 14 |
| `packages/scoring/src/renderPrompt.ts` | NEW | — | 15 |
| `packages/scoring/src/providerSchema.ts` | NEW | — | 15 |
| `packages/scoring/src/__tests__/{renderPrompt,providerSchema}.test.ts` | NEW | — | 15 |
| `packages/scoring/package.json` | ADAPT | — | 16 |
| `packages/scoring/vitest.config.mts` | NEW | — | 16 |
| `packages/scoring/src/extract.ts` | NEW | — | 16 |
| `packages/scoring/src/normalize.ts` | NEW | — | 16 |
| `packages/scoring/src/money.ts` | NEW | — | 16 |
| `packages/scoring/src/fields.ts` | NEW | — | 16 |
| `packages/scoring/src/score.ts` | NEW | — | 16 |
| `packages/scoring/src/canonical.ts` | NEW | — | 16 |
| `packages/scoring/src/index.ts` | NEW | — | 16 |
| `packages/scoring/src/__tests__/{extract,normalize,money,fields,score,canonical}.test.ts` | NEW | — | 16 |
| `packages/types/src/run.ts` | NEW | — | 17 |
| `packages/scoring/src/stats.ts` | COPY | `@pb-root/apps/site/src/lib/data/stats.ts` | 18 |
| `packages/scoring/src/aggregate.ts` | NEW | — | 18 |
| `packages/scoring/src/__tests__/{stats,aggregate,parity}.test.ts` | NEW | `@pb-root/apps/site/scripts/fixtures/import/run.jsonl` | 18 |
| `packages/types/src/run.ts` | ADAPT | — | 20 |
| `packages/types/src/results.ts` | NEW | — | 21 |
| `packages/scoring/src/exportMarkdown.ts` | NEW | — | 22 |
| `packages/types/src/export.ts` | NEW | — | 22 |
| `packages/types/src/demo.ts` | NEW | — | 23 |
| `packages/types/src/judge.ts` | NEW | — | 26 |
| `packages/scoring/src/agreement.ts (+ .test.ts)` | NEW | — | 26 |
| `packages/scoring/src/__tests__/properties.test.ts` | NEW | — | 28 |
| `packages/scoring/package.json` | ADAPT | — | 28 |

## cases

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `cases/README.md` | NEW | — | 00 |
| `cases/job-postings/task.json` | NEW | — | 11 |
| `cases/job-postings/prompts/v1-zero-shot.md` | NEW | — | 13 |
| `cases/job-postings/prompts/{v1-zero-shot,v2-few-shot,v3-cot,v4-structured}.md` | NEW | — | 15 |
| `cases/job-postings/LABELLING.md` | NEW | — | 24 |
| `cases/job-postings/SOURCES.md` | NEW | — | 24 |
| `cases/job-postings/data/job_postings.jsonl` | NEW | — | 24 |
| `cases/job-postings/data/second-label.jsonl` | NEW | — | 24 |
| `cases/job-postings/data/AGREEMENT.md` | NEW | — | 24 |
| `cases/job-postings/prompts/v0-vague.md` | NEW | — | 25 |
| `cases/job-postings/prompts/v1-zero-shot.md` | ADAPT | — | 25 |
| `cases/job-postings/prompts/v1-thorough.md` | NEW | — | 25 |
| `cases/job-postings/prompts/v2-few-shot.md` | ADAPT | — | 25 |
| `cases/job-postings/prompts/v2b-one-shot.md` | NEW | — | 25 |
| `cases/job-postings/prompts/v3-cot.md · v4-structured.md` | ADAPT | — | 25 |
| `cases/job-postings/prompts/v5-best.md` | NEW | — | 25 |
| `cases/job-postings/prompts/EXPERIMENT.md` | NEW | — | 25 |
| `cases/reasoning-mini/task.json` | NEW | — | 25 |
| `cases/reasoning-mini/data/reasoning_mini.jsonl` | NEW | — | 25 |
| `cases/reasoning-mini/prompts/{direct.md,cot.md}` | NEW | — | 25 |
| `cases/job-postings/runs/` | NEW | — | 25 |
| `cases/HANDOFF.md` | NEW | — | 27 |
| `cases/RETEST.md` | NEW | — | 27 |

## apps/api

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/api/{package.json,tsconfig.json,eslint.config.mjs,src/index.ts}` | NEW | — | 00 |
| `apps/api/.env.example` | ADAPT | `@pt-api/.env.example` | 01 |
| `apps/api/package.json` | ADAPT | — | 01 |
| `apps/api/package.json` | ADAPT | — | 03 |
| `apps/api/package.json` | ADAPT | — | 08 |
| `apps/api/vitest.config.mts` | COPY | `@pt-api/vitest.config.mts` | 28 |
| `apps/api/vitest.integration.config.mts` | COPY | `@pt-api/vitest.integration.config.mts` | 28 |
| `apps/api/Dockerfile` | ADAPT | `@pt-api/Dockerfile` | 29 |
| `apps/api/.env.example` | ADAPT | — | 29 |

## apps/api/prisma

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/api/prisma.config.ts` | COPY | `@pt-api/prisma.config.ts` | 03 |
| `apps/api/prisma/schema.prisma` | ADAPT | `@pt-api/prisma/schema.prisma` | 03 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 04 |
| `apps/api/prisma/schema.prisma` | ADAPT | `@pt-api/prisma/schema.prisma` | 10 |
| `apps/api/prisma/migrations/<ts>_workspaces/` | NEW | — | 10 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 11 |
| `apps/api/prisma/migrations/<ts>_tasks/` | NEW | — | 11 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 12 |
| `apps/api/prisma/migrations/<ts>_examples/` | NEW | — | 12 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 13 |
| `apps/api/prisma/migrations/<ts>_prompts/` | NEW | — | 13 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 14 |
| `apps/api/prisma/migrations/<ts>_models/` | NEW | — | 14 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 17 |
| `apps/api/prisma/migrations/<ts>_runs/` | NEW | — | 17 |
| `apps/api/prisma/migrations/<ts>_publish/` | NEW | — | 22 |
| `apps/api/prisma/schema.prisma` | ADAPT | — | 26 |

## apps/api/src

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/api/src/index.ts` | ADAPT | `@pt-api/src/index.ts` | 01 |
| `apps/api/src/app.ts` | ADAPT | `@pt-api/src/app.ts` | 01 |
| `apps/api/src/worker.ts` | NEW | — | 01 |
| `apps/api/src/constants/env.ts` | ADAPT | `@pt-api/src/constants/env.ts` | 01 |
| `apps/api/src/constants/https.ts` | COPY | `@pt-api/src/constants/https.ts` | 01 |
| `apps/api/src/constants/appErrorCode.ts` | ADAPT | `@pt-api/src/constants/appErrorCode.ts` | 01 |
| `apps/api/src/utils/errors/{appError,appAssert,catchError,index}.ts` | COPY | `@pt-api/src/utils/errors/` | 01 |
| `apps/api/src/utils/api/{apiEnvelope,index}.ts` | COPY | `@pt-api/src/utils/api/` | 01 |
| `apps/api/src/middleware/notFound.ts` | COPY | `@pt-api/src/middleware/notFound.ts` | 01 |
| `apps/api/src/middleware/errorHandler.ts` | ADAPT | `@pt-api/src/middleware/errorHandler.ts` | 01 |
| `apps/api/src/utils/requestContext.ts` | ADAPT | `@pt-api/src/utils/requestContext.ts` | 02 |
| `apps/api/src/utils/logger.ts` | ADAPT | `@pt-api/src/utils/logger.ts` | 02 |
| `apps/api/src/middleware/requestId.ts` | COPY | `@pt-api/src/middleware/requestId.ts` | 02 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 02 |
| `apps/api/src/app.ts` | ADAPT | — | 02 |
| `apps/api/src/middleware/errorHandler.ts` | ADAPT | — | 02 |
| `apps/api/src/index.ts · worker.ts` | ADAPT | — | 02 |
| `apps/api/src/db/prisma.ts` | ADAPT | `@pt-api/src/db/prisma.ts` | 03 |
| `apps/api/src/db/prisma.test.ts` | NEW | — | 03 |
| `apps/api/src/db/errors.ts` | COPY | `@pt-api/src/db/errors.ts` | 03 |
| `apps/api/src/config/db.ts` | COPY | `@pt-api/src/config/db.ts` | 03 |
| `apps/api/src/utils/db/transaction.ts` | COPY | `@pt-api/src/utils/db/transaction.ts` | 03 |
| `apps/api/src/utils/db/cursor.ts` | COPY | `@pt-api/src/utils/db/cursor.ts` | 03 |
| `apps/api/src/utils/db/index.ts` | ADAPT | `@pt-api/src/utils/db/index.ts` | 03 |
| `apps/api/src/scripts/ensure-database.ts` | COPY | `@pt-api/src/scripts/ensure-database.ts` | 03 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 03 |
| `apps/api/src/app.ts` | ADAPT | — | 03 |
| `apps/api/src/index.ts` | ADAPT | — | 03 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 04 |
| `apps/api/src/constants/verificationLinkType.ts` | COPY | `@pt-api/src/constants/verificationLinkType.ts` | 04 |
| `apps/api/src/types/auth.types.ts` | COPY | `@pt-api/src/types/auth.types.ts` | 04 |
| `apps/api/src/types/user.types.ts` | COPY | `@pt-api/src/types/user.types.ts` | 04 |
| `apps/api/src/types/session.types.ts` | COPY | `@pt-api/src/types/session.types.ts` | 04 |
| `apps/api/src/types/verificationLink.types.ts` | COPY | `@pt-api/src/types/verificationLink.types.ts` | 04 |
| `apps/api/src/types/express.d.ts` | ADAPT | `@pt-api/src/types/express.d.ts` | 04 |
| `apps/api/src/utils/auth/{bcrypt,cookies,jwt,verificationToken,index}.ts` | COPY | `@pt-api/src/utils/auth/` | 04 |
| `apps/api/src/utils/date/{date,index}.ts` | COPY | `@pt-api/src/utils/date/` | 04 |
| `apps/api/src/services/auth.service.ts` | ADAPT | `@pt-api/src/services/auth.service.ts` | 04 |
| `apps/api/src/controllers/auth.controller.ts` | ADAPT | `@pt-api/src/controllers/auth.controller.ts` | 04 |
| `apps/api/src/routes/auth.route.ts` | ADAPT | `@pt-api/src/routes/auth.route.ts` | 04 |
| `apps/api/src/middleware/errorHandler.ts` | ADAPT | — | 04 |
| `apps/api/src/app.ts` | ADAPT | — | 04 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 05 |
| `apps/api/src/middleware/authenticate.ts` | ADAPT | `@pt-api/src/middleware/authenticate.ts` | 05 |
| `apps/api/src/middleware/requireAdmin.ts` | COPY | `@pt-api/src/middleware/requireAdmin.ts` | 05 |
| `apps/api/src/services/auth.service.ts` | ADAPT | — | 05 |
| `apps/api/src/controllers/auth.controller.ts` | ADAPT | — | 05 |
| `apps/api/src/controllers/session.controller.ts` | COPY | `@pt-api/src/controllers/session.controller.ts` | 05 |
| `apps/api/src/controllers/googleAuth.controller.ts` | ADAPT | `@pt-api/src/controllers/googleAuth.controller.ts` | 05 |
| `apps/api/src/routes/auth.route.ts` | ADAPT | — | 05 |
| `apps/api/src/routes/session.route.ts` | ADAPT | `@pt-api/src/routes/session.route.ts` | 05 |
| `apps/api/src/app.ts` | ADAPT | — | 05 |
| `apps/api/src/config/redis.ts` | COPY | `@pt-api/src/config/redis.ts` | 06 |
| `apps/api/src/config/rateLimiter.ts` | ADAPT | `@pt-api/src/config/rateLimiter.ts` | 06 |
| `apps/api/src/constants/rateLimiter.constant.ts` | ADAPT | `@pt-api/src/constants/rateLimiter.constant.ts` | 06 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 06 |
| `apps/api/src/types/rateLimiter.types.ts` | COPY | `@pt-api/src/types/rateLimiter.types.ts` | 06 |
| `apps/api/src/utils/rateLimiter/circuitBreaker.ts` | COPY | `@pt-api/src/utils/rateLimiter/circuitBreaker.ts` | 06 |
| `apps/api/src/utils/rateLimiter/ipExtractor.ts` | COPY | `@pt-api/src/utils/rateLimiter/ipExtractor.ts` | 06 |
| `apps/api/src/utils/rateLimiter/luaScript.ts` | COPY | `@pt-api/src/utils/rateLimiter/luaScript.ts` | 06 |
| `apps/api/src/utils/rateLimiter/memoryStore.ts` | COPY | `@pt-api/src/utils/rateLimiter/memoryStore.ts` | 06 |
| `apps/api/src/utils/rateLimiter/redisStore.ts` | COPY | `@pt-api/src/utils/rateLimiter/redisStore.ts` | 06 |
| `apps/api/src/utils/rateLimiter/index.ts` | COPY | `@pt-api/src/utils/rateLimiter/index.ts` | 06 |
| `apps/api/src/middleware/rateLimiter.ts` | COPY | `@pt-api/src/middleware/rateLimiter.ts` | 06 |
| `apps/api/src/middleware/visitorId.ts` | COPY | `@pt-api/src/middleware/visitorId.ts` | 06 |
| `apps/api/src/types/express.d.ts` | ADAPT | — | 06 |
| `apps/api/src/routes/auth.route.ts` | ADAPT | `@pt-api/src/routes/auth.route.ts` | 06 |
| `apps/api/src/app.ts` | ADAPT | `@pt-api/src/app.ts` | 06 |
| `apps/api/src/index.ts` | ADAPT | `@pt-api/src/index.ts` | 06 |
| `apps/api/src/utils/cache/cache.ts` | ADAPT | `@pt-api/src/utils/cache/cache.ts` | 07 |
| `apps/api/src/utils/cache/index.ts` | COPY | `@pt-api/src/utils/cache/index.ts` | 07 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 07 |
| `apps/api/src/middleware/authenticate.ts` | ADAPT | — | 07 |
| `apps/api/src/services/auth.service.ts` | ADAPT | `@pt-api/src/services/auth.service.ts` | 07 |
| `apps/api/src/app.ts` | ADAPT | `@pt-api/src/app.ts` | 07 |
| `apps/api/src/index.ts` | ADAPT | `@pt-api/src/index.ts` | 07 |
| `apps/api/src/constants/queue.ts` | ADAPT | `@pt-api/src/constants/queue.ts` | 08 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 08 |
| `apps/api/src/config/gmail.ts` | COPY | `@pt-api/src/config/gmail.ts` | 08 |
| `apps/api/src/services/gmail.service.ts` | COPY | `@pt-api/src/services/gmail.service.ts` | 08 |
| `apps/api/src/controllers/gmailAuth.controller.ts` | COPY | `@pt-api/src/controllers/gmailAuth.controller.ts` | 08 |
| `apps/api/src/routes/gmail.route.ts` | COPY | `@pt-api/src/routes/gmail.route.ts` | 08 |
| `apps/api/src/utils/email/emailTemplates.ts` | ADAPT | `@pt-api/src/utils/email/emailTemplates.ts` | 08 |
| `apps/api/src/utils/email/html_templates.ts` | ADAPT | `@pt-api/src/utils/email/html_templates.ts` | 08 |
| `apps/api/src/utils/email/devMailbox.ts` | COPY | `@pt-api/src/utils/email/devMailbox.ts` | 08 |
| `apps/api/src/utils/email/index.ts` | COPY | `@pt-api/src/utils/email/index.ts` | 08 |
| `apps/api/src/jobs/redis/connection.ts` | COPY | `@pt-api/src/jobs/redis/connection.ts` | 08 |
| `apps/api/src/jobs/interfaces/jobPayload.ts` | ADAPT | `@pt-api/src/jobs/interfaces/jobPayload.ts` | 08 |
| `apps/api/src/jobs/queues/email.queue.ts` | COPY | `@pt-api/src/jobs/queues/email.queue.ts` | 08 |
| `apps/api/src/jobs/queues/deadLetter.queue.ts` | COPY | `@pt-api/src/jobs/queues/deadLetter.queue.ts` | 08 |
| `apps/api/src/jobs/queues/maintenance.queue.ts` | COPY | `@pt-api/src/jobs/queues/maintenance.queue.ts` | 08 |
| `apps/api/src/jobs/producers/email.producer.ts` | ADAPT | `@pt-api/src/jobs/producers/email.producer.ts` | 08 |
| `apps/api/src/jobs/processors/email.processor.ts` | ADAPT | `@pt-api/src/jobs/processors/email.processor.ts` | 08 |
| `apps/api/src/jobs/processors/purgeExpired.processor.ts` | ADAPT | `@pt-api/src/jobs/processors/purgeExpired.processor.ts` | 08 |
| `apps/api/src/jobs/workers/email.worker.ts` | ADAPT | `@pt-api/src/jobs/workers/email.worker.ts` | 08 |
| `apps/api/src/jobs/workers/maintenance.worker.ts` | ADAPT | `@pt-api/src/jobs/workers/maintenance.worker.ts` | 08 |
| `apps/api/src/jobs/deadLetter.ts` | ADAPT | `@pt-api/src/jobs/deadLetter.ts` | 08 |
| `apps/api/src/jobs/dashboard/bull-board.ts` | ADAPT | `@pt-api/src/jobs/dashboard/bull-board.ts` | 08 |
| `apps/api/src/services/auth.service.ts` | ADAPT | — | 08 |
| `apps/api/src/routes/auth.route.ts` | ADAPT | — | 08 |
| `apps/api/src/worker.ts` | ADAPT | `@pt-api/src/worker.ts` | 08 |
| `apps/api/src/index.ts` | ADAPT | — | 08 |
| `apps/api/src/app.ts` | ADAPT | `@pt-api/src/app.ts` | 08 |
| `apps/api/src/db/prisma.ts` | ADAPT | — | 10 |
| `apps/api/src/constants/permissions.ts` | ADAPT | `@pt-api/src/constants/permissions.ts` | 10 |
| `apps/api/src/types/org.types.ts` | ADAPT | `@pt-api/src/types/org.types.ts` | 10 |
| `apps/api/src/middleware/resolveOrg.ts` | ADAPT | `@pt-api/src/middleware/resolveOrg.ts` | 10 |
| `apps/api/src/middleware/requireOrgRole.ts` | COPY | `@pt-api/src/middleware/requireOrgRole.ts` | 10 |
| `apps/api/src/services/org.service.ts` | ADAPT | `@pt-api/src/services/org.service.ts` | 10 |
| `apps/api/src/services/member.service.ts` | COPY | `@pt-api/src/services/member.service.ts` | 10 |
| `apps/api/src/services/audit.service.ts` | COPY | `@pt-api/src/services/audit.service.ts` | 10 |
| `apps/api/src/services/invite.service.ts` | ADAPT | `@pt-api/src/services/invite.service.ts` | 10 |
| `apps/api/src/services/deletion.service.ts` | NEW | — | 10 |
| `apps/api/src/utils/actor.ts` | ADAPT | `@pt-api/src/utils/actor.ts` | 10 |
| `apps/api/src/controllers/{org,member,invite}.controller.ts` | ADAPT | `@pt-api/src/controllers/` | 10 |
| `apps/api/src/routes/{org,member,invite}.route.ts` | ADAPT | `@pt-api/src/routes/` | 10 |
| `apps/api/src/jobs/{producers,processors}/email.*.ts` | ADAPT | — | 10 |
| `apps/api/src/jobs/processors/purgeExpired.processor.ts` | ADAPT | — | 10 |
| `apps/api/src/utils/email/emailTemplates.ts` | ADAPT | — | 10 |
| `apps/api/src/services/auth.service.ts` | ADAPT | — | 10 |
| `apps/api/src/controllers/googleAuth.controller.ts` | ADAPT | — | 10 |
| `apps/api/src/types/express.d.ts` | ADAPT | — | 10 |
| `apps/api/src/scripts/check-tenancy.ts` | NEW | — | 10 |
| `apps/api/src/app.ts` | ADAPT | — | 10 |
| `apps/api/src/services/task.service.ts` | NEW | — | 11 |
| `apps/api/src/controllers/task.controller.ts` | NEW | — | 11 |
| `apps/api/src/routes/task.route.ts` | NEW | — | 11 |
| `apps/api/src/app.ts` | ADAPT | — | 11 |
| `apps/api/src/scripts/import-cases.ts` | NEW | — | 11 |
| `apps/api/src/utils/importers/{jsonl,csv}.ts` | NEW | — | 12 |
| `apps/api/src/services/example.service.ts` | NEW | — | 12 |
| `apps/api/src/controllers/example.controller.ts` | NEW | — | 12 |
| `apps/api/src/routes/example.route.ts` | NEW | — | 12 |
| `apps/api/src/app.ts` | ADAPT | — | 12 |
| `apps/api/src/scripts/import-cases.ts` | ADAPT | — | 12 |
| `apps/api/src/prompts/render.ts (+ render.test.ts)` | NEW | — | 13 |
| `apps/api/src/prompts/promptFile.ts` | NEW | — | 13 |
| `apps/api/src/services/prompt.service.ts` | NEW | — | 13 |
| `apps/api/src/controllers/prompt.controller.ts` | NEW | — | 13 |
| `apps/api/src/routes/prompt.route.ts` | NEW | — | 13 |
| `apps/api/src/app.ts` | ADAPT | — | 13 |
| `apps/api/src/scripts/import-cases.ts` | ADAPT | — | 13 |
| `apps/api/src/config/models.config.ts` | NEW | — | 14 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 14 |
| `apps/api/src/constants/llm.ts` | ADAPT | `@pt-api/src/constants/llm.ts` | 14 |
| `apps/api/src/ai/types.ts` | ADAPT | `@pt-api/src/ai/types.ts` | 14 |
| `apps/api/src/ai/errors.ts` | ADAPT | `@pt-api/src/ai/errors.ts` | 14 |
| `apps/api/src/ai/reliability.ts (+ .test.ts)` | COPY | `@pt-api/src/ai/reliability.ts` | 14 |
| `apps/api/src/ai/breakers.ts` | COPY | `@pt-api/src/ai/breakers.ts` | 14 |
| `apps/api/src/ai/concurrency.ts` | COPY | `@pt-api/src/ai/concurrency.ts` | 14 |
| `apps/api/src/ai/providers/openaiCompatible.ts` | ADAPT | `@pt-api/src/ai/providers/nvidia.ts` | 14 |
| `apps/api/src/ai/providers/anthropic.ts` | NEW | — | 14 |
| `apps/api/src/ai/providers/gemini.ts` | NEW | — | 14 |
| `apps/api/src/ai/providers/fake.ts` | ADAPT | `@pt-api/src/ai/providers/fake.ts` | 14 |
| `apps/api/src/ai/providers/replay.ts` | ADAPT | `@pt-api/src/ai/providers/replay.ts` | 14 |
| `apps/api/src/ai/complete.ts` | NEW | — | 14 |
| `apps/api/src/utils/cost.ts` | ADAPT | `@pt-api/src/utils/cost.ts` | 14 |
| `apps/api/src/utils/scrubSecrets.ts` | COPY | `@pb-root/apps/api/src/utils/scrubSecrets.ts` | 14 |
| `apps/api/src/services/model.service.ts` | NEW | — | 14 |
| `apps/api/src/controllers/model.controller.ts · routes/model.route.ts` | NEW | — | 14 |
| `apps/api/src/scripts/{seed-models,try-model,list-nvidia-models}.ts` | NEW | — | 14 |
| `apps/api/src/ai/providers/openai.ts` | ADAPT | — | 15 |
| `apps/api/src/ai/providers/anthropic.ts` | ADAPT | — | 15 |
| `apps/api/src/ai/providers/gemini.ts` | ADAPT | — | 15 |
| `apps/api/src/ai/providers/nvidia.ts` | ADAPT | `@pt-api/src/ai/providers/nvidia.ts` | 15 |
| `apps/api/src/services/prompt.service.ts` | ADAPT | — | 15 |
| `apps/api/src/services/model.service.ts` | ADAPT | — | 15 |
| `apps/api/src/controllers/model.controller.ts` | ADAPT | — | 15 |
| `apps/api/src/scripts/probe-structured.ts` | NEW | — | 15 |
| `apps/api/src/runner/cellJobId.ts` | NEW | — | 17 |
| `apps/api/src/runner/snapshot.ts` | NEW | — | 17 |
| `apps/api/src/runner/createRun.ts` | NEW | — | 17 |
| `apps/api/src/runner/executeCell.ts` | NEW | — | 17 |
| `apps/api/src/runner/persistCell.ts` | NEW | — | 17 |
| `apps/api/src/runner/resultLine.ts` | NEW | — | 17 |
| `apps/api/src/jobs/queues/{runCell,runFinalize}.queue.ts` | NEW | `@pt-api/src/jobs/queues/extract.queue.ts` | 17 |
| `apps/api/src/jobs/workers/{runCell,runFinalize}.worker.ts` | NEW | `@pt-api/src/jobs/workers/extract.worker.ts` | 17 |
| `apps/api/src/jobs/processors/runCell.processor.ts` | NEW | — | 17 |
| `apps/api/src/jobs/processors/runFinalize.processor.ts` | NEW | — | 17 |
| `apps/api/src/jobs/processors/staleRuns.processor.ts` | ADAPT | `@pt-api/src/jobs/processors/sweeper.processor.ts` | 17 |
| `apps/api/src/jobs/queues/deadLetter.queue.ts` | COPY | `@pt-api/src/jobs/queues/deadLetter.queue.ts` | 17 |
| `apps/api/src/jobs/deadLetter.ts` | ADAPT | `@pt-api/src/jobs/deadLetter.ts` | 17 |
| `apps/api/src/services/dlq.service.ts` | ADAPT | `@pt-api/src/services/dlq.service.ts` | 17 |
| `apps/api/src/controllers/dlq.controller.ts · routes/dlq.route.ts` | COPY | `@pt-api/src/{controllers,routes}/dlq.*.ts` | 17 |
| `apps/api/src/utils/events/{sse,streamLimiter}.ts` | COPY | `@pt-api/src/utils/events/` | 17 |
| `apps/api/src/utils/events/pubsub.ts` | ADAPT | `@pt-api/src/utils/events/pubsub.ts` | 17 |
| `apps/api/src/services/run.service.ts` | NEW | — | 17 |
| `apps/api/src/controllers/run.controller.ts · routes/run.route.ts` | NEW | — | 17 |
| `apps/api/src/constants/queue.ts` | ADAPT | — | 17 |
| `apps/api/src/constants/env.ts` | ADAPT | — | 17 |
| `apps/api/src/jobs/dashboard/bull-board.ts` | ADAPT | — | 17 |
| `apps/api/src/worker.ts` | ADAPT | — | 17 |
| `apps/api/src/scripts/bench.ts` | NEW | — | 17 |
| `apps/api/src/services/results.service.ts` | NEW | — | 18 |
| `apps/api/src/jobs/processors/runFinalize.processor.ts` | ADAPT | — | 18 |
| `apps/api/src/jobs/processors/rescore.processor.ts` | NEW | — | 18 |
| `apps/api/src/controllers/results.controller.ts · routes/run.route.ts` | NEW | — | 18 |
| `apps/api/src/scripts/bench.ts` | ADAPT | — | 18 |
| `apps/api/src/services/run.service.ts` | ADAPT | — | 20 |
| `apps/api/src/controllers/run.controller.ts` | ADAPT | — | 20 |
| `apps/api/src/routes/run.route.ts` | ADAPT | — | 20 |
| `apps/api/src/services/results.service.ts` | NEW | — | 21 |
| `apps/api/src/controllers/results.controller.ts` | NEW | — | 21 |
| `apps/api/src/routes/run.route.ts` | ADAPT | — | 21 |
| `apps/api/src/utils/db/cursor.ts` | ADAPT | `@pt-api/src/utils/db/cursor.ts` | 21 |
| `apps/api/src/utils/csv.ts (+ csv.test.ts)` | ADAPT | `@pt-api/src/utils/csv.ts` | 22 |
| `apps/api/src/services/export.service.ts` | NEW | — | 22 |
| `apps/api/src/services/publish.service.ts` | NEW | — | 22 |
| `apps/api/src/controllers/{export,publish,public}.controller.ts` | NEW | — | 22 |
| `apps/api/src/routes/{export,public}.route.ts` | NEW | — | 22 |
| `apps/api/src/config/rateLimiter.ts` | ADAPT | — | 22 |
| `apps/api/src/utils/cache/cache.ts` | ADAPT | — | 22 |
| `apps/api/src/scripts/bench.ts` | ADAPT | — | 22 |
| `apps/api/src/scripts/export-run.ts` | NEW | — | 22 |
| `apps/api/src/middleware/providerKey.ts` | ADAPT | `@pb-root/apps/api/src/middleware/providerKey.ts` | 23 |
| `apps/api/src/utils/scrubKeys.ts` | NEW | — | 23 |
| `apps/api/src/services/demo.service.ts` | ADAPT | `@pb-root/apps/api/src/services/tryIt.service.ts` | 23 |
| `apps/api/src/controllers/demo.controller.ts` | ADAPT | `@pb-root/apps/api/src/controllers/tryIt.controller.ts` | 23 |
| `apps/api/src/routes/demo.route.ts` | ADAPT | `@pb-root/apps/api/src/routes/tryIt.route.ts` | 23 |
| `apps/api/src/config/rateLimiter.ts` | ADAPT | — | 23 |
| `apps/api/src/constants/{appErrorCode,env}.ts` | ADAPT | — | 23 |
| `apps/api/src/app.ts` | ADAPT | — | 23 |
| `apps/api/src/scripts/sheet-to-jsonl.ts` | NEW | — | 24 |
| `apps/api/src/scripts/stratified-split.ts` | NEW | — | 24 |
| `apps/api/src/scripts/agreement.ts` | NEW | — | 24 |
| `apps/api/src/scripts/check-public.ts` | NEW | — | 24 |
| `apps/api/src/scripts/check-notebook.ts` | NEW | — | 25 |
| `apps/api/src/services/judge.service.ts` | NEW | — | 26 |
| `apps/api/src/jobs/queues/judge.queue.ts` | NEW | — | 26 |
| `apps/api/src/jobs/workers/judge.worker.ts` | NEW | — | 26 |
| `apps/api/src/jobs/processors/judge.processor.ts` | NEW | — | 26 |
| `apps/api/src/controllers/judge.controller.ts · routes/judge.route.ts` | NEW | — | 26 |
| `apps/api/src/scripts/handoff.ts` | NEW | — | 27 |
| `apps/api/src/scripts/playbook-dry-run.sh` | NEW | — | 27 |
| `apps/api/src/ai/providers/__fixtures__/{nvidia,openai,anthropic,gemini}/{ok,length,error}.json` | NEW | — | 28 |
| `apps/api/src/scripts/update-readme.ts` | NEW | — | 30 |

## apps/api/test

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/api/test/tenancy.routes.ts` | NEW | — | 10 |
| `apps/api/test/contract/importContracts.copy.ts` | COPY | `@pb-root/packages/types/src/importContracts.ts` | 27 |
| `apps/api/test/contract/playbookContract.int.test.ts` | NEW | — | 27 |
| `apps/api/test/contract/drift.test.ts` | NEW | — | 27 |
| `apps/api/test/globalSetup.ts` | ADAPT | `@pt-api/test/globalSetup.ts` | 28 |
| `apps/api/test/setupEnv.ts` | ADAPT | `@pt-api/test/setupEnv.ts` | 28 |
| `apps/api/test/helpers/app.ts` | COPY | `@pt-api/test/helpers/app.ts` | 28 |
| `apps/api/test/helpers/auth.ts` | ADAPT | `@pt-api/test/helpers/auth.ts` | 28 |
| `apps/api/test/helpers/db.ts` | ADAPT | `@pt-api/test/helpers/db.ts` | 28 |
| `apps/api/test/helpers/fakeLlm.ts` | ADAPT | `@pt-api/test/helpers/fakeLlm.ts` | 28 |
| `apps/api/test/helpers/queues.ts` | ADAPT | `@pt-api/test/helpers/queues.ts` | 28 |
| `apps/api/test/helpers/leakScan.ts` | NEW | — | 28 |
| `apps/api/test/tenancy.int.test.ts` | NEW | — | 28 |
| `apps/api/test/runner.int.test.ts` | NEW | — | 28 |
| `apps/api/test/prompts.int.test.ts` | NEW | — | 28 |
| `apps/api/test/protocol.int.test.ts` | NEW | — | 28 |
| `apps/api/test/publish.int.test.ts` | NEW | — | 28 |
| `apps/api/test/byok.int.test.ts` | NEW | — | 28 |

## apps/web

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `apps/web/README.md` | NEW | — | 00 |
| `apps/web/package.json` | ADAPT | `@pt-web/package.json` | 09 |
| `apps/web/next.config.ts` | ADAPT | `@pt-web/next.config.ts` | 09 |
| `apps/web/tsconfig.json` | COPY | `@pt-web/tsconfig.json` | 09 |
| `apps/web/postcss.config.mjs` | COPY | `@pt-web/postcss.config.mjs` | 09 |
| `apps/web/components.json` | COPY | `@pt-web/components.json` | 09 |
| `apps/web/eslint.config.mjs` | COPY | `@pt-web/eslint.config.mjs` | 09 |
| `apps/web/.env.example` | NEW | — | 09 |
| `apps/web/src/constants/env.ts` | COPY | `@pt-web/src/constants/env.ts` | 09 |
| `apps/web/src/utils/appError.ts` | COPY | `@pt-web/src/utils/appError.ts` | 09 |
| `apps/web/src/types/{index,api.types,auth.types,user.types,ui.types}.ts` | COPY | `@pt-web/src/types/` | 09 |
| `apps/web/src/lib/api.ts` | ADAPT | `@pt-web/src/lib/api.ts` | 09 |
| `apps/web/src/lib/queryClient.ts` | ADAPT | `@pt-web/src/lib/queryClient.ts` | 09 |
| `apps/web/src/lib/serverStatus.ts` | COPY | `@pt-web/src/lib/serverStatus.ts` | 09 |
| `apps/web/src/lib/errorMessage.ts` | COPY | `@pt-web/src/lib/errorMessage.ts` | 09 |
| `apps/web/src/lib/utils.ts` | COPY | `@pt-web/src/lib/utils.ts` | 09 |
| `apps/web/src/lib/google/` | COPY | `@pt-web/src/lib/google/` | 09 |
| `apps/web/src/store/{auth.store,server.store}.ts` | COPY | `@pt-web/src/store/` | 09 |
| `apps/web/src/api/{auth,session}.ts` | COPY | `@pt-web/src/api/` | 09 |
| `apps/web/src/hooks/auth/*.ts` | COPY | `@pt-web/src/hooks/auth/` | 09 |
| `apps/web/src/hooks/account/useAccountSessions.ts` | COPY | `@pt-web/src/hooks/account/useAccountSessions.ts` | 09 |
| `apps/web/src/components/ui/*` | COPY | `@pt-web/src/components/ui/` | 09 |
| `apps/web/src/components/common/{QueryDevtools,RouteFallback,ServerWakeNotice}.tsx` | COPY | `@pt-web/src/components/common/` | 09 |
| `apps/web/src/components/auth/{AuthLoader,RequireAuth,GuestOnly,GoogleSignInButton}.tsx` | COPY | — | 09 |
| `apps/web/src/components/layout/RoleGuard.tsx` | COPY | `@pt-web/src/components/layout/RoleGuard.tsx` | 09 |
| `apps/web/src/app/layout.tsx` | ADAPT | `@pt-web/src/app/layout.tsx` | 09 |
| `apps/web/src/app/providers.tsx` | COPY | `@pt-web/src/app/providers.tsx` | 09 |
| `apps/web/src/app/globals.css` | COPY | `@pt-web/src/app/globals.css` | 09 |
| `apps/web/src/app/page.tsx` | ADAPT | `@pt-web/src/app/page.tsx` | 09 |
| `apps/web/src/app/(public)/layout.tsx` | COPY | `@pt-web/src/app/(public)/layout.tsx` | 09 |
| `apps/web/src/app/(public)/{login,register,password/forgot}/page.tsx` | COPY | — | 09 |
| `apps/web/src/app/(public)/auth/verify/[token]/page.tsx` | COPY | — | 09 |
| `apps/web/src/app/(public)/password/reset/[token]/page.tsx` | COPY | — | 09 |
| `apps/web/src/app/(app)/layout.tsx` | ADAPT | `@pt-web/src/app/(app)/layout.tsx` | 09 |
| `apps/web/src/app/(app)/tasks/page.tsx` | NEW | — | 09 |
| `apps/web/src/app/(app)/account/page.tsx` | COPY | `@pt-web/src/app/(app)/account/page.tsx` | 09 |
| `apps/web/src/api/org.ts` | ADAPT | `@pt-web/src/api/org.ts` | 10 |
| `apps/web/src/store/org.store.ts` | COPY | `@pt-web/src/store/org.store.ts` | 10 |
| `apps/web/src/hooks/org/useCurrentOrg.ts` | ADAPT | `@pt-web/src/hooks/org/useCurrentOrg.ts` | 10 |
| `apps/web/src/lib/api.ts` | ADAPT | — | 10 |
| `apps/web/src/components/layout/OrgSwitcher.tsx` | ADAPT | `@pt-web/src/components/layout/OrgSwitcher.tsx` | 10 |
| `apps/web/src/app/(app)/layout.tsx` | ADAPT | — | 10 |
| `apps/web/src/app/(app)/settings/members/page.tsx` | ADAPT | `@pt-web/src/app/(app)/settings/members/page.tsx` | 10 |
| `apps/web/src/app/invites/page.tsx` | ADAPT | `@pt-web/src/app/invites/[token]/page.tsx` | 10 |
| `apps/web/package.json` | ADAPT | — | 19 |
| `apps/web/src/api/{task,example,prompt,model}.ts` | NEW | `@pt-web/src/api/document.ts` | 19 |
| `apps/web/src/hooks/tasks/{useTasks,useTask,useCreateTask,useUpdateTask}.ts` | NEW | — | 19 |
| `apps/web/src/hooks/examples/{useExamples,useUpdateExample,useImportExamples,useSecondLabel,useAgreement}.ts` | NEW | — | 19 |
| `apps/web/src/hooks/prompts/{usePrompts,useCreatePrompt,useUpdatePrompt,useNewPromptVersion,usePromptPreview}.ts` | NEW | — | 19 |
| `apps/web/src/hooks/models/useModels.ts` | NEW | — | 19 |
| `apps/web/src/lib/queryClient.ts` | ADAPT | `@pt-web/src/lib/queryClient.ts` | 19 |
| `apps/web/src/app/(app)/tasks/page.tsx` | NEW | — | 19 |
| `apps/web/src/app/(app)/tasks/[taskId]/page.tsx` | NEW | — | 19 |
| `apps/web/src/components/tasks/{TaskCard,NewTaskDialog,RulesTable,RuleEditor,SchemaViewer}.tsx` | NEW | — | 19 |
| `apps/web/src/components/examples/{ExamplesTable,ExampleSheet,ImportDialog,SecondLabelEditor,AgreementPanel,TagEditor}.tsx` | NEW | — | 19 |
| `apps/web/src/components/prompts/{PromptList,PromptEditor,PlaceholderChips,FewShotPicker,PromptPreview,FrozenBadge}.tsx` | NEW | — | 19 |
| `apps/web/src/components/common/JsonView.tsx` | NEW | — | 19 |
| `apps/web/src/api/run.ts` | NEW | — | 20 |
| `apps/web/src/hooks/runs/{useRuns,useRun,useEstimateRun,useCreateRun,useCancelRun,useRunEvents}.ts` | NEW | — | 20 |
| `apps/web/src/app/(app)/runs/page.tsx` | NEW | — | 20 |
| `apps/web/src/app/(app)/runs/[runId]/page.tsx` | NEW | — | 20 |
| `apps/web/src/app/(app)/tasks/[taskId]/page.tsx` | ADAPT | — | 20 |
| `apps/web/src/components/runs/{RunLauncher,GridSummary,CostEstimate,BudgetBar,TestRunCallout,RunProgress,RunStatusBadge,RunsTable}.tsx` | NEW | — | 20 |
| `apps/web/src/api/results.ts · hooks/results/{useRunSummary,useResults,useCompare,useRescore}.ts` | NEW | — | 21 |
| `apps/web/src/app/(app)/runs/[runId]/page.tsx` | ADAPT | — | 21 |
| `apps/web/src/app/(app)/runs/[runId]/errors/page.tsx` | NEW | — | 21 |
| `apps/web/src/app/(app)/runs/[runId]/compare/page.tsx` | NEW | — | 21 |
| `apps/web/src/components/results/{ResultsTable,MetricCell,TagFilter,StaleBanner,RunMeta}.tsx` | NEW | — | 21 |
| `apps/web/src/components/errors/{ErrorFilters,ErrorList,ResultCard,FieldScoreRow,RawOutput}.tsx` | NEW | — | 21 |
| `apps/web/src/components/compare/{CompareView,FieldDiffRow,RepeatTabs}.tsx` | NEW | — | 21 |
| `apps/web/src/hooks/useKeyboardNav.ts` | NEW | `@pt-web/src/app/(app)/documents/[id]/page.tsx` | 21 |
| `apps/web/src/app/r/[slug]/page.tsx` | NEW | — | 22 |
| `apps/web/src/app/r/[slug]/errors/page.tsx` | NEW | — | 22 |
| `apps/web/src/app/page.tsx` | ADAPT | — | 22 |
| `apps/web/src/components/results/{ExportMenu,PublishDialog}.tsx` | NEW | — | 22 |
| `apps/web/src/app/demo/page.tsx` | NEW | — | 23 |
| `apps/web/src/lib/providerKey.ts` | ADAPT | `@pb-root/apps/site/src/components/islands/TryIt.tsx` | 23 |
| `apps/web/src/components/demo/{KeyInput,DemoRunForm,DemoResults}.tsx` | NEW | — | 23 |
| `apps/web/src/components/results/CostAccuracyChart.tsx` | NEW | `@pt-web/src/app/(app)/quality/page.tsx` | 26 |
| `apps/web/src/components/results/FieldBars.tsx` | NEW | — | 26 |
| `apps/web/src/components/results/JudgePanel.tsx` | NEW | — | 26 |
| `apps/web/playwright.config.ts` | ADAPT | `@pt-web/playwright.config.ts` | 28 |
| `apps/web/e2e/global-setup.ts` | ADAPT | `@pt-web/e2e/global-setup.ts` | 28 |
| `apps/web/e2e/helpers/signup.ts` | COPY | `@pt-web/e2e/helpers/signup.ts` | 28 |
| `apps/web/e2e/fixtures/answers/*.json` | NEW | — | 28 |
| `apps/web/e2e/fixtures/postings.jsonl` | NEW | — | 28 |
| `apps/web/e2e/golden-path.spec.ts` | NEW | — | 28 |
| `apps/web/e2e/demo.spec.ts` | NEW | — | 28 |
| `apps/web/Dockerfile` | ADAPT | `@pt-web/Dockerfile` | 29 |

## .github

| Path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `.github/workflows/ci.yml` | ADAPT | `@pt-root/.github/workflows/ci.yml` | 29 |
| `.github/workflows/bench.yml` | ADAPT | `@pt-root/.github/workflows/eval.yml` | 29 |
| `.github/workflows/ci.yml` | ADAPT | — | 30 |

## Not copied

| Not copied | Why |
| --- | --- |
| Transactional outbox, webhooks, idempotency middleware, API keys | No external side effects to make atomic: starting a run enqueues after commit, and every cell job has a deterministic id, so a retried request can't double a run's results |
| PaperTrail's JSON repair (`modelJson.ts` repair retry) and cheap-model cascade | Prompt Lab **measures** raw model behaviour. Repairing output would hide exactly what valid-JSON % reports |
| Extraction cache | Benchmarks must call the model. The `replay` provider (recorded fixtures) covers tests and CI |
| Documents, PDF, storage, validators | Different domain |
| `utils/pii.ts` (PII masking) | Prompt Lab stores no customer contacts; postings are anonymised before import (Phase 24), and inputs are redacted from logs instead (Phase 02) |
| Quotas per page, fair-scheduling lanes | One kind of job; a per-workspace monthly budget + per-provider concurrency is enough |

## Path check

Every `@…/` source path cited in `docs/` (outside the archive) must exist. Run from the repo root:

```bash
#!/usr/bin/env bash
# docs/reference/copy-map.md: check every cited source path exists.
declare -A ROOT=(
  [@ec-root]=~/Code/e-commerce [@ec-api]=~/Code/e-commerce/apps/backends/mongo [@ec-web]=~/Code/e-commerce/apps/client
  [@pt-root]=~/Code/paper-trail [@pt-api]=~/Code/paper-trail/apps/api [@pt-web]=~/Code/paper-trail/apps/web
  [@pb-root]=~/Code/prompt-engineering-playbook [@eq-docs]=~/Code/ai-enquiry-assistant/docs
)
missing=0; checked=0
while IFS= read -r ref; do
  key=${ref%%/*}; rest=${ref#*/}; base=${ROOT[$key]:-}
  [ -z "$base" ] && continue
  case "$rest" in *...*|*\<*) continue ;; esac              # placeholders, not paths
  # strip trailing punctuation; keep a ")" that closes a "(" in the path, e.g. app/(public)
  while [[ "$rest" =~ [\),\;:.]$ ]]; do
    opens=${rest//[^(]/}; closes=${rest//[^)]/}
    [[ "$rest" == *")" && ${#opens} -ge ${#closes} ]] && break
    rest=${rest%?}
  done
  [ -z "$rest" ] && rest=.
  # expand {a,b} lists; escape ( ) [ ] so eval and globbing leave them literal
  esc=$(printf '%s' "$rest" | sed -e 's/[][()]/\\&/g')
  for p in $(eval "echo $base/$esc"); do
    checked=$((checked+1))
    if [[ "$p" == *"*"* ]]; then compgen -G "$p" >/dev/null && continue
    else [ -e "$p" ] && continue; fi
    echo "MISSING $ref → $p"; missing=$((missing+1))
  done
done < <(grep -rhoE '@(ec|pt|pb|eq)-[a-z]+/[^ `|]*' docs --include=*.md --exclude-dir=_archive-2026-10-24 | sort -u)
echo "checked $checked paths, missing $missing"
[ $missing -eq 0 ]
```
