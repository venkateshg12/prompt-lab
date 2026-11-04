# Scoring rules (decided before any run)

These rules are fixed **before** the first model call, because changing them after seeing results is
how benchmarks lie. They're implemented in `packages/scoring` (Phase 15), unit-tested, and copied into
the README.

## 1. Pipeline per output

| Step | Rule | Recorded as |
| --- | --- | --- |
| 1. Raw text | stored exactly as returned | `rawOutput` |
| 2. Extract JSON | technique-aware: strip ```json fences; for CoT take the **last** `<json>…</json>` block; otherwise the whole text | `extractedText` |
| 3. Valid JSON | `JSON.parse` succeeds and gives an **object** | `validJson` |
| 4. Schema valid | the task's Zod schema accepts it (types, enums, required keys) | `schemaValid` |
| 5. Field scores | the rule per field below, computed **even when the schema check fails**, field by field, with missing or ill-typed fields scoring 0 | `fieldScores` |
| 6. Overall | mean of field scores | `overallScore` |
| 7. Exact match | every field score = 1 | `exactMatch` |

No repair step, no "close the brackets", no second attempt. A prompt that breaks JSON 10 % of the
time scores 0 on those outputs, and its valid-JSON % shows it.

## 2. Field rules for the Job Posting Extractor

| Field | Kind | Rule |
| --- | --- | --- |
| `title`, `company`, `location` | `text` | lower-case, trim, remove punctuation, collapse spaces; exact after normalising. `null` matches only `null` |
| `remote` | `enum` | one of `remote`, `hybrid`, `onsite`, `unknown`, exact |
| `employment_type` | `enum` | one of `full_time`, `part_time`, `internship`, `contract`, `unknown`, exact |
| `experience_years_min` | `integer` | integer exact; `null` if not stated, and `null` must equal `null` |
| `skills` | `set_f1` | lower-case, trim, map synonyms (`js → javascript`, `reactjs`/`react.js → react`, `ts → typescript`, `node`/`nodejs → node.js`, `postgres → postgresql`, …), dedupe; score = **F1** of predicted vs expected sets; both empty = 1 |
| `stipend_or_salary` | `money` | both `null` → 1; one `null` → 0. Otherwise: same currency (else 0); convert both to **per-year amount** in that currency (`month × 12`, `week × 52`, `day × 260`, `hour × 2080`); `min` and `max` each within **±5 %** → 1, else 0. **Not partial**: a salary half-right is still wrong for a job seeker |

### Other field kinds (used by `reasoning-mini` and future tasks)

| Kind | Rule |
| --- | --- |
| `boolean` | exact; `null` matches only `null` |
| `integer` | as above (the `reasoning-mini` numeric answers use it), optional `tolerance` (absolute) defaulting to 0 |

### Reason codes

Every field score carries an optional `reason` (`fieldScores[].reason`, and the full detail in
`fieldDetails.<field>`), so the error browser and the Playbook can count mistake types without
re-scoring: `match`, `mismatch`, `missing` (field absent or ill-typed), `null_expected` (the label is
`null` and the model invented a value: the "competitive salary" hallucination case Playbook Lesson 2
counts), `null_predicted` (the label has a value, the model said `null`), `currency_mismatch`,
`out_of_tolerance`. `skills` adds `{ precision, recall }` in `fieldDetails.skills`.

**LPA**: "3–5 LPA" = 300,000–500,000 INR per **year** (L = lakh = 100,000; PA = per annum). The
expected label stores what the posting means (`{ min: 300000, max: 500000, currency: "INR", period: "year" }`),
and the scorer normalises both sides. A model answering `{ min: 25000, max: 41667, period: "month" }` is
**correct** (within 5 % after normalising).

"Competitive", "as per industry standards", "DOE" → `null`. A model that invents a number scores 0.
The README calls this out because it's the hallucination case.

## 3. Aggregates (per prompt × model)

| Metric | Definition |
| --- | --- |
| Overall | mean of `overallScore` over all results (every example × every repeat) |
| Per-field accuracy | mean of that field's score |
| Skills F1 | mean of the `skills` field score |
| Skills precision / recall | mean of the per-result precision and recall behind that F1 (recorded per result as `fieldDetails.skills = { precision, recall }`; the Playbook's Lesson 7 needs both) |
| Salary accuracy | mean of the `stipend_or_salary` field score |
| Valid JSON % | share of results with `validJson` |
| Schema valid % | share with `schemaValid` |
| Exact match % | share with every field = 1 |
| Consistency | share of examples whose repeats produced the **same normalised answer** (canonical JSON after field normalisation). Needs ≥ 2 repeats, otherwise "n/a" |
| $ / 100 inputs | (Σ cost ÷ number of results) × 100, from integer micro-dollars |
| p50 / p95 latency | percentiles of `latencyMs` over successful calls |
| Errors | count of calls that never returned (exhausted retries), shown separately and **excluded** from accuracy, but listed |

## 4. Subsets and intervals

- Every example carries `tags` (`salary_lpa`, `salary_hidden`, `remote_hinglish`, …). Every aggregate
  can be computed **per tag** (`?tag=salary_lpa`), and the export carries tags, so per-subset numbers
  never need re-scoring.
- Proportions get a **Wilson 95 % interval**, means a seeded **bootstrap** interval, both computed
  from the same per-result rows the export writes (the Playbook importer recomputes them identically).

## 5. Splits

- **dev** (30): look at these as much as you like while writing prompts. Few-shot examples come only
  from dev.
- **test** (70): only for the final reported table, run **once** per final prompt version. Re-running
  test after tweaking a prompt makes it a second dev set. If that happens, say so in the README.
