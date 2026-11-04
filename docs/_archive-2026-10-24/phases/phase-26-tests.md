# Phase 26 — Tests: unit, integration, E2E

## 1. Goal

Prove the claims with automated tests, reusing PaperTrail's harness:
- **unit**: `@repo/scoring` (Phase 15, already 100 % branches), the field-rule DSL, the renderer,
  provider schema converters, the importers, aggregation, the Markdown export, the provider adapters
  (against recorded HTTP responses);
- **integration** (Vitest + Supertest on `createApp()` + Testcontainers Mongo replica set + Redis, fake
  provider): run lifecycle, idempotency, error cells, cancel, re-score, ownership isolation, BYOK
  safety, published-page privacy;
- **E2E** (Playwright): sign in → import → run → results → error browser → export, against the compose
  stack with the fake provider.

## 2. What I will understand after this phase

1. Which claims each test protects (the spec's interview answers depend on them).
2. How to test provider adapters without calling providers (recorded fixtures).
3. How to make a queue-driven run deterministic in a test.

## 3. Prerequisites

Phase 25 done (or skipped).

## 4. Files

```
apps/api/
├── vitest.config.mts · vitest.integration.config.mts      COPY  @pt-api/
├── test/globalSetup.ts · test/setupEnv.ts                  ADAPT @pt-api/test/   (no MinIO; LLM_PROVIDER=fake)
├── test/helpers/{app,auth,queues}.ts                       ADAPT @pt-api/test/helpers/
├── test/helpers/fixtures.ts                                NEW   (task, examples, prompts, models factory)
├── test/{runs,idempotency,ownership,byok,publish,rescore}.int.test.ts   NEW
└── src/ai/providers/__fixtures__/*.json                    NEW   (recorded provider responses)
apps/web/
├── playwright.config.ts                                    NEW
└── e2e/{golden-path,byok}.spec.ts                          NEW
```

## 5. Concepts

**Claims → tests.**

| Claim | Test |
| --- | --- |
| Scores follow the written rules | `@repo/scoring` table tests (Phase 15) |
| Broken JSON is measured, never repaired | adapter returns prose + JSON → `validJson: false`, `rawOutput` verbatim |
| A run can't double-count | kill-and-restart simulation: process half the cells, re-add all jobs, finish → counters = total, no duplicate results |
| Retries only for transport errors | fake 429 ×2 → success; fake 400 → immediate error cell |
| Errors are excluded from accuracy, but shown | run with 1 error cell → aggregate n and errors correct |
| Prompts used by runs are immutable | PATCH a frozen prompt → 409 |
| Few-shot from dev only | test example id → 400 |
| Re-score makes no model calls | fake provider call count unchanged after rescore |
| Owners can't see each other's data | user B → user A's task/run/result ids → 404 on every route |
| BYOK never uses the server key and never stores the key | env key set, no header → 400 and 0 provider calls; with a header → 0 rows written, 0 jobs; log capture contains no key |
| Published pages hide what they should | `publicInputs: false` → no input and no raw output in public responses |

**Adapter tests without the network.** Each adapter gets 3 recorded responses (success,
`max_tokens`/length stop, error JSON) saved as fixtures. `fetch` is stubbed (`vi.stubGlobal("fetch", …)`)
to return them, and the test asserts the request body shape (structured fields per provider) and the
parsed `CompleteResult`. When a provider changes its API, you re-record one fixture.

**Deterministic runs in tests.** Workers run in-process against the container Redis, with each test
file using a unique BullMQ prefix. `waitForRun(runId, "completed")` polls Mongo; it never sleeps.
Backoff delays are shortened by env (`CELL_BACKOFF_MS=20`).

## 6. Steps

1. Copy PaperTrail's Vitest configs and test helpers; remove MinIO from `globalSetup`; set
   `LLM_PROVIDER=fake`, `MODELS_SEED=test` (registry with fake models only) in `setupEnv`.
2. `fixtures.ts`: `makeOwner()`, `seedTask(owner, rules)`, `seedExamples(task, n, split)`,
   `seedPrompts(task, techniques)`, with the fake model registered.
3. Write the integration tests in the table. Example:

```ts
it("a run survives a crash without double counting", async () => {
    const { agent, task, prompts } = await setupOwnerWithTask({ examples: 10 });
    fakeLlm.alwaysReturn('{"title":"x", …}');
    const { body } = await agent.post("/runs").send({ taskId: task.id, promptIds: [prompts.v1], modelKeys: ["fake:text"], split: "dev", repeats: 2 }).expect(201);
    await waitForCells(body.data.id, 10);                       // half done
    await cellQueue.pause(); await requeueAllCells(body.data.id); await cellQueue.resume();   // simulate a re-run fan-out
    const run = await waitForRun(body.data.id, "completed");
    expect(run.totals.completed).toBe(20);
    expect(await ResultModel.countDocuments({ runId: body.data.id })).toBe(20);
});
```

4. Adapter unit tests with fixtures, for the 4 adapters × 3 responses.
5. Playwright `golden-path.spec.ts`:
   1. sign up through the dev-mode email log;
   2. create a task from the case-study rules;
   3. import 5 JSONL examples;
   4. create v1;
   5. run on the fake model;
   6. wait for "completed";
   7. the results table shows 1 row;
   8. click salary → the error browser lists the scripted mistake with its reason chip;
   9. export Markdown contains the row.
6. `byok.spec.ts`: `/demo` without a key → the error; with a fake key against a test provider stub →
   results shown; reload without "remember" → the key is gone.
7. CI wiring in Phase 27.

## 7. Verify

```bash
pnpm --filter @repo/scoring test && pnpm --filter api test && pnpm --filter api test:int
make up && pnpm --filter web exec playwright test
```

Break things on purpose:
- make `persist` increment on every attempt → the crash test fails;
- fall back to `NVIDIA_API_KEY` in the demo → the BYOK test fails;
- drop the owner filter in `getRun` → the ownership test fails.

## 8. Definition of done

- [ ] Every claim in the table has a passing test.
- [ ] Adapters tested against recorded fixtures; E2E golden path green and deterministic.
- [ ] Commit: `test: unit, integration and e2e suites`.

## 9. Interview angle

*"How do you know your benchmark tool is correct?"* The scorer is fully unit-tested against the
written rules. Every reliability claim has an integration test against real Mongo and Redis: no
double counting after a crash, errors kept out of accuracy, re-score without model calls, owner
isolation, BYOK keys never stored. The adapters are tested against recorded provider responses, so CI
never spends money.
