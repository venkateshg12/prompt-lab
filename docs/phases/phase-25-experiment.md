# Phase 25 — The experiment: v1–v5, the Playbook variants, `reasoning-mini`, the final test run

## 1. Goal

Run the study the app exists for (spec §7), and record every step in a lab notebook:
1. finalise **v1 zero-shot, v2 few-shot, v3 chain-of-thought, v4 structured output** with the same
   shared instructions;
2. run them × 3 model families × 30 **dev** examples × 3 repeats;
3. **group the mistakes** in the error browser and write the top mistake types down;
4. write **v5-best** against those mistake types, iterating on dev only;
5. add the Playbook's variant prompts (**`v0-vague`, `v2b-one-shot`, `v1-thorough`**) as ordinary
   prompt versions, decided on dev before the test run;
6. build the second task **`reasoning-mini`** (30 questions, `direct@1` vs `cot@1`);
7. run the job-postings test set **once**, with every final version in that single run, and
   `reasoning-mini` test once;
8. write `EXPERIMENT.md` and the "What I learned" story from the exports, never typed.

## 2. What I will understand after this phase

1. How to compare techniques fairly: same instructions, temperature 0, same examples, repeats.
2. How error analysis turns into specific prompt changes, and how to record the ones that didn't help.
3. Why the test set is run once, and how to plan the run so the Playbook's extra variants don't force a
   second one.
4. How to read cost vs accuracy vs latency and pick what you'd actually ship.

## 3. Prerequisites

- Phases 11–18 done (tasks, examples, prompt versions, providers, techniques + the probe, scoring,
  runner, aggregation), and Phases 19–21 (the error browser and side-by-side make step 3 practical).
- Phase 24 done: 100 labelled postings, 30 dev / 70 test.
- Provider keys in `apps/api/.env`. Spec §1 prefers **one model per provider** (OpenAI, Anthropic,
  Gemini). If you have only an NVIDIA key, use **three NVIDIA-hosted families** from the live
  `/v1/models` list that pass Phase 15's probe (`providers.md` §2: never pick from memory; Llama 3.x
  endpoints are retired). Write the choice and the reason in `EXPERIMENT.md`.
- A budget check: see "Size of the final run" below.

## 4. Files

```
cases/job-postings/prompts/
├── v0-vague.md            NEW   Playbook Lesson 1 baseline (never tuned)
├── v1-zero-shot.md        ADAPT (Phase 15 draft → final)
├── v1-thorough.md         NEW   Playbook Lesson 7: v1 + one "be thorough" line (a rejected dev variant)
├── v2-few-shot.md         ADAPT (Phase 15 draft → final; fewShot ids from dev)
├── v2b-one-shot.md        NEW   Playbook Lesson 2: only the LPA example
├── v3-cot.md · v4-structured.md   ADAPT (Phase 15 drafts → final)
├── v5-best.md             NEW   derived from the error analysis
└── EXPERIMENT.md          NEW   the lab notebook (run ids, hypotheses, deltas, decisions)
cases/reasoning-mini/
├── task.json              NEW   two fields: answer_number (integer), answer_choice (enum)
├── data/reasoning_mini.jsonl   NEW   30 questions you wrote, tagged, 10 dev / 20 test
└── prompts/{direct.md,cot.md}  NEW
cases/job-postings/runs/   NEW   exported results.jsonl of the final runs (Phase 22's exporter)
apps/api/src/scripts/check-notebook.ts   NEW   checks EXPERIMENT.md: run ids exist, each change has a delta, picks predate runs
```

Prompt files are the source of truth: `import-cases.ts` (Phase 12) loads them into `PromptVersion`
rows. An edit to a file whose version is frozen creates `@N+1`, never an in-place change (Phase 13).

## 5. Concepts

**Fair comparison.** Every job-postings version uses `{{instructions}}` and `{{fields}}` (Phase 13).
Only the technique differs: v2 adds `{{examples}}`, v3 adds the step-by-step block and `<json>` tags,
v4 adds the provider's schema mode. Temperature 0 for all, consistency measured with 3 repeats, the
same scoring rules (`scoring-rules.md`, fixed in Phase 16). Few-shot examples come from **dev only**
(Phase 13 refuses a test id in `fewShot`): one `salary_lpa` range, one monthly stipend, one
"competitive" → `null`.

**Error analysis, systematically.** For each prompt × model, open the error browser filtered by field
and read the reason buckets the scorer records (`fieldDetails.<field>.reason`, Phase 16):

