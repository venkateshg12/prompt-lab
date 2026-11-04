# Phase 28 — Tests: Vitest, Supertest, Testcontainers, Playwright

## 1. Goal

Turn every promise the README makes into a test that goes red when the promise breaks:

- **unit** (Vitest): extend Phase 16's table tests for `@repo/scoring` with **property tests**
  (fast-check), and test the provider adapters against recorded HTTP responses;
- **integration** (Vitest + Supertest on `createApp()` + Testcontainers **PostgreSQL 17** + Redis, the
  `fake` provider, workers in-process): tenancy, exactly-once cells, retry-without-repair, frozen
  prompts, dev-only few-shot, the test-reuse flag, the budget stop, published-page privacy, the BYOK
  leak scans, and the Playbook export contract;
- **E2E** (Playwright, `fake` provider with recorded answers): sign up → task → import → prompts →
  run → results → error browser → export → publish, in a real browser against the real API.

No test spends money: CI never sees a provider key.

## 2. What I will understand after this phase

1. Which claim each test protects, and which interview answer depends on it.
2. Why integration tests run against the **same migrations** a deploy applies, not a mocked Prisma.
3. How to make a queue-driven run deterministic without `sleep`.
4. How to prove a negative ("the key is never stored") by scanning every place it could be.
5. What a property test finds that a table test doesn't.

## 3. Prerequisites

