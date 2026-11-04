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

_(add as you go)_