```
v2 × <model A>, dev, 90 results            (illustrative format, not a result)
- stipend_or_salary: out_of_tolerance 14 (LPA read as monthly ×9, CTC vs in-hand ×3, hourly ×2),
  null_expected 6 (invented a number for "competitive")
- skills: padding with soft skills ×11, "MERN" not expanded ×5
- remote: "2 days in office" → onsite ×4
```

Then make **one change per mistake type** for v5: an explicit LPA conversion rule, "competitive →
null, never estimate", "skills are technologies only, expand stacks", a hybrid rule with an example.
Record every change as hypothesis → change → per-field delta → keep or revert. Changes that didn't
help go in too ("'think carefully' changed nothing; removed"). That's the improvement story.

**The Playbook variants, decided on dev.** The Playbook (`@pb-root`) publishes lessons from these
runs, so its variants are ordinary prompt versions here, built through the same files and runner:

| Version | For | Rule |
| --- | --- | --- |
| `v0-vague@1` | Lesson 1 | exactly the Playbook's text: "Extract the important details from this job posting as JSON.\n\n{{input}}". **Never tuned** |
| `v2b-one-shot@1` | Lesson 2 | v2 with only the LPA example |
| `v1-thorough@1` | Lesson 7 | v1 + "Be thorough: include every relevant skill, tool and technology mentioned or implied." If your notebook already holds a similar rejected v5 candidate, use that instead: real history is better |
| `direct@1`, `cot@1` | Lesson 3 | on `reasoning-mini` (below) |

**Lesson 7's picks are recorded first.** Before any dev run of `v1-thorough`, choose the 5 dev
examples you would naturally demo it with, and write their refs **with the time** in `EXPERIMENT.md`.
That timestamp is the evidence they weren't picked after seeing scores.

**One test run, planned so it's never repeated.** Because the variants above are fixed on dev **before**
the test run, they go **into** the single final test run. Then no lesson needs an extra test run, and
no caption needs a test-reuse note. The runner sets `Run.testReused = true` automatically (Phase 17)
when a completed test run already exists for the task at the same `datasetHash`. Exports carry the
flag. If you ever re-run test, the README and the Playbook captions must say so.

**Size of the final run** (job postings): 8 versions (v0, v1, v1-thorough, v2, v2b, v3, v4, v5) × 3
models × 70 × 3 repeats = **5,040 cells**. v4 cells on a probe-`unsupported` model are `skipped` (no
call, reported as `n: 0`, never 0 %). Before starting, the run launcher's estimate (Phase 20) multiplies
mean dev tokens by the snapshot prices. Check it against `Org.monthlyBudgetUsdMicros`. On NVIDIA's free
tier the cost is ≈ 0, and the README cost column uses reference-host prices with that note
(`providers.md` §6).

**`reasoning-mini`, a second task, data not code.** The Playbook's Lesson 3 needs a task where
reasoning has steps. `cases/reasoning-mini/task.json`:

```json
{
  "slug": "reasoning-mini",
  "name": "Small reasoning questions (jobs and courses)",
  "instructions": "Answer the question. Use null for the field that does not apply.",
  "fields": [
    { "kind": "integer", "key": "answer_number", "min": 0, "max": 10000000 },
    { "kind": "enum", "key": "answer_choice", "values": ["yes", "no", "a", "b", "c", "none"] }
  ]
}
```

