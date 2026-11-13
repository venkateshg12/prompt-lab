# Labelling guide: job postings

How every `expected` label in `data/job_postings.jsonl` is decided. The scoring rules in
`docs/reference/scoring-rules.md` §2 are binding; this guide turns them into labelling decisions.
**Write each new decision into the log below the first time you meet it, then label consistently.**

Anonymise first, then label the anonymised text: the label matches what is published (including the
fictional company name from `SOURCES.md`).

## The fields

| Field | Label | Notes |
| --- | --- | --- |
| `title` | the role as written ("Frontend Developer Intern") | `null` only if no title at all |
| `company` | the (fictional) company name | `null` for agency posts that hide the employer |
| `location` | the city/region as written | `null` if not stated; "Remote" is not a location |
| `remote` | `remote` · `hybrid` · `onsite` · `unknown` | see decisions |
| `employment_type` | `full_time` · `part_time` · `internship` · `contract` · `unknown` | |
| `experience_years_min` | integer | "fresher" / "0–1 years" → 0; "1+ years" → 1; not stated → `null` |
| `skills` | technical skills, lower case | soft skills are not skills; stacks expand |
| `stipend_or_salary` | `{ min, max, currency, period }` or `null` | store what the posting MEANS; the scorer normalises per year |

## Decisions (the log)

Decided up front (from `scoring-rules.md` §2 and the phase-24 guide):

1. **Stacks expand.** "MERN" → `mongodb, express, react, node.js`. If the scorer needs a new synonym, it
   goes into Phase 16's synonym table with a test, never into a label.
2. **Soft skills are not skills.** "communication", "teamwork", "problem solving" are left out.
3. **Experience.** "fresher" / "0–1 years" → 0; "1+ years" → 1; "2–4 years" → 2; not stated → `null`.
4. **LPA / CTC.** "3–5 LPA" → `{ min: 300000, max: 500000, currency: "INR", period: "year" }`;
   "₹6L CTC" → `{ min: 600000, max: 600000, currency: "INR", period: "year" }`.
5. **"Up to".** "up to ₹25k/month" → `{ min: null, max: 25000, currency: "INR", period: "month" }`.
6. **Hidden salary.** "competitive", "as per industry", "not disclosed", "DOE" → `null`. This is the
   hallucination test: a model that invents a number scores 0.
7. **Hourly / foreign.** "$50/hr" → `{ min: 50, max: 50, currency: "USD", period: "hour" }`; keep the
   posting's currency, never convert.
8. **Remote vs hybrid.** A city plus "remote option" → `hybrid` only if office days are named ("2 days
   in office"); otherwise `remote`. "WFH" / "work from anywhere" → `remote`. "Remote (India only)" →
   `remote`. Nothing said → `unknown`.
9. **Internships.** Any "intern" / "internship" role → `employment_type: internship`, even with a PPO.

Add new decisions here, numbered, with the example ref that raised them:

| # | Decision | First seen in |
| --- | --- | --- |
| 10 | | |

## Sheet format (for `sheet-to-jsonl.ts`)

Columns: `id, split, tags, input, notes, publicInput, title, company, location, remote, employment_type,
experience_years_min, skills, stipend_or_salary`.

- `tags`: separated by `;` (e.g. `salary_lpa;internship`). Keep the names `salary_lpa` and
  `salary_hidden`: the Playbook's Lesson 2 reads them.
- `skills`: separated by `;` or `,`. Empty cell = `[]`.
- `stipend_or_salary`: empty = `null`; JSON (`{"min":…}`), or shorthand `300000-500000 INR year`,
  `25000 INR month` (min = max), `-25000 INR month` (max only).
- `publicInput`: `false` for a posting that can't be republished even anonymised.
- Leave `split` empty: `stratified-split.ts` assigns it.
