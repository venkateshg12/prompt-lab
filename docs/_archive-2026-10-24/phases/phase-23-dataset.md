# Phase 23 — Build the job-postings test set

## 1. Goal

The credibility of every number comes from here: **100 hand-labelled job postings** (minimum 50),
varied on purpose, labelled by the rules in [../reference/scoring-rules.md](../reference/scoring-rules.md),
20 double-checked by a second person, split 30 dev / 70 test, and shareable without republishing
anyone's content.

This is mostly *your* work (collecting and labelling), with small helper scripts. Budget 6–8 hours.
It's the slowest and the most valuable phase.

## 2. What I will understand after this phase

1. What makes a test set representative, and how tags make the hard cases visible.
2. Why labelling rules are written before labelling, and how to handle ambiguity consistently.
3. How to measure label quality (inter-annotator agreement) with the same scorer.
4. What you may publish from scraped postings, and how to anonymise.

## 3. Prerequisites

Phases 10–11 done (the task and the import pipeline). Ideally Phase 18 (the label editor).

## 4. Files

```
cases/job-postings/
├── data/job_postings.jsonl         NEW   (the labelled set; public version anonymised)
├── data/LABELLING.md               NEW   (the labelling guide: rules + decisions on edge cases)
├── data/SOURCES.md                 NEW   (where postings came from; how they were anonymised)
└── data/second-label.jsonl         NEW   (the 20 double-checked labels)
apps/api/src/scripts/
├── label-helper.ts                 NEW   (optional: draft labels with a model, for YOU to correct)
└── agreement.ts                    NEW   (inter-annotator agreement with @repo/scoring)
```

## 5. Concepts

**Variety on purpose.** Target mix for 100 postings (adjust, but tag everything):

| Tag | ~Count | What it covers |
| --- | --- | --- |
| `internship` | 25 | stipends per month, "PPO", short durations |
| `full_time_in` | 25 | Indian full-time; salary in LPA, CTC |
| `foreign` | 15 | USD/EUR/GBP; per hour or per year |
| `remote_variants` | 20 | "WFH", "work from anywhere", "2 days in office" (→ hybrid), "remote (India only)" |
| `salary_lpa` | 20 | "3–5 LPA", "₹6L CTC", "up to 12 LPA" |
| `salary_hidden` | 15 | "competitive", "as per industry", "DOE" → `null` |
| `skills_buried` | 20 | skills inside paragraphs, not lists |
| `missing_fields` | 15 | no location, no company name (agency posts), no experience |
| `messy` | 20 | pasted with emojis, bullets, HTML remnants, ALL CAPS |

One posting usually has several tags. Overlap is fine.

**Rules before labels, and a decision log.** Ambiguity is constant: is "Bengaluru/Remote" `remote` or
`hybrid`? Does "MERN" mean four skills? Is "fresher" experience 0? Write every decision into
`LABELLING.md` the first time you meet it, then label consistently. Examples of decisions to make up
front:
- "MERN" → `mongodb, express, react, node.js` (expand stacks; add these to the synonym table as
  needed);
- soft skills ("communication", "teamwork") are **not** skills for this task;
- "fresher" / "0–1 years" → `experience_years_min: 0`; "1+ years" → 1; not stated → `null`;
- "₹6L CTC" → `{ min: 600000, max: 600000, currency: "INR", period: "year" }`;
- "up to ₹25k/month" → `{ min: null, max: 25000, … }`;
- a city plus "remote option" → `hybrid` only if the posting says office days; otherwise `remote`.

These decisions are part of the README's "how the test set was built" section.

**Drafting with a model is fine; trusting it isn't.** `label-helper.ts` can pre-fill a label with a
model so you only correct it. But the **input** to your benchmark must not be graded against the
**output** of one of the models being benchmarked. Two safeguards:
1. draft with a model **not in the comparison** (or none);
2. every label is checked field by field by you, and `labelNotes: "reviewed"` is set only then.

