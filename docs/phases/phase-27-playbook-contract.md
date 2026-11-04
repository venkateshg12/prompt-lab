# Phase 27 — The Playbook contract: exports, contract test, hand-off

## 1. Goal

The Prompt Engineering Playbook (`@pb-root`) publishes lessons whose every number comes from Prompt
Lab runs, and **its importer is already built**. This phase makes the hand-off between the two repos
provable instead of hopeful:
1. a **contract test** that parses real Prompt Lab exports with a copy of the Playbook's schemas, and
   fails the moment the copy drifts from the Playbook's source;
2. a **live dry run** of the Playbook's own importer against the final exports from Phase 25;
3. **`cases/HANDOFF.md`**: per Playbook lesson, the run id, the export file, and the exact
   `--variant` flags, generated from the database;
4. a **re-test procedure** for when a model changes or is retired.

`docs/reference/playbook-contract.md` is binding. This phase enforces it; it doesn't redesign it.

## 2. What I will understand after this phase

1. What a consumer-driven contract is, and why the consumer's schema, not the producer's, is the
   source of truth.
2. How to detect drift between two repos without a shared package or a network call.
3. Why extra fields are safe in this contract and renamed fields aren't.
4. How to re-test a published number when the model behind it changes, without rewriting history.

## 3. Prerequisites

- Phase 22 (exporters: `results.jsonl`, `summary.csv`, Markdown) and Phase 25 (the final runs, exported
  into `cases/*/runs/`, and `structured-probe.csv`).
- The Playbook checked out at `~/Code/prompt-engineering-playbook` with its Phase 06 built (it is, as of
  3 Nov 2026), `pnpm install` done there, and Node from its `.nvmrc`.

## 4. Files

```
apps/api/test/contract/
├── importContracts.copy.ts           COPY  @pb-root/packages/types/src/importContracts.ts (the Prompt Lab part)
├── playbookContract.int.test.ts          NEW   parses exports and case files with the copied schemas
└── drift.test.ts                     NEW   the copy == the Playbook's source (skipped when the sibling repo is absent)
apps/api/src/scripts/
├── handoff.ts                        NEW   writes cases/HANDOFF.md from the runs in the database
└── playbook-dry-run.sh               NEW   runs the Playbook importer --dry-run for every lesson in HANDOFF.md
cases/HANDOFF.md                      NEW   (generated)
cases/RETEST.md                       NEW   the re-test procedure
```

## 5. Concepts

**The consumer owns the contract.** The Playbook is the reader. Its `promptLabResultLineSchema` and
`promptLabCaseLineSchema` (in `@pb-root/packages/types/src/importContracts.ts`) define what a valid
export is. Prompt Lab keeps a **byte-identical copy** of that part in its tests and parses every export
with it. A shared npm package would couple two repos' release cycles for two schemas. A copy plus a
drift test gives the same safety with no coupling.

**What may change, and what may not.** The Playbook's schema is a Zod object, which strips unknown
keys. So Prompt Lab may **add** fields freely, and does: `inputTokens`, `tags`, `fieldDetails`
(`{ skills: { precision, recall }, stipend_or_salary: { reason } }`), `canonicalAnswer` (the
normalised answer Phase 18 uses for consistency), `error`, `testReused`. It may **never** remove,
rename or retype a field the schema names (`runId`, `split`, `promptVersion`, `modelKey`, `exampleId`,
`repeat`, `status`, `rawOutput`, `validJson`, `schemaValid`, `exactMatch`, `overallScore`,
`fieldScores`, `outputTokens`, `costUsdMicros`, `latencyMs`, `completedAt`). The Playbook reads an
extra field only after adding it to its own schema in the lesson phase that needs it (its Phase 06
§6.5: `tokens_in_mean` → `inputTokens` in Lesson 2; `skills_precision`, `skills_recall`, `consistency`
→ `fieldDetails`, `canonicalAnswer` in Lesson 7).

**Shapes that matter to the numbers:**
- `promptVersion` is `<key>@<version>` (`v2-few-shot@1`), the frozen id. Never the database uuid.
- `exampleId` is `Example.ref` (`jp_017`), the same id as the case line's `id`.
- `status: "skipped"` for structured cells on a probe-unsupported model. The importer excludes them,
  and the lesson shows "n/a", never 0 %.
- One run = one split. The Playbook refuses a mixed file.
- `costUsdMicros` is the per-call cost at the run's **price snapshot**, not today's price.

**The drift test.** `drift.test.ts` reads the Playbook's source file when `PLAYBOOK_ROOT` (default
`~/Code/prompt-engineering-playbook`) exists, extracts the two schema declarations, and compares them
with the copy after normalising whitespace. CI has no sibling repo, so the test **skips there with a
visible reason**. The dry run below is the local gate. Either failure means: update the copy, re-run
the contract test, and note it in `tasks/lessons.md`.