Every question has exactly one non-null field. The other is labelled `null`, so `overall` also rewards
leaving it empty. 30 questions **you write** (a stipend total over N months plus a bonus; "2–4 years
required, candidate has 30 months: eligible?"; which batch fits a free window), tagged `arithmetic`,
`dates`, `eligibility`, `scheduling`, split 10 dev / 20 test with `stratified-split.ts`. Someone else
answers 10 before any run; fix every question they disagree on. `direct@1`: "Return only a JSON object
with answer_number and answer_choice." `cot@1`: the same + "Work through it step by step, then give the
final JSON between <json> and </json>." (`technique: cot`, `maxTokens: 1500`). Run on dev only to check
parsing. **Don't tune `cot@1` against `direct@1`.** Then test once.

**Hypotheses (NOT results).** Common findings in extraction tasks, to test rather than copy: few-shot
helps salary and skills most; CoT costs several times the output tokens for little accuracy gain;
structured output pushes valid JSON up without fixing salary logic; a smaller model with v5 can rival
a bigger one with v1. Your numbers decide, and a contradicting result is a better story.

**What "best" means.** The highest `overall` isn't automatically the answer when it costs 4× more or
has a p95 of 12 s. The recommendation cites accuracy, valid JSON, cost and p95 from the exported table:
*"v5 on <model B>: within one point of the best, a fifth of the cost, valid JSON 100 %"* (format only).

## 6. Steps

1. **Finalise v1–v4** from the Phase 15 drafts; `pnpm --filter api import-cases -- --case job-postings`.
2. **Probe** the chosen models again: `pnpm --filter api probe-structured -- --all --csv
   ../../cases/job-postings/runs/structured-probe.csv`. Note the result in `EXPERIMENT.md`.
3. **Dev run A**: v1–v4 × 3 models × 30 × 3 (1,080 cells), from the web launcher or
   `pnpm --filter api bench -- --task job-postings --split dev --prompts v1-zero-shot,v2-few-shot,v3-cot,v4-structured --models <a>,<b>,<c> --repeats 3`.
   Paste the run id and the Markdown export (Phase 22) into the notebook, then write the error-analysis
   buckets per prompt × model.
4. **v5 iterations** (`v5-best@1`, `@2`, …) on dev runs B, C, … Each entry: hypothesis → change →
   per-field delta → keep / revert. Freeze the last one.
5. **Playbook variants on dev**: record Lesson 7's 5 picks (with the time) first, then one dev run of
   v0-vague, v2b-one-shot and v1-thorough × the same models. Decide nothing from them except that
   they parse. They're baselines and a rejected variant, not candidates.
6. **`reasoning-mini`**: write, second-check and import the 30 questions; one dev run of
   `direct@1`, `cot@1` to confirm parsing.
7. **The final job-postings test run, once**: all 8 versions × 3 models × 70 × 3 repeats. Don't touch
   prompts afterwards.
8. **`reasoning-mini` test run, once**: `direct@1`, `cot@1` × the same models × 20 × 3.
9. **Export** both runs (`results.jsonl`, `summary.csv`, Markdown) into `cases/*/runs/` with
   `pnpm --filter api export-run -- --run <id> --out-dir …` (Phase 22). Publish the job-postings run
   (`/r/<slug>`).
10. **Write the story**: the README's "What I learned" (top 3 mistake types, what fixed them, what
    didn't) and the recommendation, quoting the generated table.

## 7. Verify

```bash
psql "$DATABASE_URL" -c "select t.slug, r.split, r.status, r.test_reused, r.total_cells, r.done_cells, r.error_cells
                         from runs r join tasks t on t.id = r.task_id where r.split = 'test' order by r.created_at"
# job-postings   | test | completed | f | 5040 | 5040 | <n> |   ← exactly ONE row per task, test_reused = f
# reasoning-mini | test | completed | f |  <n> |  <n> | <n> |
pnpm --filter api exec tsx src/scripts/check-notebook.ts ../../cases/job-postings/prompts/EXPERIMENT.md
# every run id in the notebook exists · every v5 change has a delta line · Lesson-7 picks timestamped before the first v1-thorough run
```

- `v0-vague.md`'s body is byte-identical to the text in the Playbook's Lesson 1 phase.
- The README table equals the test run's Markdown export exactly (`diff`).
- `structured-probe.csv` exists. Every probe-`unsupported` model's v4 rows show `n: 0` / "n/a" in the
  summary, never 0 %.
- The recommendation cites accuracy, valid JSON, cost and p95 from the table.

## 8. Definition of done

- [ ] v1–v4 compared fairly on dev, with error analysis written down per prompt × model.
- [ ] v5 derived from that analysis, iterated on dev only; non-improvements recorded.
- [ ] v0-vague, v2b-one-shot, v1-thorough present as prompt versions; Lesson 7's picks recorded with a
      timestamp before their first run.
- [ ] `reasoning-mini` written, second-checked, imported; `direct@1` and `cot@1` frozen.
- [ ] One test run per task (`test_reused = false`); exports in `cases/*/runs/`; the job-postings run
      published.
- [ ] README table, "What I learned" and the recommendation filled from exports.
- [ ] `tracker.md` updated. Commit: `experiment: v1–v5 + Playbook variants on 3 models, final test results`.

## 9. Interview angle

The full story in two minutes:
1. a fixed, labelled test set with dev/test discipline;
2. four techniques compared with identical shared instructions;
3. the top three mistake types from the error browser, with counts;
4. the specific v5 changes and their measured effect, including the ones that did nothing;
5. why the teaching variants went **into** the one test run rather than earning a second one;
6. which prompt × model I'd ship, and why, from accuracy, cost and p95 together.