The README states how labels were produced. If drafting biases the set toward one model's phrasing,
the error analysis will show it.

**Agreement.** A friend labels 20 postings independently from `LABELLING.md`. `agreement.ts` scores
their labels against yours with **the same field scorers** and reports per-field agreement (e.g.
`skills` F1 0.86, `remote` 95 %). Disagreements are discussed and resolved into `expected`, the
decision goes into `LABELLING.md`, and the agreement numbers go in the README ("labels: one primary
labeller; 20 double-checked; agreement 93 % of fields"). Low agreement on a field means the rule is
unclear, so fix the rule before blaming models.

**Sharing responsibly.** Job postings belong to the sites and companies that published them.
- Collect for your own testing (copy text by hand from public postings; respect sites' terms; no
  scraping that violates them).
- In the public repo, publish an **anonymised, shortened** version: replace company names with
  plausible fictional ones, remove emails, phone numbers, URLs and recruiter names, and trim
  boilerplate. Keep everything that matters to the fields (salary text, work mode wording, skills
  sentences).
- `SOURCES.md` says how postings were collected and anonymised. Where something can't be shared,
  publish its label and tags with the input marked withheld, and set `publicInputs: false` on the
  task (Phase 21 hides inputs on published pages).
- Anonymise **before** labelling the public copy, so the label matches the published text (company
  name included).

**Split.** Run Phase 11's stratified auto-split: 30 dev, 70 test, every tag in both. Then **don't look
at the test examples' details** while writing prompts. The tooling helps (Phases 12, 18, 19), and the
discipline is yours.

## 6. Steps

1. Write `LABELLING.md` (rules from `scoring-rules.md` + the decision list above). 1 hour.
2. Collect 100 postings into a scratch file, one block per posting, with the source noted. 2–3 hours.
3. Anonymise each (fictional company names from a fixed list; strip contact details). Keep the
   original privately if you want, never in git.
4. Label in the app's editor (Phase 18), or in a spreadsheet exported to JSONL. Tag each posting.
   Import with the dry run (Phase 11) until it's clean. 3–4 hours.
5. Second labeller: export 20 postings (8 dev, 12 test) with **inputs only**; they label in a copy of
   the template; import as `secondLabel` via `PATCH /examples/:id`; run
   `pnpm --filter api exec tsx src/scripts/agreement.ts --task job-postings`.
6. Resolve disagreements; update `LABELLING.md`; record agreement in the README draft.
7. Auto-split; verify the tag distribution with `GET /tasks/:id/examples?split=dev&tag=…` counts.
8. Commit the public JSONL, `LABELLING.md`, `SOURCES.md` and `second-label.jsonl`.

**Weekend version:** 30 postings, all dev, no second labeller. Say exactly that in the README.

## 7. Verify

- `importExamples` dry run: 100 valid, 0 invalid.
- Tag counts per split match the target mix roughly; every tag has ≥ 3 test examples.
- `agreement.ts` prints per-field agreement for 20 postings.
- `grep -E "@|\+91|https?://" cases/job-postings/data/job_postings.jsonl` → nothing (no contacts or
  links).
- A random spot check of 10 labels against `LABELLING.md`: all consistent.

## 8. Definition of done

- [ ] 100 (≥ 50) labelled, tagged, anonymised postings, imported cleanly.
- [ ] `LABELLING.md` with every edge-case decision; `SOURCES.md` with collection and anonymisation.
- [ ] 20 double-checked, agreement measured and recorded.
- [ ] A stratified 30/70 split.
- [ ] Commit: `data: job-postings test set (100 labelled, anonymised)`.

## 9. Interview angle

*"How did you build your test set?"* 100 real postings chosen to cover the hard cases (LPA salaries,
WFH variants, skills buried in prose, missing fields), labelled against a written guide with a decision
log. 20 were independently double-checked, with agreement measured using the same scorer as the models.
They're anonymised for publication and split 30/70, and the test split was run once.
