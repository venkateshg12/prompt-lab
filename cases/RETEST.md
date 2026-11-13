# Re-testing a published result

Published numbers keep their `tested_on` date forever. A re-test adds a NEW run next to them; it never
rewrites history.

## When

- A model answers **410** (retired) or **404** (renamed) — `complete()` deactivates it on a 410.
- The provider ships a new version of a model a lesson uses.
- Every 6 months for anything published in the Playbook.

## How

1. **New model row, never an edit.** Add the new id to `apps/api/src/config/models.config.ts` with its
   price and `priceCheckedOn`, run `pnpm --filter api db:seed-models`, then probe it:
   `pnpm --filter api probe-structured -- --model <key>`. Never change an existing `Model.modelId`.
2. **Same frozen prompts, same data.** Use the exact prompt versions of the original run (`key@N`);
   check that the task's `datasetHash` is unchanged (`GET /orgs/:org/runs/:id/summary` shows no stale
   flag). If the labels changed, say so in the note below.
3. **New run.** From the launcher or `bench --save`. A test-split re-run is recorded as
   `testReused = true`: that's correct, and every caption must say "re-test".
4. **Export.** `pnpm --filter api export-run -- --run <newId> --out-dir ../../cases/<task>/runs`
5. **Hand-off.** `pnpm --filter api exec tsx src/scripts/handoff.ts`, then
   `bash apps/api/src/scripts/playbook-dry-run.sh`.
6. **Tell the Playbook.** Its lesson adds "Re-tested on <date> with <model>" when the conclusion
   changed (its writing guide), keeping the original numbers.

## Never

- Edit or delete an old run, its results, or its export file.
- Overwrite an old `cases/*/runs/*.results.jsonl`.
- Tune a prompt on the test split to "fix" a re-test.