- Phases 00–27 done (Phase 27's contract test exists; this phase wires it into the suite).
- Docker running (Testcontainers starts its own Postgres and Redis; the compose stack is only for E2E).
- `pnpm --filter @repo/scoring test` and `pnpm --filter api test` already green from earlier phases.

## 4. Files

```
packages/scoring/
├── src/__tests__/properties.test.ts                 NEW   (fast-check invariants)
└── package.json                                     ADAPT (+ devDependency fast-check)
apps/api/
├── vitest.config.mts                                COPY  @pt-api/vitest.config.mts
├── vitest.integration.config.mts                    COPY  @pt-api/vitest.integration.config.mts
├── test/globalSetup.ts                              ADAPT @pt-api/test/globalSetup.ts     (database name only)
├── test/setupEnv.ts                                 ADAPT @pt-api/test/setupEnv.ts        (no S3/webhook vars; LLM + bench vars)
├── test/helpers/app.ts                              COPY  @pt-api/test/helpers/app.ts
├── test/helpers/auth.ts                             ADAPT @pt-api/test/helpers/auth.ts    (email domain, workspace wording)
├── test/helpers/db.ts                               ADAPT @pt-api/test/helpers/db.ts      (seedTask / seedExamples / seedPrompts / seedModel)
├── test/helpers/fakeLlm.ts                          ADAPT @pt-api/test/helpers/fakeLlm.ts (job-posting answers)
├── test/helpers/queues.ts                           ADAPT @pt-api/test/helpers/queues.ts  (waitForRun, run-cell / run-finalize queues)
├── test/helpers/leakScan.ts                         NEW   (scan Postgres, Redis and captured logs for a string)
├── test/tenancy.int.test.ts                         NEW
├── test/runner.int.test.ts                          NEW   (exactly-once, retries, no repair, errors excluded)
├── test/prompts.int.test.ts                         NEW   (frozen, dev-only few-shot)
├── test/protocol.int.test.ts                        NEW   (test-reuse flag, budget stop)
├── test/publish.int.test.ts                         NEW
├── test/byok.int.test.ts                            NEW
├── test/playbookContract.int.test.ts                    (Phase 27, unchanged; now part of `test:int`)
└── src/ai/providers/__fixtures__/{nvidia,openai,anthropic,gemini}/{ok,length,error}.json   NEW
apps/web/
├── playwright.config.ts                             ADAPT @pt-web/playwright.config.ts   (no MinIO/S3/webhooks)
├── e2e/global-setup.ts                              ADAPT @pt-web/e2e/global-setup.ts
├── e2e/helpers/signup.ts                            COPY  @pt-web/e2e/helpers/signup.ts
├── e2e/fixtures/answers/*.json                      NEW   (recorded model answers for 5 postings)
├── e2e/fixtures/postings.jsonl                      NEW   (5 examples, case-line format)
├── e2e/golden-path.spec.ts                          NEW
└── e2e/demo.spec.ts                                 NEW   (BYOK page against a stub provider)
```

Dependencies:

```bash
pnpm --filter @repo/scoring add -D fast-check
pnpm --filter api add -D vitest supertest @types/supertest testcontainers @testcontainers/postgresql @testcontainers/redis
pnpm --filter web add -D @playwright/test && pnpm --filter web exec playwright install chromium
```

Use the versions PaperTrail pins for `vitest`, `supertest` and `testcontainers` (`@pt-api/package.json`),
so the COPY configs behave the same.

## 5. Concepts

**Claims → tests.** Every row is a sentence from the README or an interview answer.

| Claim | Test | File |
| --- | --- | --- |
| Scores follow the written rules, for every input | property tests (below) + Phase 16 table tests | `properties.test.ts` |
| Broken JSON is measured, never repaired | fake answer `Sure! {"title": "x",` → `validJson: false`, `rawOutput` byte-identical, one provider call | `runner.int` |
| Retries are only for transport errors | fake 429, 429, then OK → 1 result, `attempts: 3`; fake 400 → `status: error` immediately, 1 call | `runner.int` |
| A cell is counted once, even if enqueued twice | enqueue every cell job twice, with the same deterministic id → `doneCells = totalCells`, `COUNT(results) = totalCells` | `runner.int` |
| Errors are excluded from accuracy, but listed | 1 error cell of 10 → summary `n = 9`, `errors = 1` | `runner.int` |
| A prompt used by a run can't change | `PATCH` a frozen version → 409; a new edit creates `@2` | `prompts.int` |
| Few-shot comes only from dev | a test-split example in `fewShotExampleIds` → 400 | `prompts.int` |
| Re-running test is visible | second test-split run of the same task → `testReused: true`, and the export line carries it | `protocol.int` |
| A workspace can't overspend | budget set below one cell's cost → run stops `failed` with reason `budget_reached`, no further provider calls | `protocol.int` |
| Workspaces can't see each other | user B → every route with A's task/run/result/prompt ids → 404 (never 403: no existence leak) | `tenancy.int` |
| Published pages hide what they should | `publicInput: false` → no `input`, no `rawOutput`; no owner email/name anywhere in the payload | `publish.int` |
| A visitor's key is never stored, logged or queued | after `/demo/run` with key `nvapi-TEST…`, `leakScan(key)` finds 0 hits in every table, every Redis key, the captured logs | `byok.int` |
| The owner's key is never used for the demo | `NVIDIA_API_KEY` set, no `X-Provider-Key` → 400, fake provider call count unchanged | `byok.int` |
| Exports match the Playbook importer | Phase 27's contract test | `playbookContract.int.test` |

**Property tests.** A table test checks the cases you thought of. A property states something true
for *every* input and lets fast-check search for a counterexample:

```ts
// packages/scoring/src/__tests__/properties.test.ts
import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { setScores, scoreMoney, normalizeText, scoreOutput } from "../index";
import { jobPostingRules } from "./fixtures";

const money = fc.record({
  min: fc.integer({ min: 1, max: 5_000_000 }),
  max: fc.integer({ min: 1, max: 5_000_000 }),
  currency: fc.constantFrom("INR", "USD"),
  period: fc.constantFrom("year", "month", "week", "day", "hour"),
});

describe("scoring invariants", () => {
  it("text normalisation is idempotent", () =>
    fc.assert(fc.property(fc.string(), (s) => normalizeText(normalizeText(s)) === normalizeText(s))));

  it("set F1 is between 0 and 1, symmetric, and 1 on identical sets", () =>
    fc.assert(
      fc.property(fc.array(fc.string()), fc.array(fc.string()), (a, b) => {
        const ab = setScores(a, b).score;
        expect(ab).toBeGreaterThanOrEqual(0);
        expect(ab).toBeLessThanOrEqual(1);
        expect(ab).toBeCloseTo(setScores(b, a).score, 10);
        expect(setScores(a, a).score).toBe(1);
      })
    ));

  it("the same salary written per month or per year scores 1", () =>
    fc.assert(
      fc.property(fc.integer({ min: 1_000, max: 500_000 }), (perMonth) => {
        const monthly = { min: perMonth, max: perMonth, currency: "INR", period: "month" };
        const yearly = { min: perMonth * 12, max: perMonth * 12, currency: "INR", period: "year" };
        expect(scoreMoney(yearly, monthly)).toBe(1);
      })
    ));

  it("overall is a mean of field scores in [0,1], and deterministic", () =>
    fc.assert(
      fc.property(fc.string(), fc.record({ stipend_or_salary: fc.option(money) }), (raw, expected) => {
        const a = scoreOutput(jobPostingRules, raw, expected);
        const b = scoreOutput(jobPostingRules, raw, expected);
        expect(a).toEqual(b);
        if (a.overallScore !== null) expect(a.overallScore).toBeGreaterThanOrEqual(0);
      })
    ));
});
```

Names (`setScores`, `scoreMoney`, `normalizeText`, `scoreOutput`) are Phase 16's exports. If yours
differ, the phase-16 names win. When a property fails, fast-check prints the smallest counterexample:
add it to Phase 16's table as a named case, then fix the scorer.

**Deterministic queue tests.** Workers run in-process against the container Redis. Each test file gets
its own BullMQ `prefix` (`test-<file>-<random>`), so files never see each other's jobs. Backoff is
shortened by env (`CELL_BACKOFF_MS=20`). `waitForRun(runId, "completed")` polls Postgres through
`runAsSystem()` every 100 ms up to 15 s. It never sleeps a fixed time.

**Proving a negative.** "The key is never stored" can only be tested by looking everywhere it could be:

```ts
// apps/api/test/helpers/leakScan.ts
import { prisma } from "../../src/db/prisma";
import { getQueueRedis } from "../../src/config/redis";

/** Every (table, column) of a text-like type in the public schema. */
const textColumns = () =>
  prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND data_type IN ('text', 'character varying', 'jsonb', 'json', 'ARRAY')`;

export async function leakScan(needle: string, logLines: string[]) {
  const hits: string[] = [];
  for (const { table_name, column_name } of await textColumns()) {
    // Identifiers come from information_schema, not user input; the needle is a bound parameter.
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM "${table_name}" WHERE "${column_name}"::text LIKE '%' || $1 || '%'`,
      needle
    );
    if (rows[0].n > 0n) hits.push(`postgres ${table_name}.${column_name}`);
  }
  const redis = getQueueRedis();
  for await (const keys of redis.scanStream({ count: 500 })) {
    for (const key of keys as string[]) {
      if (key.includes(needle)) hits.push(`redis key ${key}`);
      const type = await redis.type(key);
      const dump =
        type === "string" ? await redis.get(key)
        : type === "hash" ? JSON.stringify(await redis.hgetall(key))
        : type === "list" ? JSON.stringify(await redis.lrange(key, 0, -1))
        : "";
      if (dump?.includes(needle)) hits.push(`redis value ${key}`);
    }
  }
  logLines.forEach((line, i) => line.includes(needle) && hits.push(`log line ${i}`));
  return hits;
}
```

Logs are captured through Phase 02's swappable destination (`setLogDestination(stream)` in
`utils/logger.ts`): the test pushes every line into an array. Run the same scan against the cache Redis
(`getCacheRedis()`) as well.

**Adapter tests without the network.** Each adapter has three recorded responses (success, a
length/`max_tokens` stop, an error body). `vi.stubGlobal("fetch", …)` returns them. Each test asserts
the **request** shape (headers, structured-output fields per provider, from `providers.md`) and the
parsed `CompleteResult`. A provider API change means re-recording one fixture, not rewriting tests.

## 6. Steps

1. **Configs.** Copy the two Vitest configs. `globalSetup.ts`: change only the database name
   (`.withDatabase("promptlab_test")`); it already runs `prisma migrate deploy` against the container,
   which also proves the committed migrations apply to an empty database.
2. **`setupEnv.ts`.** Start from PaperTrail's, delete the S3 and webhook variables, and set:
   ```ts
   process.env.LLM_PROVIDER = "fake";
   process.env.NVIDIA_API_KEY = "test-owner-key-must-never-be-used";
   process.env.CELL_BACKOFF_MS = "20";
   process.env.RUN_WORKERS_IN_API = "true";
   process.env.MODELS_SEED = "test";        // registry with fake:* models only (Phase 14)
   process.env.DATABASE_URL ||= "postgresql://promptlab:promptlab@127.0.0.1:5432/promptlab_test";
   ```
3. **Helpers.** `auth.ts` keeps `createActorWithRole(role)` (a workspace member with a signed-in agent).
   `db.ts` gains `seedTask(orgId, rules)`, `seedExamples(task, { dev, test, tags })`,
   `seedPrompts(task, ["v1-zero-shot", "v2-few-shot"])`, `seedModel("fake:json")`, all through
   `asSystem`. `queues.ts` gains `waitForRun`, `requeueAllCells(runId)` and `clearQueues()` for the
   `run-cell`, `run-finalize` and `dead-letter` queues.
4. **`runner.int.test.ts`.** The exactly-once test:
   ```ts
   it("counts each cell once when every job is enqueued twice", async () => {
     const owner = await createActorWithRole("owner");
     const { task, prompts } = await seedCaseStudy(owner.org.id, { dev: 5 });
     fakeLlm.alwaysReturn(validPostingJson);
     const { body } = await owner.agent
       .post(`/orgs/${owner.org.id}/runs`)
       .send({ taskId: task.id, promptVersionIds: [prompts.v1.id], modelKeys: ["fake:json"], split: "dev", repeats: 2 })
       .expect(201);
     await requeueAllCells(body.data.id);                 // same deterministic ids → BullMQ dedupes
     const run = await waitForRun(body.data.id, "completed");
     expect(run.doneCells).toBe(10);
     expect(await asSystem(() => prisma.result.count({ where: { runId: run.id } }))).toBe(10);
   });
   ```
   Add a second variant that bypasses BullMQ's dedupe (calls `runCell()` twice for one cell) and expects
   the `Result` unique index to keep one row: the database is the second lock.
5. **The other integration files**, one per row group of the table in §5.
6. **Adapter fixtures and tests**, 4 adapters × 3 responses.
7. **Property tests** in `packages/scoring`.
8. **Playwright.** Adapt PaperTrail's config: drop the S3, MinIO and webhook variables, set
   `LLM_PROVIDER=fake`, `FAKE_LLM_FIXTURES=e2e/fixtures/answers`, database `promptlab_e2e`, blank every
   provider key and every `GMAIL_*` (dev mail goes to the in-memory dev mailbox the signup helper reads).
   `golden-path.spec.ts`:
   1. sign up and verify (`signupAndVerify`);
   2. create a workspace and the job-postings task (paste `cases/job-postings/task.json`);
   3. import `e2e/fixtures/postings.jsonl` (5 rows: 3 dev, 2 test);
   4. create `v1-zero-shot`;
   5. start a dev run on `fake:json` with 1 repeat and watch the SSE progress bar reach 3/3;
   6. the results table shows one row; click the salary column;
   7. the error browser shows the recorded wrong salary with its reason chip;
   8. "Copy Markdown" contains the row; download `results.jsonl` and parse every line with the Playbook
      schema copy from Phase 27;
   9. publish; open `/r/<slug>` in a fresh context (signed out): table visible, no owner email.

   `demo.spec.ts`: `/demo` without a key shows the inline error. With a key, against a stub provider
   route (`page.route("**/v1/chat/completions", …)` on the API's base URL is not possible from the
   browser, so the API's `NVIDIA_BASE_URL` points at a tiny local stub server started in
   `global-setup.ts`), results show. Reload: the key field is empty unless "remember for this tab" was
   ticked.
9. **Scripts.** `apps/api/package.json`: `"test": "vitest run"`, `"test:int": "vitest run --config
   vitest.integration.config.mts"`. `apps/web/package.json`: `"e2e": "playwright test"`.

## 7. Verify

```bash
pnpm --filter @repo/scoring test        # table + property tests, all green
pnpm --filter api test                  # unit: adapters, renderer, DSL, export formatting
pnpm --filter api test:int              # starts postgres:17-alpine + redis:7-alpine, applies migrations
# [globalSetup] … ✓ Migrations applied … Test Files  8 passed
docker compose up -d --wait postgres redis redis-cache
pnpm --filter web e2e                   # 2 specs passed (chromium)
```

Break each promise on purpose and watch the right test fail, then revert:

| Break | Test that must fail |
| --- | --- |
| `runCell` writes with `create` instead of the unique-index-safe upsert | exactly-once |
| the extractor "closes the brace" on truncated JSON | never repaired |
| the demo falls back to `NVIDIA_API_KEY` | owner key never used |
| the logger redaction list loses `x-provider-key` | leak scan (log line hit) |
| `getRun` uses `runAsSystem` without an `orgId` filter | tenancy |
| the public projection includes `input` | published privacy |
| `scoreMoney` converts `week × 4` instead of `× 52` | property: month/year equivalence (and Phase 16 table) |

## 8. Definition of done

- [ ] Every row in §5's table has a passing test, and each was seen failing once (the table above).
- [ ] Property tests run in `@repo/scoring` and any counterexample found was added to Phase 16's table.
- [ ] Integration tests run against migrations applied by `prisma migrate deploy` on Postgres 17.
- [ ] The leak scan covers every text/jsonb column, both Redis instances and the captured logs.
- [ ] Adapter tests use recorded fixtures only; no network in unit or integration tests.
- [ ] Playwright golden path and demo specs pass twice in a row (no flakes).
- [ ] `tracker.md` updated; commit `test: unit, property, integration and e2e suites`.

## 9. Interview angle

*"How do you know your benchmark tool is correct?"* The scorer has table tests for every rule and
property tests that search for counterexamples, like "the same salary written monthly or yearly must
score 1". Every reliability claim has an integration test against real PostgreSQL and Redis: a cell is
counted once even when it's enqueued twice, because the job id is deterministic and the results table
has a unique index; broken JSON is recorded, never repaired; workspaces can't read each other's runs.
For the bring-your-own-key demo I don't just check one table: a helper scans every text column, every
Redis key and every log line for the key and expects zero hits. And I broke each promise once on
purpose to see its test fail.
