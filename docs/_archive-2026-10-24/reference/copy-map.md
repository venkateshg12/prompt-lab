# Copy map

Every Prompt Lab file that comes from an existing project, its tag, and the phase that creates it.
Shorthands: see [architecture.md](architecture.md).

- **COPY**: byte-identical (`diff -q` prints nothing).
- **ADAPT**: start from the source and make only the changes the phase lists.
- **NEW**: written from scratch, with the full code in the phase.

## Root and packages

| Prompt Lab path | Tag | Source | Phase |
| --- | --- | --- | --- |
| `turbo.json`, `.gitignore`, `.prettierrc` | COPY | `@pt-root/` | 00 |
| `package.json`, `pnpm-workspace.yaml` | ADAPT (name) | `@pt-root/` | 00 |
| `docker-compose.yml` | ADAPT (no MinIO, container names) | `@pt-root/docker-compose.yml` | 00 |
| `Makefile` | ADAPT | `@pt-root/Makefile` | 00 |
| `packages/typescript-config/*`, `packages/eslint-config/*` | COPY | `@pt-root/packages/…` | 00 |
| `packages/types/{package.json,tsconfig.json}` | COPY | `@pt-root/packages/types/` | 00 |
| `packages/types/src/{api,cookie,objectId,pagination,user}.ts` | COPY | `@pt-root/packages/types/src/` | 01 / 03 / 04 |
| `packages/types/src/{task,example,prompt,model,run,result}.ts` | NEW | — | 10–17 |
| `packages/scoring/*` | NEW | — | 15 |

## apps/api: foundation (Phases 01–08)

| Prompt Lab path (`apps/api/`) | Tag | Source | Phase |
| --- | --- | --- | --- |
| `tsconfig.json`, `eslint.config.mjs`, `vitest.config.mts`, `vitest.integration.config.mts` | COPY | `@pt-api/` | 00 / 26 |
| `src/app.ts`, `src/index.ts` | ADAPT (routes list) | `@pt-api/src/` | 01 (grows) |
| `src/constants/env.ts` | ADAPT (only the vars Prompt Lab uses) | `@pt-api/src/constants/env.ts` | 01 (grows) |
| `src/constants/{https,appErrorCode,verificationLinkType}.ts` | COPY / ADAPT | `@pt-api/src/constants/` | 01 / 04 |
| `src/utils/errors/*`, `src/utils/api/*` | COPY | `@pt-api/src/utils/` | 01 |
| `src/middleware/{errorHandler,notFound,requestId}.ts` | COPY | `@pt-api/src/middleware/` | 01 / 02 |
| `src/utils/{logger,requestContext}.ts` | ADAPT (redact paths for BYOK keys) | `@pt-api/src/utils/` | 02 |
| `src/config/db.ts`, `src/utils/db/{transaction,cursor}.ts` | COPY | `@pt-api/src/` | 03 |
| `src/utils/date/*`, `src/utils/auth/{bcrypt,cookies,jwt,verificationToken}.ts` | COPY | `@pt-api/src/utils/` | 04 |
| `src/models/{user,session,verificationLink}.model.ts`, `src/types/*` (auth, session, user, verificationLink, express.d) | COPY / ADAPT | `@pt-api/src/` | 04 |
| `src/services/auth.service.ts` | ADAPT (no orgs: drop `createPersonalOrg`) | `@pt-api/src/services/auth.service.ts` | 04 |
| `src/controllers/{auth,session,googleAuth}.controller.ts`, `src/routes/{auth,session}.route.ts` | COPY / ADAPT | `@pt-api/src/` | 04 / 05 |
| `src/middleware/{authenticate,requireAdmin}.ts` | COPY | `@pt-api/src/middleware/` | 05 |
| `src/config/{redis,rateLimiter}.ts`, `src/constants/rateLimiter.constant.ts` | COPY / ADAPT (Prompt Lab limiters) | `@pt-api/src/` | 06 |
| `src/utils/rateLimiter/*`, `src/middleware/{rateLimiter,visitorId}.ts`, `src/types/rateLimiter.types.ts` | COPY | `@pt-api/src/` | 06 |
| `src/utils/cache/*` | ADAPT (domains) | `@pt-api/src/utils/cache/` | 07 |
| `src/jobs/{redis,queues/email.queue,producers/email.producer,workers/email.worker,processors/email.processor,dashboard}` | COPY / ADAPT | `@pt-api/src/jobs/` | 08 |
| `src/config/gmail.ts`, `src/services/gmail.service.ts`, `src/controllers/gmailAuth.controller.ts`, `src/routes/gmail.route.ts`, `src/utils/email/*` | COPY / ADAPT (branding) | `@pt-api/src/` | 08 |
| `src/worker.ts` | ADAPT | `@pt-api/src/worker.ts` | 08 (grows) |

