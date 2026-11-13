# Limitations

What the results in the README do and don't show, stated before anyone else has to point it out.

- **One task, one domain.** Job postings → JSON, about 100 examples (30 dev, 70 test). Every row shows
  its `n` and every rate its 95 % interval; overlapping intervals mean "not clearly better", and the
  table dims the bold when that happens.
- **Repeats aren't independent samples.** Intervals are computed over results (examples × repeats), so
  with 3 repeats they are slightly optimistic.
- **One primary labeller.** 20 postings were double-labelled blind; agreement per field is in
  `cases/job-postings/data/AGREEMENT.md`. Where agreement is low, the rule was unclear, and the model's
  score on that field is less certain than its interval suggests.
- **Prices are dated.** Each run snapshots prices with the date they were checked. NVIDIA's developer
  tier is free; its cost column uses a reference host's price for the same open model, labelled as such.
  It is not what anyone paid.
- **Temperature 0 isn't deterministic** on hosted inference. That is what the consistency column
  measures; a single run can still differ from a re-run.
- **Structured-output support varies by hosted model.** The probe decides per model; a structured prompt
  on a model the probe found unsupported is "n/a", not 0.
- **Normalisation choices are opinions,** written down before any run: no fuzzy text matching, strict
  types, no partial credit for salary, soft skills don't count as skills.
- **Hosted models change.** A model id can be retired (NVIDIA's Llama 3.x on 26 Aug 2026). Published
  results keep their date; a re-test is a new run (`cases/RETEST.md`).
- **The LLM judge (if shown) is exploratory** until validated on at least 30 human labels with agreement
  ≥ 85 % and κ ≥ 0.6; it never enters `overall`.
- **Test reuse.** The test split is meant to be run once. Any run that reused it says so in its caption
  (`testReused`).
