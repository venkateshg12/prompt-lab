# Phase 30 — README, ADRs, demo GIF, LinkedIn post, resume

## 1. Goal

Tell the story with the numbers you measured, and only those:

- a **README** in the spec's order (§11), whose results table is **generated** from the published test
  run and kept in sync by a script and a CI check;
- **ADRs** for the decisions an interviewer will poke at;
- `LIMITATIONS.md`, `INTERVIEW.md`, `DATA-HANDLING.md`;
- a ≤ 60 s **demo GIF**, a **LinkedIn post**, and the **resume bullet** (spec §12), all quoting the same
  table with the same rounding;
- tag `v1.0.0`.

## 2. What I will understand after this phase

1. How to keep one set of numbers identical across README, published page, post and resume.
2. How to write an ADR that survives "why didn't you just…?".
3. How to answer each interview question in spec §13 from my own data, in five sentences or fewer.
4. What the limits of my result are, stated before anyone else points them out.

## 3. Prerequisites

- Phase 25's final **test** run is done and published (Phase 22), and Phase 27's export was handed to the
  Playbook.
- Phase 29 deployed: the live web URL and a published run URL exist.
- Phase 24's labelling notes (`cases/job-postings/LABELLING.md`, the agreement numbers from Phase 12).

## 4. Files

```
README.md                                   ADAPT (final, spec §11 order; results between markers)
apps/api/src/scripts/update-readme.ts       NEW   (published run → Markdown table → README markers)
docs/adr/0001-postgresql-not-sqlite-or-mongodb.md    NEW
docs/adr/0002-one-job-per-cell.md                    NEW
docs/adr/0003-never-repair-model-output.md           NEW
docs/adr/0004-workspace-is-an-org.md                 NEW
docs/adr/0005-nvidia-default-plus-three-adapters.md  NEW
docs/adr/0006-playbook-export-contract.md            NEW
docs/adr/0007-no-fallback-model-in-a-benchmark.md    NEW
docs/LIMITATIONS.md · docs/INTERVIEW.md · docs/DATA-HANDLING.md · docs/demo-script.md   NEW
docs/linkedin-post.md                       NEW   (draft, numbers generated)
LICENSE                                     NEW   (MIT for code; the dataset's licence note lives in cases/job-postings/SOURCES.md)
.github/workflows/ci.yml                    ADAPT (+ `readme:check` step)
```

## 5. Concepts

**One set of numbers.** The README table is the Markdown export (Phase 22) of the **published test
run**. `update-readme.ts` writes it between `<!-- results:start -->` and `<!-- results:end -->` with a
caption naming the run id, split, n, repeats, date and the price-check date. `readme:check` runs the
same function and fails CI if the README differs. The LinkedIn post and the resume bullet are filled
from the same summary by `--print-bullet` and `--print-post`, with the same rounding (one decimal for
percentages, two for dollars). In an interview you open the published page and the numbers match the
README to the decimal.

```ts
// apps/api/src/scripts/update-readme.ts (core)
const START = "<!-- results:start -->";
const END = "<!-- results:end -->";
export function replaceBetweenMarkers(readme: string, block: string): string {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error("README results markers missing");
  return `${readme.slice(0, a + START.length)}\n${block}\n${readme.slice(b)}`;
}
// main: load the run by --run <id> (must be published, split=test), build the block with Phase 22's
// exportMarkdown(summary, meta), then write (default) or compare (--check, exit 1 on difference).
```

`package.json` (api): `"readme:update": "tsx src/scripts/update-readme.ts"`,
`"readme:check": "tsx src/scripts/update-readme.ts --check"`. In CI, `--check` reads a committed
snapshot of the run's summary (`docs/results/<runId>.summary.json`, written by `readme:update`) so CI
doesn't need the production database.

**The README, in the spec's order.**
1. One line: *"Prompt Lab compares prompts and models on hand-labelled test sets with real scores, cost
   and latency."*
2. The GIF.
3. **Results** (generated): Prompt · Model · Overall · Skills F1 · Salary acc · Valid JSON · Consistency ·
   $/100 inputs · p95 latency, rows v1–v5 per model, `n` per row, a caption, and a link to the published
   run. "n/a" cells (structured output unsupported by a model) are explained under the table, never
   blank.
4. **What I learned**: the top 3 mistake types from the dev error browser (e.g. "LPA not converted",
   "soft skills listed as skills", "hybrid marked remote"), the prompt change aimed at each, and whether
   it worked **on test**, with the number. Include at least one change that didn't help.
