# Lessons

One entry per correction or surprise: **pattern → rule that prevents it**.

## Carried over from PaperTrail (read its `tasks/lessons.md` too)

- `dotenv/config` resolves `.env` from `process.cwd()` → keep the same `.env` reachable from the
  root and from `apps/api`.
- Reading `process.env.*` outside `constants/env.ts` trips Turbo's undeclared-env lint → route all
  env access through `getEnv`.
- Schema problems must never trigger blind retries → in Prompt Lab they are not even repaired:
  they are scored.
- Integer micro-dollars for cost → no float drift across thousands of calls.
- A random `jobId` deduplicates nothing → derive it from the work (`call:<run>:<prompt>:<model>:<example>:<repeat>`).
- Status and enqueue are two writes → make the run job idempotent and let the fan-out recover itself.
- Argument parsers that use `args[args.indexOf(flag) + 1]` read `args[0]` when the flag is absent →
  check `index !== -1` first.
- Mongoose `Document` has a built-in `model()` method → don't put a field named `model` on an
  interface that extends `Document`; use a plain attributes interface.

## Prompt Lab

- **Logging (Phase 02):** log `runId`, `jobId`, `variantId`, `exampleId` (the ref, e.g. `jp_017`), statuses, scores, counts and durations; **never** an input, an output, a rendered prompt or a key. The redact list is the backstop, not the rule.
- **Prisma with zero models (Phase 03):** `generate` works, but the copied tenant extension's `$allModels` callback types collapse to `never`, so `tsc` fails in `src/db/prisma.ts` until the first model exists. Do not patch the COPY file: Phase 03 is 🟡 on typecheck until Phase 04's models land.
- **`pnpm db:migrate:dev --name x` (Phase 04):** pnpm appends extra args to the *end* of the script string, so with `prisma migrate dev && prisma generate` the `--name` went to `generate` and `migrate dev` hung on a name prompt. The script is now `sh -c 'prisma migrate dev "$@" && prisma generate' --`. Never `pkill -f <pattern>` from the tool shell: its own command line matches and it kills itself (exit 144); find the pid by port with `ss -ltnp`.
- **Cache probes (Phase 07):** the cache client is lazy and not `ready` for a few ms after the first call; a script asserting cache behaviour must `ping()` then wait ~400 ms. `utils/cache/cache.ts` (COPY) still uses `console.warn` for breaker/outage notices; leave it, since it must stay a COPY.
- **Web (Phase 09):** Next **16.4.5** builds the copied code unchanged (Turbopack). `globals.css` imports `shadcn/tailwind.css`, so `shadcn` must be a dependency (the guide's install list omitted it). `USER_SCOPED_KEYS` omits `profile` on purpose, as PaperTrail documents (AuthLoader keeps an observer on it; removing it re-fires the query), although the guide lists it. The default landing path after login is `/tasks` (edited in `useLogin`, `useGoogleLogin`, `GuestOnly`, verify page); everything else under `hooks/auth` is a COPY.
- **TanStack Table 9 (for Phases 19–21):** `useTable` (not `useReactTable`); a required `features: tableFeatures({...})` kept at module scope; row models are feature slots (`sortedRowModel: createSortedRowModel()`), no `getCoreRowModel`; `sortFns` (not `sortingFns`); `<table.FlexRender />`. Most examples online are v8: translate, don't mix.
- **E2E (Phase 09):** a suite signing up >5 users from 127.0.0.1 trips the verify-link limiter (5 / 5 min, punitive). `e2e/helpers/rateLimits.ts` clears the `rl:*` counters (never the rules) in `beforeEach`. The E2E API uses its own database `promptlab_e2e`. Run with `pnpm --filter web e2e`.
- **turbo UI:** `pnpm dev -- --ui=stream` forwards the flag to the apps; use `TURBO_UI=false pnpm dev`.
- **Dev mailbox log (Phase 10):** the copied dev fallback logged the whole email body, so every invite/verify/reset token reached the dev logs. The body is never logged; read links from `/auth/dev/latest-link`. Grep logs for a token after any phase that emails one.
- **Workspaces (Phase 10):** `org.store.ts` persists under `promptlab-org-store` (PaperTrail's `papertrail-org-store` would collide on a shared `localhost:3000` origin); the only edit to that COPY. The pending invitation token is kept in `localStorage` for 1 h (not `sessionStorage`) because the verification link opens in another tab. Browser-cookie API calls in Playwright must use `localhost:5000`, not `127.0.0.1` (cookie host). The `INVITABLE` role cap runs *after* the invite rate limiters, so a refused (403) invite still counts toward the 3/day-per-address limit.
- **jsonb reorders keys (Phase 11):** PostgreSQL `jsonb` does not keep object key order, so `JSON.stringify(stored) === JSON.stringify(file)` is false for equal values. Compare and hash JSON only through `utils/stableJson.ts` (`sameJson`, `stableStringify`); the importer reported "updated" on every run and a no-op PATCH bumped the task version until this was fixed. Phase 12's `datasetHash` and any snapshot comparison must use it too.
- **Vitest (Phase 13):** added to `apps/api` early (`vitest.config.mts`, `pnpm --filter api test`) so the renderer and Phase 03's tenant-scope tests run; Phase 28 extends it with the integration project. `fieldsList` lives once, in `@repo/types` (the web preview and the renderer share it).
- **Phase 13 vs 15 conflicts (resolved):** (1) the renderer moved to `@repo/scoring` (`renderPrompt({prompt,task,input,fewShots})`, `renderTemplate`); the API's `prompts/render.ts` only re-exports it. (2) token budgets stay `MAX_TOKENS_BY_TECHNIQUE` (800 / cot 2000 / custom 1200) from `@repo/types`, not Phase 15's 600/1500. (3) `promptBodySchema` allowed examples only with `{{examples}}`, which made Phase 15's multi-turn few-shot unsaveable: now `few_shot` may omit the placeholder. (4) `v2-few-shot.md` lives in `prompts/drafts/` until Phase 25 picks its dev refs (the importer refuses a few_shot prompt whose examples don't exist).
- **Provider docs (Phase 15):** Gemini's current structured output is `generationConfig.responseFormat.text = { mimeType: "APPLICATION_JSON", schema }` (the Phase 14 adapter used the older `responseMimeType`/`responseJsonSchema`; fixed). Anthropic `output_config.format` confirmed. Tests are excluded from `packages/scoring`'s build (else tsc emits them into `dist` and Vitest picks them up there).
- **Rate limits are waiting, not failing (Phase 17):** the copied RPM budget / lease throws `ProviderBusy`, and a big benchmark run is *normally* at its per-minute budget. So `assertRpmBudget` runs BEFORE the breaker, a busy lease is returned as a value (never a breaker failure), and `processRunCell` re-delays the job (`job.moveToDelayed` + `DelayedError`) without using an attempt, for up to 2 h. Otherwise a 1,000-cell run on a 40 rpm model turns most cells into error cells after ~75 s.
- **Stale stub on a port (Phase 17):** Playwright's `reuseExistingServer` accepted a leftover scratch stub on :5997 because it answered anything with 200, and the first run "passed" for the wrong reason (garbage outputs). Kill scratch servers when done, and give stubs a distinctive health response. `ss -ltnp | grep :PORT` first.
- **Run.updatedAt (Phase 17):** data-model.md had no timestamp for the stale-run sweeper; `Run.updatedAt @updatedAt` was added (and the doc updated). `OWNER_RUNS_REQUIRE_ADMIN` reads the role live from the database, not from the token.
- **DLQ only gets what a cell couldn't record:** classified failures become `error` results and the job completes; only unrecordable failures reach `dead-letter-queue`, after `onFinalFailure` writes the error result so the run still finishes. Replay deletes that result and takes it back out of the counters in one transaction.

_(add as you go)_