**HANDOFF.md is generated.** The Playbook's lesson phases need `--run <file> --cases <file> --variant
"key=<promptVersion>,<modelKey>,<label>"`. `handoff.ts` reads the final test runs from the database and
writes, per lesson, the export path, the run id, `testReused`, the split, n per variant, and
copy-pasteable `--variant` flags. It uses the lesson → version table from `playbook-contract.md` §3.
Nobody types a run id or a model key.

**Re-testing without rewriting history.** Models change (NVIDIA's Llama 3.x endpoints answered 410 from
26 Aug 2026). A published lesson keeps its old numbers with their `tested_on` date. A re-test is a
**new run** with a new id on the same frozen prompt versions and `datasetHash`. If the model id
changed, it's a **new model row**: never edit a `Model.modelId` in place. `RETEST.md` is the procedure.
The Playbook then adds a "Re-tested on …" note when the conclusion changed (its writing guide).

## 6. Steps

1. **Copy the schemas.** Copy the Prompt Lab part of `@pb-root/packages/types/src/importContracts.ts`
   (`promptLabResultLineSchema`, `promptLabCaseLineSchema`, and their imports) to
   `test/contract/importContracts.copy.ts`, with a header comment naming the source and the date.
2. **`playbookContract.int.test.ts`:**
   ```ts
   import { readFileSync, readdirSync } from "node:fs";
   import { promptLabCaseLineSchema, promptLabResultLineSchema } from "./importContracts.copy";

   const lines = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

   it.each(readdirSync("../../cases/job-postings/runs").filter((f) => f.endsWith(".results.jsonl")))(
     "%s parses with the Playbook's result-line schema",
     (file) => {
       const parsed = lines(`../../cases/job-postings/runs/${file}`).map((l) => promptLabResultLineSchema.parse(l));
       expect(new Set(parsed.map((p) => p.runId)).size).toBe(1);          // one run per file
       expect(new Set(parsed.map((p) => p.split)).size).toBe(1);          // one split per file
       expect(parsed.every((p) => /^[a-z0-9-]+@\d+$/.test(p.promptVersion))).toBe(true);
     },
   );
   it("case files parse with the Playbook's case-line schema", () => {
     for (const f of ["../../cases/job-postings/data/job_postings.jsonl", "../../cases/reasoning-mini/data/reasoning_mini.jsonl"])
       lines(f).forEach((l) => promptLabCaseLineSchema.parse(l));
   });
   ```
   Add one test that builds an export **in memory** from a fixture run (the `fake` provider, Phase 28's
   helpers). Then the contract is checked in CI even before real runs exist.
3. **`drift.test.ts`**: `it.skipIf(!existsSync(PLAYBOOK_ROOT))`, then a normalised text comparison.
4. **`handoff.ts`** → `cases/HANDOFF.md`, one section per Playbook lesson (1, 2, 3, 4, 7), from the
   final runs. A lesson whose prompt versions aren't in a completed test run is printed as **MISSING**,
   with the versions it lacks.
5. **`playbook-dry-run.sh`**: for each lesson block in `HANDOFF.md`, run
   ```bash
   cd "$PLAYBOOK_ROOT" && pnpm --filter site import:prompt-lab \
     --run "$PL/cases/job-postings/runs/<file>.results.jsonl" --cases "$PL/cases/job-postings/data/job_postings.jsonl" \
     --lesson <slug> --variant "…" --variant "…" --metrics <list> --root "$(mktemp -d)" --dry-run
   ```
   Metrics are limited to what the Playbook's importer has **built today** (`overall`, `valid_json`,
   `schema_valid`, `exact_match`, `tokens_out_mean`, field keys). Flags the Playbook adds in later
   lesson phases (`--subset`, `--results-file`, `--probe`) are listed in the hand-off as "needs Playbook
   Phase NN" rather than run.
6. **`RETEST.md`**: when to re-test (a 410 or 404 on a model, a new model version, every 6 months for
   published lessons), how (a new `Model` row; the same frozen prompts; a new run; `export-run`;
   `handoff.ts`; the dry run), and what never to do (edit an old run, overwrite an old export).

## 7. Verify

```bash
pnpm --filter api test contract
# ✓ 2026-…-test-<runId>.results.jsonl parses with the Playbook's result-line schema
# ✓ case files parse with the Playbook's case-line schema
# ✓ an in-memory export from a fake-provider run parses
# ✓ importContracts.copy.ts matches the Playbook's source      (↓ skipped: Playbook not found, in CI)
pnpm --filter api exec tsx src/scripts/handoff.ts && grep -c MISSING ../../cases/HANDOFF.md
# 0
bash apps/api/src/scripts/playbook-dry-run.sh
# be-specific        … results/be-specific.csv + <n> rows (dry run: nothing written)
# few-shot           … (dry run: nothing written)
# structured-output  … (dry run: nothing written)
# chain-of-thought   needs Playbook --results-file (its Phase 26): listed, not run
# testing-prompts    needs Playbook --subset/--split-label/--append (its Phase 30): listed, not run
```

- Rename `exampleId` in a scratch copy of an export → the contract test fails with the Zod path.
- Add an unknown field to an export line → it still parses (unknown keys are stripped).
- Edit one character of a schema in the Playbook's source (then revert) → `drift.test.ts` fails locally.

## 8. Definition of done

- [ ] The contract test parses every committed export and case file with the copied Playbook schemas,
      plus an in-memory fake export in CI.
- [ ] The drift test runs locally and skips visibly in CI.
- [ ] `HANDOFF.md` generated with no MISSING lessons; the Playbook importer's dry run passes for every
      lesson its built flags cover.
- [ ] `RETEST.md` written; `playbook-contract.md` unchanged (or changed in both repos the same day).
- [ ] `tracker.md` updated; tell the Playbook's tracker which runs are ready. Commit:
      `feat: Playbook contract test, hand-off and re-test procedure`.

## 9. Interview angle

*"How do two of your projects stay in sync?"* The Playbook consumes Prompt Lab's exports, so the
Playbook's schema is the contract. Prompt Lab keeps a copy of it in its tests, parses every real export
with it, and a drift test compares the copy with the Playbook's source whenever both repos are on disk.
Adding fields is safe because the consumer strips unknown keys. Renaming one fails a test before
anyone runs an import. When a model gets retired, I don't edit old results. I re-run the same frozen
prompts as a new run, and the lesson shows both dates.
