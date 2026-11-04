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

_(add as you go)_
