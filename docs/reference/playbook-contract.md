# The Playbook contract (binding)

The Prompt Engineering Playbook (`~/Code/prompt-engineering-playbook`) publishes lessons whose numbers
come only from Prompt Lab runs. **Its importer is already built** (`apps/site/scripts/import-prompt-lab.ts`,
schemas in its `packages/types/src/importContracts.ts`). Prompt Lab's exports must match those schemas
exactly. If you want to change a field, change both repos in the same day and re-run the Playbook's
importer tests.

## 1. Result lines: `GET …/runs/:id/export/results.jsonl` and `bench --out <file>`

One JSON object per cell (variant × example × repeat):

```ts
{
  runId: string,                       // Run.id
  split: "dev" | "test",               // one run = one split
  promptVersion: string,               // frozen id, e.g. "v2-few-shot@1"  (PromptVersion.key + "@" + version)
  modelKey: string,                    // registry key, e.g. "nvidia:openai/gpt-oss-20b"
  exampleId: string,                   // Example.ref, e.g. "jp_017"
  repeat: number,                      // 0-based
  status: "scored" | "error" | "skipped",   // skipped = structured output unsupported for this model
  rawOutput?: string | null,           // verbatim model text
  validJson?: boolean | null,
  schemaValid?: boolean | null,
  exactMatch?: boolean | null,
  overallScore?: number | null,        // 0–1
  fieldScores?: { key: string, score: number }[] | null,   // every field of the task, 0–1
  outputTokens?: number | null,
  costUsdMicros?: number | null,
  latencyMs?: number | null,
  completedAt?: string | null          // ISO datetime
}
```

Extra keys are allowed (the Playbook's Zod object strips unknown keys). Prompt Lab adds `tags`,
`fieldDetails` (e.g. `{ skills: { precision, recall } }`), `inputTokens`, `error`, `testReused`. Never
remove or rename a key above.

## 2. Case lines: `cases/<task>/data/*.jsonl` and `GET …/tasks/:taskId/examples/export.jsonl`

```ts
{ id: string, split: "dev" | "test", tags: string[], input: string, expected?: unknown }
```

The public repo's `cases/job-postings/data/job_postings.jsonl` is in this shape, with anonymised
inputs only (Phase 24).

## 3. What each Playbook lesson needs from Prompt Lab

| Playbook lesson (its phase) | Needs | Built in Prompt Lab phase |
| --- | --- | --- |
| 1 Be specific (24) | prompt version `v0-vague@1` on job postings, run alongside `v1-zero-shot` | 25 |
| 2 Few-shot (25) | `v1-zero-shot` vs `v2-few-shot` (+ `v2b-one-shot`), tags `salary_lpa`, `salary_hidden` | 12 (tags), 25 |
| 3 Chain-of-thought (26) | task `reasoning-mini` (30 questions, 10 dev / 20 test) with `direct@1` and `cot@1`; plus v1 vs v3 on job postings; `tokens_out_mean` | 25 |
| 4 Structured output (27) | v1 vs v4 per model + the probe result per model as CSV (`probe-structured.ts --csv`) | 15 |
| 7 Testing prompts (30) | `v1-thorough@1` (looks better on 5 hand-picked examples), dev vs test runs, repeat variance, skills precision/recall in `fieldDetails` | 16, 25 |

All variant prompts are **prompt versions in `cases/*/prompts/`**, never code forks. Every one is run
through the same runner and scorer.

## 4. Re-checking the contract

`apps/api/test/playbookContract.int.test.ts` (Phase 27) parses a real export with a copy of the Playbook's
`promptLabResultLineSchema` / `promptLabCaseLineSchema`, and the Phase 27 Verify runs the Playbook's
own importer against that export (`--dry-run`).
