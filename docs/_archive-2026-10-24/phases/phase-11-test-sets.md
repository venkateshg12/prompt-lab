# Phase 11 — Test sets: import, edit, split

## 1. Goal

Give each task a **test set** of `{ input, expected }` examples:
- **import** JSONL or CSV, with a dry-run preview that reports every bad row by line number;
- `expected` validated against the task's derived answer schema;
- a **dev/test split** (manual, or a deterministic stratified auto-split by tag);
- **tags** for tricky cases (`salary_lpa`, `wfh`, `skills_buried`, `missing_fields`, …);
- **edit** in place, with label versions, so results know when their label changed;
- **guards** that protect the test split from leaking into prompt development.

## 2. What I will understand after this phase

1. Why labels are validated by the same schema the scorer uses.
2. Why import is preview → commit, and idempotent by an external id.
3. Why the split is deterministic and stratified, and why moving an example out of *test* after
   results exist is a red flag, not an edit.
4. How a label version lets old results be marked stale instead of silently wrong.

## 3. Prerequisites

Phase 10 done.

## 4. Files

```
packages/types/src/example.ts                    NEW   (import row, update, list query schemas)
apps/api/src/
├── models/example.model.ts                      NEW
├── services/example.service.ts                  NEW   (parse, validate, preview, commit, split, update)
├── utils/importers/{jsonl,csv}.ts               NEW   (line-numbered parsing)
├── controllers/example.controller.ts · routes/example.route.ts   NEW
└── scripts/seed-job-postings.ts                 ADAPT (+ examples from cases/job-postings/data/job_postings.jsonl)
```

```bash
pnpm --filter api add csv-parse
```

## 5. Concepts

**Same schema for labels and outputs.** If the label for `remote` says `"wfh"` but the scorer only
knows `remote|hybrid|onsite|unknown`, that example can never be scored correctly. Import validates
`expected` with `answerSchemaFor(task.fields)` (Phase 10), the schema the scorer uses, and refuses the
row with the exact issue (`line 14: expected.remote: Invalid option`).

**Preview → commit.** `POST …/examples/import?dryRun=true` returns
`{ valid: n, invalid: [{ line, id, issues }], new, changed, unchanged }` and writes nothing. The UI
shows it, and the user confirms with `dryRun=false`. Rows upsert by `{ taskId, externalId }`
(`jp_001`), so re-importing a corrected file updates exactly the changed rows. That's the same
idempotency rule as everything else in this architecture.