5. **The best prompt**: v5 in a code block, then one line per part saying which mistake it addresses.
6. **The test set**: sources and anonymisation (link `SOURCES.md`), labelling rules (`LABELLING.md`),
   the double-check of 20 examples and the agreement from Phase 12, the 30 dev / 70 test split, and
   whether test was ever reused (`testReused`).
7. **Scoring rules**: link `docs/reference/scoring-rules.md`, plus the three that matter most in one
   line each (skills F1 with synonyms; salary normalised to per-year, ±5 %, not partial; invented salary
   on "competitive" scores 0).
8. **Run it yourself**: `make up`, `pnpm --filter api import-cases -- --case job-postings`,
   `pnpm --filter api bench -- …`, and the live demo with your own key.
9. **Limits**: link `LIMITATIONS.md`.

Then "Architecture" (the diagram from `docs/reference/architecture.md`, and "built on the same backend as
my e-commerce and PaperTrail projects: PostgreSQL + Prisma, BullMQ, Redis") and links.

**ADRs** (context · decision · alternatives · consequences · how we'd know we were wrong; half a page
each):

| ADR | Decision | The question it answers |
| --- | --- | --- |
| 0001 | PostgreSQL 17 + Prisma, not the spec's SQLite or my earlier MongoDB plan | "Why not SQLite for a single-user tool?" One database for dev, tests and production; Testcontainers runs the real migrations; foreign keys and unique indexes enforce what the runner relies on (one result per cell) |
| 0002 | One BullMQ job per cell with a deterministic id | "Why not a loop?" Crash-safe progress, retries per call, spreads across workers; the unique index is the second lock |
| 0003 | Never repair model output before scoring | "Wouldn't fixing a missing brace be friendlier?" The tool measures raw behaviour; repair would hide what valid-JSON % reports. PaperTrail repairs because it's a product; this is an instrument |
| 0004 | A workspace is a PaperTrail org | "Why tenancy in a one-person tool?" The second labeller needs a role with less power; published pages are scoped by the database, not by care |
| 0005 | NVIDIA NIM by default, OpenAI/Anthropic/Gemini adapters on when keyed | Cost and open models; NVIDIA prices are reference-host prices, labelled; models picked by probe after the Llama 3.x retirement |
| 0006 | The Playbook export contract | "Why not let the Playbook read your database?" A versioned file contract, tested on both sides, lets the site build statically and lets anyone check the numbers |
| 0007 | No fallback model in a benchmark | PaperTrail falls back when a model fails; here that would mix two models' answers into one cell. A failed call is an error cell, counted and shown |

**`LIMITATIONS.md`**, specific and honest:
- one task, 100 examples, one domain; per-row `n` and the intervals from Phase 18;
- a single primary labeller; 20 double-checked, agreement as measured;
- prices checked on a date; NVIDIA free-tier cost is a reference price, not what you paid;
- temperature 0 isn't deterministic on hosted inference: that's what the consistency column measures;
- structured-output support varies by hosted model (the probe result per model);
- normalisation choices (no fuzzy text match, strict types, no partial salary credit) are opinions,
  written down before the runs;
- test reuse, if it happened, and which runs.

**`DATA-HANDLING.md`**: where postings came from, what was anonymised, what the public repo contains,
that visitor keys are never stored (Phase 23 and its test in Phase 28), and what the server logs never
contain (the Phase 02 redaction list).

## 6. Steps

1. **Finalize the README.** Write sections 1–2 and 4–9 by hand. Add the markers for section 3, then run
   `pnpm --filter api readme:update -- --run <published test run id>`. Read the caption: run id, split
   `test`, n, repeats, date, price date.
2. **CI.** Add `pnpm --filter api readme:check` to `checks` (after the build of `@repo/scoring`).
3. **ADRs 0001–0007.** Start each from the table row; add the alternative you seriously considered and
   one consequence you live with (e.g. 0001: schema changes need a migration; 0003: a model that's 1 %
   off on JSON looks worse than in a product that repairs).
4. **LIMITATIONS, DATA-HANDLING.**
5. **`INTERVIEW.md`.** One answer per question, ≤ 5 sentences, each with **one number from the table**
   or a linked error from the published run:

   | Question (spec §13 + backend) | Answer from |
   | --- | --- |
   | How do you know a prompt is better? | dev/test split, n, intervals, repeats; the test-reuse flag |
   | When does few-shot help, and when not? | v1 vs v2 rows; the salary subset (`?tag=salary_lpa`); the cost column |
   | Did chain-of-thought help here? | v1 vs v3 rows, output tokens and cost; say it if it didn't |
   | Why use structured output mode? | v4's valid-JSON % vs v1's; the probe's unsupported models |
   | How do you score a list field like skills? | F1 with precision/recall and the synonym table |
   | What does temperature do? | the consistency column across 3 repeats |
   | What's a token and a context window? | prompt length vs cost per 100 between v1 and v2 |
   | How do you stop a model inventing a salary? | the null rule, the "competitive" examples, the `salary_hidden` subset score |
   | Which model would you choose and why? | the accuracy-vs-cost chart (Phase 26) |
   | How does a run survive a worker crash? | deterministic job ids + unique index (Phase 28 test) |
   | How do you keep a visitor's key safe? | synchronous calls, redaction, the leak-scan test |
   | Why PostgreSQL rather than SQLite? | ADR 0001 |
   | How do other projects consume your results? | the Playbook contract and its two-sided test |

6. **Demo GIF** (`docs/demo-script.md`, record at 1280 px, ≤ 60 s, ≤ 5 MB):
   1. task page → "New run" → pick v1 and v5 × two models, test split (0–10 s);
   2. the live SSE progress bar filling (fast-forwarded, 10–20 s);
   3. the results table: v5's row highlighted (20–30 s);
   4. click the salary column → an error card with the reason chip "LPA not converted" (30–45 s);
   5. side-by-side v1 vs v5 on that posting (45–55 s);
   6. "Publish" → the public URL (55–60 s).
   Use the published run, so every frame shows real numbers.
7. **LinkedIn post** (`docs/linkedin-post.md`, ~150 words, spec §10 day 7). `readme:update
   --print-post` fills the numbers:
   > I compared 4 prompting techniques on 3 models, using 100 job postings I labelled by hand.
   > Three things changed the results:
   > 1. {finding about few-shot and salaries, with v1 → v2 salary accuracy}
   > 2. {finding about chain-of-thought: helped or not, with tokens/cost}
   > 3. {finding about structured output and valid JSON}
   > The biggest win wasn't a technique: it was {top mistake type} and one rule that fixed it.
   > Results, the error browser and the prompts: {published run link} · Code: {repo link}
   Write the findings yourself from the README's "What I learned". Every number comes from the table.
8. **Resume bullet** (spec §12). `readme:update --print-bullet` prints it with the brackets filled from
   the published summary: v1 → best-prompt overall on the best model, valid-JSON rate of the best row,
   cost per 100 of that row. If a provider wasn't actually run, the bullet doesn't name it.
   > Built Prompt Lab, a TypeScript app (Express, PostgreSQL/Prisma, BullMQ, Next.js) that benchmarks
   > prompts across models on hand-labelled test sets; on a 100-example job-posting extraction task,
   > comparing zero-shot, few-shot, chain-of-thought and structured-output prompting raised field
   > accuracy from [X]% to [Y]% and valid-JSON rate to [Z]% at $[C] per 100 inputs.
9. **Close out.** Tick every phase in `docs/phases/README.md` whose Definition of done is complete;
   update `tracker.md` and `memory.md`; review in `tasks/todo.md`; tag `v1.0.0`.

## 7. Verify

```bash
pnpm --filter api readme:update -- --run <id>      # README section 3 replaced; git diff shows only that block
pnpm --filter api readme:check                     # exit 0
sed -i 's/| v5/| v5 /' README.md && pnpm --filter api readme:check; echo $?   # 1: drift detected; then git checkout README.md
pnpm --filter api readme:update -- --run <id> --print-bullet    # bracket-free bullet, numbers equal to the table
```

By hand: open the published run, the README and the post draft side by side; every number matches to
the shown precision. Every ADR has "alternatives" and "how we'd know we were wrong". The GIF is under
60 s and 5 MB. Ask one person to read the README cold and say what the tool does and what the best
prompt was; fix what they misread.

## 8. Definition of done

- [ ] README in spec §11 order; the results block is generated, and `readme:check` runs in CI.
- [ ] ADRs 0001–0007, `LIMITATIONS.md`, `DATA-HANDLING.md`, `INTERVIEW.md` written.
- [ ] Demo GIF, LinkedIn post draft and resume bullet use the published run's numbers only.
- [ ] No number anywhere in the repo's docs was typed by hand from memory.
- [ ] Phases ticked, `tracker.md` and `memory.md` updated, tag `v1.0.0`.

## 9. Interview angle

Open the live published run and drive the answer from it: the table, a click into the salary errors,
the v5 rule that fixed the biggest bucket, the accuracy-vs-cost chart, and which model I'd pick. Then
the engineering: *"The README table is generated from the same stored results the page shows, and CI
fails if they drift. So the number on my resume is the number you can click into."* If asked what I'd
do next: a second task to check the findings generalise, more labellers, and re-running the final
prompts when providers update their models, since a prompt that worked last month can fail today.
