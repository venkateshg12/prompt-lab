# Phase 24 — The experiment: v1–v4, error analysis, v5, final run

## 1. Goal

Run the study the whole app exists for (spec §7), with a written record of every step:
1. finalise **v1 zero-shot, v2 few-shot, v3 chain-of-thought, v4 structured output**, with the same
   shared instructions;
2. run all four × 3 models on **dev** (3 repeats);
3. **group the mistakes** in the error browser and write down the top mistake types;
4. write **v5 = best prompt**, targeting the top mistake types; iterate on **dev** only;
5. run everything **once** on **test** (3 repeats) for the final table;
6. write the improvement story.

## 2. What I will understand after this phase

1. How to compare techniques fairly (same instructions, temperature 0, same examples, repeats).
2. How error analysis turns into specific prompt changes.
3. Why the test set is run once, and what to do if you're tempted to run it again.
4. How to read cost-vs-accuracy and decide which combination you'd actually ship.

## 3. Prerequisites

Phases 16–23 done.

## 4. Files

```
cases/job-postings/prompts/
├── v1-zero-shot.md · v2-few-shot.md · v3-cot.md · v4-structured.md   ADAPT (Phase 14 drafts → final)
├── v5-best.md                                                          NEW
└── EXPERIMENT.md                                                       NEW   (the lab notebook)
```

## 5. Concepts

**Fair comparison.**
- **Same shared text**: every version uses `{{instructions}}` and `{{fields}}` (Phase 12). Only the
  technique differs.
- **Temperature 0** for all of them; consistency is measured with 3 repeats, not assumed.
- **Same models, same dev examples, same scoring rules version.** The run records them, and
  `EXPERIMENT.md` links run ids.
- **Few-shot examples come from dev**, chosen to cover a tricky salary (LPA), a work-mode variant
  and buried skills. Note which ids, and avoid examples that are near-duplicates of others in dev
  (they'd inflate dev scores).

**Error analysis, systematically.** For each prompt × model, open the error browser (Phase 20) per
field and write the top reason buckets with counts:

```
v2 × <model A>, dev, 90 results
- stipend_or_salary (acc 64 %): out_of_tolerance 14 (LPA read as monthly ×9, CTC vs in-hand ×3, hourly ×2),
  null_expected 6 (invented a number for "competitive")
- skills (F1 0.78): padding with soft skills ×11, "MERN" not expanded ×5
- remote (acc 86 %): "2 days in office" → onsite ×4
```

Then decide **one change per mistake type** for v5, e.g.:
- an explicit conversion rule ("LPA = lakhs per annum: 3–5 LPA → min 300000, max 500000, period year");
- "If the posting says competitive / as per industry / not disclosed, salary is null. Never estimate.";
- "Skills are technologies, languages, frameworks and tools only. Not soft skills. Expand stacks:
  MERN → …";
- a hybrid rule with an example;
- swap one few-shot example for a "competitive salary → null" case.

Write the before/after for each change in `EXPERIMENT.md`. Some changes won't help. Record those too:
"adding 'think carefully' changed nothing; removed".

**Iterate on dev, then stop.** v5 can go through several versions (v5 → v6 …) on dev. When you stop,
freeze the final one and run the **test** set once: all five techniques × 3 models × 70 × 3 repeats ≈
3,150 calls. If you change a prompt after seeing test results and re-run, the test set has become a
dev set. Either collect fresh test postings, or say plainly in the README that the test set was
reused.

**What "best" means.** Report the table and then **choose**: the highest overall isn't automatically
the answer when it costs 4× more or has a p95 of 12 s. Write a short recommendation: *"v5 on <model B>:
within 1 point of the best, 1/5 of the cost, valid JSON 100 %."* The spec's last interview question
is exactly this.

**Expect surprises, and report them.** Common findings in extraction tasks: few-shot helps salary and
skills the most; CoT costs 2–3× the output tokens for little or no accuracy gain; structured output
pushes valid JSON to ~100 % without fixing salary logic; a smaller model with v5 rivals a bigger one with
v1. Your numbers decide; these are hypotheses to test, not results to copy.

## 6. Steps

1. Finalise v1–v4 files from the Phase 14 drafts; seed (`pnpm --filter api seed`) → versions in the DB.
2. Probe structured support again (`probe-structured --all`) and note the result.
3. **Dev run A**: v1–v4 × 3 models × 30 dev × 3 repeats (1,080 calls) → `EXPERIMENT.md` gets the run
   id, Markdown export, and the error-analysis notes per prompt × model.
4. Write v5 (and iterate: v5.1, v5.2 … as new versions) with dev runs B, C … Each entry in
   `EXPERIMENT.md`: hypothesis → change → result (Δ per field) → keep/revert.
5. Freeze the final v5. **Test run**: v1–v5 × 3 models × 70 test × 3 repeats. Don't touch prompts
   afterwards.
6. Export Markdown (Phase 21), publish the run, and fill the README results table from the export.
7. Write "What I learned" in the README: the top 3 mistake types, how each change fixed (or didn't fix)
   them, and the recommendation.
8. Write the final v5 into the README with a one-line explanation per section.

## 7. Verify

- `EXPERIMENT.md` links every run id, and each prompt change has a measured delta.
- The test run happened once (the runs list shows one `split: test` run for the final versions;
  explain any other in the notebook).
- The README table equals the test run's Markdown export exactly.
- The recommendation cites accuracy, valid JSON, cost and p95 from the table.

## 8. Definition of done

- [ ] Four techniques compared fairly on dev, with error analysis written down.
- [ ] v5 derived from that analysis, iterated on dev only.
- [ ] One final test run; published; table and story in the README.
- [ ] Commit: `experiment: v1–v5 on 3 models, final test results`.

## 9. Interview angle

The full story in under two minutes:
1. the fixed test set and dev/test discipline;
2. four techniques compared with the same instructions;
3. the top three mistake types found in the error browser;
4. the specific v5 changes and their measured effect;
5. the final test numbers;
6. and which prompt × model you'd ship, and why (accuracy vs cost vs latency).