**File formats.**
- JSONL (the spec's format):
  `{"id":"jp_001","split":"dev","tags":["salary_lpa"],"input":"…","expected":{…}}`, one object per line.
- CSV: columns `id,split,tags,input,expected`, where `tags` is `;`-separated and `expected` is a JSON
  string. Parsed with `csv-parse` (quoted multiline inputs work), and each record's line number is kept
  for errors.

Caps: 2 MB per import, 1,000 examples per task, 20,000 characters per input. Inputs are text, so
there are no uploads to storage. The body is `{ format, content }` JSON with `express.json({ limit: "3mb" })`
on this route only.

**Deterministic, stratified split.** Auto-split puts ~30 % in dev **within each tag group**, so dev
contains salary-in-LPA cases and so does test. Assignment is a hash of `externalId` plus a fixed seed
stored on the task (`splitSeed`), so re-running it gives the same split. The spec's numbers: 30 dev,
70 test out of 100.

**Protecting test.** The spec's credibility rests on prompts never being tuned on test. Code enforces
what it can:
- few-shot examples may only come from `dev` (Phase 12 validates it);
- the run launcher defaults to `dev`, and running `test` requires a confirmation and records
  `run.split = "test"` (Phase 19);
- moving an example from `test` → `dev` after any test run used it is allowed (it's your data) but
  writes `splitChangedAfterTestRun: true` on the example, and the README export (Phase 21) lists those
  examples. Transparency over prohibition.

**Label versions.** Editing `expected` increments `labelVersion`. Results store the `labelVersion`
they were scored against, so the results view flags "3 results scored against an older label —
re-score". Re-scoring needs no model calls (Phase 17).

**Second labeller.** The spec asks a friend to double-check 20 labels. `secondLabel` (optional) stores
their version, and the example page shows a field-level diff. Phase 23 reports the agreement rate,
using the same field scorers (Phase 15). Disagreements are resolved into `expected` by you, with a
`labelNotes` line explaining why.

## 6. Steps

### 6.1 Model

```ts
const exampleSchema = new mongoose.Schema({
    ownerId: { type: Schema.Types.ObjectId, required: true },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    externalId: { type: String, required: true, maxlength: 64 },
    split: { type: String, enum: ["dev", "test"], required: true },
    tags: { type: [String], default: [] },
    input: { type: String, required: true, maxlength: 20_000 },
    expected: { type: Schema.Types.Mixed, required: true },
    labelVersion: { type: Number, default: 1 },
    secondLabel: Schema.Types.Mixed,
    labelNotes: { type: String, maxlength: 2000 },
    source: { type: String, maxlength: 200 },            // "linkedin, anonymised", "internshala", …
    splitChangedAfterTestRun: { type: Boolean, default: false },
}, { timestamps: true });
exampleSchema.index({ taskId: 1, externalId: 1 }, { unique: true });
exampleSchema.index({ ownerId: 1, taskId: 1, split: 1, createdAt: -1, _id: -1 });
```

### 6.2 Importers

```ts
// utils/importers/jsonl.ts
export const parseJsonl = (content: string) =>
    content.split(/\r?\n/).map((line, index) => ({ line: index + 1, text: line.trim() }))
        .filter((l) => l.text.length > 0)
        .map(({ line, text }) => {
            try { return { line, value: JSON.parse(text) as unknown }; }
            catch (e) { return { line, error: `Invalid JSON: ${(e as Error).message}` }; }
        });
```

```ts
// utils/importers/csv.ts — csv-parse with `info: true` gives each record's starting line
import { parse } from "csv-parse/sync";
export const parseCsv = (content: string) =>
    (parse(content, { columns: true, skip_empty_lines: true, info: true, relax_column_count: false }) as
        { record: Record<string, string>; info: { lines: number } }[])
        .map(({ record, info }) => {
            try {
                return { line: info.lines, value: { ...record, tags: record.tags ? record.tags.split(";").map((t) => t.trim()) : [],
                                                    expected: JSON.parse(record.expected) } };
            } catch (e) { return { line: info.lines, error: `expected is not valid JSON: ${(e as Error).message}` }; }
        });
```

> Check `csv-parse`'s `info` option shape in its current docs (`info.lines` vs `info.line`).

### 6.3 Service

```ts
export const importExamples = async (ownerId: Types.ObjectId, taskId: string, body: ImportBody) => {
    const task = await getTask(ownerId, taskId);
    const answerSchema = answerSchemaFor(fieldRulesSchema.parse(task.fields));
    const rows = body.format === "jsonl" ? parseJsonl(body.content) : parseCsv(body.content);

    const invalid: { line: number; id?: string; issues: string[] }[] = [];
    const valid: ImportRow[] = [];
    for (const row of rows) {
        if ("error" in row) { invalid.push({ line: row.line, issues: [row.error!] }); continue; }
        const parsed = importRowSchema.safeParse(row.value);                          // id, split?, tags, input, expected
        if (!parsed.success) { invalid.push({ line: row.line, issues: parsed.error.issues.map(fmt) }); continue; }
        const expected = answerSchema.safeParse(parsed.data.expected);
        if (!expected.success) {
            invalid.push({ line: row.line, id: parsed.data.id, issues: expected.error.issues.map((i) => `expected.${fmt(i)}`) });
            continue;
        }
        valid.push({ ...parsed.data, expected: expected.data });
    }
    // duplicate ids inside the file are an error, not "last one wins"
    // … compute new / changed (deep-equal on input+expected+tags+split) / unchanged against existing rows …
    if (body.dryRun || invalid.length > 0) return { dryRun: true, valid: valid.length, invalid, new: n, changed: c, unchanged: u };
    // bulkWrite upserts; changed `expected` → $inc labelVersion
    return { dryRun: false, … };
};
```

Commit is refused while any row is invalid: fix the file, then re-import. A half-imported test set is
worse than none.

`autoSplit(taskId, { devShare: 0.3 })`: per tag group (examples with no tags form their own group),
sort by `sha256(splitSeed + externalId)`, then take the first `round(n × devShare)` as dev. Only
unassigned examples, or all with `{ reassign: true }` before any run exists.

Routes (`authenticate, protectedApiLimiter`):
- `GET /tasks/:id/examples?split&tag&cursor&limit`;
- `POST /tasks/:id/examples/import`;
- `POST /tasks/:id/examples/split`;
- `PATCH /examples/:id` (input / expected / tags / split / secondLabel / labelNotes; expected
  re-validated; `labelVersion++`);
- `DELETE /examples/:id` (refused if results reference it; mark `archivedAt` instead).

### 6.4 Seed

The seed script reads `cases/job-postings/data/job_postings.jsonl` (when present) through the **same**
`importExamples` (dry-run first, abort on invalid rows).

## 7. Verify

1. Import a 5-line JSONL with one bad enum and one broken line → dry run lists lines 2 and 4 with
   their issues; commit is refused.
2. Fix it → commit → 5 examples. Re-import unchanged → `unchanged: 5`. Change one label → `changed: 1`,
   `labelVersion: 2`.
3. The same data as CSV, with a multi-line quoted `input` → same result.
4. Auto-split 100 tagged examples → ~30 dev, each tag present in both splits; run it again → identical
   assignment.
5. Another user's task id → 404.

## 8. Definition of done

- [ ] JSONL and CSV import with a line-numbered dry run; labels validated by the task schema.
- [ ] Deterministic stratified split; label versions; the second-label field.
- [ ] Test-split guards recorded, not hidden.
- [ ] Commit: `feat: test sets — import, validate, split`.

## 9. Interview angle

*"Where does your benchmark's credibility come from?"* Hand-checked labels validated by the scorer's
own schema, a deterministic stratified dev/test split, few-shot drawn only from dev, and the test set
run once. Label edits are versioned, so old scores are flagged instead of silently wrong.