## apps/api: model layer and runs (Phases 13–17)

| Prompt Lab path (`apps/api/`) | Tag | Source | Phase |
| --- | --- | --- | --- |
| `src/ai/reliability.ts` (+ its test) | COPY | `@pt-api/src/ai/reliability.ts` | 13 |
| `src/ai/errors.ts` | ADAPT (drop `SchemaViolation`; add `ProviderHttpError`) | `@pt-api/src/ai/errors.ts` | 13 |
| `src/ai/breakers.ts`, `src/ai/concurrency.ts` | COPY | `@pt-api/src/ai/` | 13 / 16 |
| `src/constants/llm.ts` | ADAPT (per-provider limits) | `@pt-api/src/constants/llm.ts` | 13 |
| `src/ai/types.ts` | ADAPT (`complete()` contract, not `generateJson`) | `@pt-api/src/ai/types.ts` | 13 |
| `src/ai/providers/openaiCompatible.ts` | ADAPT (raw text, no parsing) | `@pt-api/src/ai/providers/nvidia.ts` | 13 |
| `src/ai/providers/{anthropic,gemini}.ts` | NEW | — | 13 |
| `src/ai/providers/{fake,replay}.ts` | ADAPT (text instead of JSON) | `@pt-api/src/ai/providers/` | 13 |
| `src/utils/cost.ts` | ADAPT (prices from the model document, not a constant) | `@pt-api/src/utils/cost.ts` | 13 |
| `src/utils/events/{pubsub,sse,streamLimiter}.ts` | ADAPT (channel per owner / run) | `@pt-api/src/utils/events/` | 16 |
| `test/{globalSetup,setupEnv}.ts`, `test/helpers/{app,auth,queues}.ts` | ADAPT | `@pt-api/test/` | 26 |

## apps/web (Phases 09, 18–22)

| Prompt Lab path (`apps/web/`) | Tag | Source | Phase |
| --- | --- | --- | --- |
| `package.json`, `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `components.json` | ADAPT (name) / COPY | `@pt-web/` | 09 |
| `src/app/{layout,providers}.tsx`, `src/app/globals.css` | ADAPT (branding) / COPY | `@pt-web/src/app/` | 09 |
| `src/app/(public)/**` (login, register, password, verify) | ADAPT (branding) | `@pt-web/src/app/(public)/` | 09 |
| `src/app/(app)/layout.tsx`, `src/app/(app)/account/page.tsx` | ADAPT (no org switcher) | `@pt-web/src/app/(app)/` | 09 |
| `src/lib/{api,queryClient,serverStatus,utils}.ts` | ADAPT (no `X-Org-Id`; user-scoped keys) / COPY | `@pt-web/src/lib/` | 09 |
| `src/lib/google/*` | COPY | `@pt-web/src/lib/google/` | 09 |
| `src/store/{auth,server}.store.ts` | COPY | `@pt-web/src/store/` | 09 |
| `src/types/{api,auth,ui,user}.types.ts`, `src/utils/appError.ts`, `src/constants/env.ts` | COPY | `@pt-web/src/` | 09 |
| `src/components/ui/*` | COPY | `@pt-web/src/components/ui/` | 09 |
| `src/components/common/*`, `src/components/auth/*`, `src/components/layout/RoleGuard.tsx` | COPY / ADAPT (copy text) | `@pt-web/src/components/` | 09 |
| `src/api/{auth,session}.ts`, `src/hooks/auth/*` | COPY | `@pt-web/src/` | 09 |

## Not copied

| From PaperTrail | Why not |
| --- | --- |
| orgs, memberships, `tenantPlugin`, `resolveOrg`, `requireOrgRole`, invites, `OrgSwitcher` | single-owner workspaces (Phase 10 explains) |
| documents, pages, uploads, storage, PDF, MinIO | inputs are text in the database |
| `generateJson`, `modelJson.ts` repair, `SchemaViolation`, prompts registry | Prompt Lab measures raw output and never repairs it |
| outbox, webhooks, API keys, idempotency keys, OpenAPI | out of scope; no external integrators |
| Langfuse/Sentry | optional later; results and raw outputs already live in Mongo |
