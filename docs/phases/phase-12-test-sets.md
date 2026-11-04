# Phase 12 — Test sets: import, edit, split, tags, second labels

## 1. Goal

Give each task a **test set** of hand-checked examples:
- **import** JSONL or CSV with a dry-run preview that reports every bad row by line number, rows
  upserted by their stable `ref` (`jp_017`);
- `expected` validated by the task's own answer schema (Phase 11), the one the scorer uses;
- a **dev/test split**, manual or a deterministic stratified auto-split by tag;
- **tags** for tricky cases (`salary_lpa`, `salary_hidden`, `remote_wfh`, `skills_buried`,
  `missing_fields`, …) so every aggregate can be reported per subset (scoring-rules.md §4);
- **edit** in place: an `expected` change bumps `revision` and is audited;
- **second labels** by a `reviewer` (the spec's "ask a friend to double-check 20") with a per-field
  agreement report;
- **export** in the Playbook's case-line format (playbook-contract.md §2).

## 2. What I will understand after this phase

1. Why labels are validated by the same schema the scorer uses.
2. Why import is preview → commit, and idempotent by an external id.
3. Why the split is deterministic and stratified, and why moving an example out of *test* after a
   test run is a red flag that gets recorded, not hidden.
4. How `revision` lets old results be flagged stale instead of silently wrong.
5. What inter-annotator agreement tells you about your own labels.

## 3. Prerequisites

Phase 11 done. The `reviewer` role and permissions `examples.read` / `examples.label` exist
(Phase 10).

## 4. Files

```
packages/types/src/
├── caseLine.ts                           NEW   (case-line schema = playbook-contract §2; import/list/update schemas)
└── index.ts                              ADAPT
apps/api/
├── prisma/schema.prisma                  ADAPT (+ enum Split, model Example; Task.examples)
├── prisma/migrations/<ts>_examples/      NEW
└── src/
    ├── utils/importers/{jsonl,csv}.ts    NEW   (line-numbered parsing)
    ├── services/example.service.ts       NEW   (preview, commit, list, update, split, second label, agreement, export)
    ├── controllers/example.controller.ts NEW
    ├── routes/example.route.ts           NEW   (under /orgs/:orgId/tasks/:taskId/examples)
    ├── app.ts                            ADAPT
    └── scripts/import-cases.ts           ADAPT (+ cases/<case>/data/*.jsonl through the same service)
```

```bash
pnpm --filter api add csv-parse
```

`csv.ts`'s formula-injection escaping for *exports* comes later (`@pt-api/src/utils/csv.ts`, Phase 22).
This phase only parses CSV.

## 5. Concepts

**One schema for labels and outputs.** If a label says `remote: "wfh"` but the scorer only knows
`remote | hybrid | onsite | unknown`, that example can never be scored correct. Import validates
`expected` with `answerSchemaFor(task.fields)` and refuses the row with the exact issue
(`line 14: expected.remote: Invalid option`).

**Preview → commit.** `POST …/examples/import` with `dryRun: true` returns
`{ valid, invalid: [{ line, ref, issues }], new, changed, unchanged }` and writes nothing. The commit
(`dryRun: false`) is **refused while any row is invalid**: a half-imported test set is worse than none.
Rows upsert by `(taskId, ref)`, so re-importing a corrected file updates exactly the changed rows.

**File formats.**
- JSONL, the spec's and the Playbook's format, one object per line:
  `{"id":"jp_001","split":"dev","tags":["salary_lpa"],"input":"…","expected":{…}}`.
  The file's `id` is stored as `Example.ref` and exported back as `id`/`exampleId`.
- CSV: columns `id,split,tags,input,expected`; `tags` `;`-separated, `expected` a JSON string. Quoted
  multi-line inputs work, and each record keeps its starting line number for errors.

Caps: 3 MB per import body (on this route only), 1,000 examples per task, 20,000 characters per input.

**Deterministic, stratified split.** Auto-split puts `round(n × 0.3)` of each **tag group** into dev
(untagged examples form their own group), so dev has LPA salaries and so does test. Order within a
group is `sha256(task.slug + ":" + ref)`, so running it again gives the same split, on any machine.
By default only examples without a split are assigned. `reassign: true` is allowed only while the task
has no test run (Phase 17 adds that check; until then it's a `// Phase 17:` comment).

**Protecting test.** The benchmark's credibility rests on never tuning on test. Code enforces what it
can:
- few-shot examples come only from dev (Phase 13 checks it on save and again when a run freezes the
  prompt);
- runs default to dev, and a test run records `testReused` (Phase 17);
- moving an example from test → dev is allowed (it's your data) but writes an `example.split_moved`
  audit row. Phase 22's README export lists those examples.

**Revision.** Editing `expected` (or `input`) increments `revision`, and the audit row keeps the old
value. `Run.datasetHash` is computed over `(ref, revision)` pairs (Phase 17), so the results page can
say "2 examples changed since this run" and offer a re-score, which needs no model calls.

**Second labels and agreement.** A reviewer labels an example blind: the UI (Phase 19) hides
`expected` while they label. Their answer, validated by the same schema, is stored in `secondLabel`.
`GET …/examples/agreement` reports, per field, the share of double-labelled examples where both labels
agree, plus the disagreeing refs. Until Phase 16 exists, "agree" means equal after JSON
canonicalisation. Phase 16 swaps in the field scorers (so `["JS"]` vs `["javascript"]` agree, and LPA
vs monthly agree within 5 %). Disagreements are resolved by you, editing `expected` with a `notes`
line explaining why. Phase 24 reports the final agreement in the README.

**Public inputs.** Postings may be third-party text. `publicInput: false` hides an example's input on
published pages and in the public export (`?public=true` replaces `input` with `"[hidden]"`).

## 6. Steps

### 6.1 Schemas (`packages/types/src/caseLine.ts`)

```ts
import { z } from "zod";

export const SPLITS = ["dev", "test"] as const;
export const exampleRefSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/);
export const tagSchema = z.string().regex(/^[a-z0-9_]{1,40}$/);

/** One line of a case file. EXACTLY the Playbook's promptLabCaseLineSchema, with `expected` required for import. */
export const caseLineSchema = z.object({
    id: exampleRefSchema,
    split: z.enum(SPLITS).optional(),             // missing → unassigned until auto-split
    tags: z.array(tagSchema).max(20).default([]),
    input: z.string().min(1).max(20_000),
    expected: z.unknown(),                        // validated against the task's answer schema in the service
    publicInput: z.boolean().optional(),          // extra key; the Playbook's schema strips unknown keys
    notes: z.string().max(2000).optional(),
});
export type CaseLine = z.infer<typeof caseLineSchema>;

export const importExamplesSchema = z.object({
    format: z.enum(["jsonl", "csv"]),
    content: z.string().max(3_000_000),
    dryRun: z.boolean().default(true),
});

export const listExamplesQuerySchema = z.object({
    split: z.enum(SPLITS).optional(),
    tag: tagSchema.optional(),
    q: z.string().max(100).optional(),            // ref or input substring
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const updateExampleSchema = z.object({
    input: z.string().min(1).max(20_000).optional(),
    expected: z.unknown().optional(),
    split: z.enum(SPLITS).optional(),
    tags: z.array(tagSchema).max(20).optional(),
    publicInput: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
});

export const autoSplitSchema = z.object({ devShare: z.number().min(0.05).max(0.95).default(0.3), reassign: z.boolean().default(false) });
```

### 6.2 Prisma

Add `enum Split` and `model Example` exactly as data-model.md (`ref`, `split`, `tags`, `input`,
`expected Json`, `publicInput`, `secondLabel`, `secondLabelById`, `notes`, `revision`,
`@@unique([taskId, ref])`, `@@index([taskId, split])`), plus `examples Example[]` on `Task`. The
`results` back-relation arrives in Phase 17. `split` is required in data-model.md, so an unassigned
row from a file without `split` is stored as `dev` **and** tagged `_unsplit`. Auto-split then
reassigns exactly the `_unsplit` rows and removes the tag.

```bash
pnpm --filter api exec prisma migrate dev --name examples < /dev/null && pnpm --filter api exec prisma generate
```

### 6.3 Importers

```ts
// utils/importers/jsonl.ts
export type Parsed = { line: number; value?: unknown; error?: string };

export const parseJsonl = (content: string): Parsed[] =>
    content
        .split(/\r?\n/)
        .map((text, i) => ({ line: i + 1, text: text.trim() }))
        .filter((l) => l.text.length > 0)
        .map(({ line, text }) => {
            try {
                return { line, value: JSON.parse(text) as unknown };
            } catch (e) {
                return { line, error: `Invalid JSON: ${(e as Error).message}` };
            }
        });
```

```ts
// utils/importers/csv.ts
import { parse } from "csv-parse/sync";
import type { Parsed } from "./jsonl";

export const parseCsv = (content: string): Parsed[] =>
    (parse(content, { columns: true, skip_empty_lines: true, info: true }) as {
        record: Record<string, string>;
        info: { lines: number };
    }[]).map(({ record, info }) => {
        try {
            return {
                line: info.lines,
                value: {
                    ...record,
                    split: record.split || undefined,
                    tags: record.tags ? record.tags.split(";").map((t) => t.trim()).filter(Boolean) : [],
                    expected: JSON.parse(record.expected ?? ""),
                },
            };
        } catch (e) {
            return { line: info.lines, error: `expected is not valid JSON: ${(e as Error).message}` };
        }
    });
```

> Check `csv-parse`'s `info` shape in its current docs (`info.lines` is the line where the record
> **ends**; use `info.lines` consistently and say "near line N" in messages).

### 6.4 Service (`services/example.service.ts`)

```ts
const canonical = (v: unknown) => JSON.stringify(v, Object.keys((v ?? {}) as object).sort());

export const importExamples = async (orgId: string, taskId: string, body: ImportBody, actor: AuditActor) => {
    const task = await getTask(taskId);                                    // Phase 11, re-validated fields
    const answer = answerSchemaFor(task.fields);
    const rows = body.format === "jsonl" ? parseJsonl(body.content) : parseCsv(body.content);

    const invalid: { line: number; ref?: string; issues: string[] }[] = [];
    const valid: (CaseLine & { line: number })[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        if (row.error) { invalid.push({ line: row.line, issues: [row.error] }); continue; }
        const line = caseLineSchema.safeParse(row.value);
        if (!line.success) { invalid.push({ line: row.line, issues: line.error.issues.map(fmt) }); continue; }
        if (seen.has(line.data.id)) { invalid.push({ line: row.line, ref: line.data.id, issues: ["duplicate id in file"] }); continue; }
        seen.add(line.data.id);
        const expected = answer.safeParse(line.data.expected);
        if (!expected.success) {
            invalid.push({ line: row.line, ref: line.data.id, issues: expected.error.issues.map((i) => `expected.${fmt(i)}`) });
            continue;
        }
        valid.push({ ...line.data, expected: expected.data, line: row.line });
    }

    const existing = new Map(
        (await prisma.example.findMany({ where: { taskId, ref: { in: valid.map((v) => v.id) } } })).map((e) => [e.ref, e])
    );
    const plan = valid.map((v) => {
        const old = existing.get(v.id);
        const labelChanged = old && (old.input !== v.input || canonical(old.expected) !== canonical(v.expected));
        const metaChanged = old && (old.split !== (v.split ?? old.split) || canonical(old.tags) !== canonical(v.tags));
        return { v, old, kind: !old ? "new" : labelChanged || metaChanged ? "changed" : "unchanged", labelChanged } as const;
    });
    const summary = {
        valid: valid.length, invalid,
        new: plan.filter((p) => p.kind === "new").length,
        changed: plan.filter((p) => p.kind === "changed").length,
        unchanged: plan.filter((p) => p.kind === "unchanged").length,
    };
    const total = (await prisma.example.count({ where: { taskId } })) + summary.new;
    appAssert(total <= 1000, BAD_REQUEST, "A task holds at most 1,000 examples");
    if (body.dryRun || invalid.length > 0) return { dryRun: true, ...summary };

    await withTransaction(async (tx) => {
        for (const { v, old, kind, labelChanged } of plan) {
            if (kind === "unchanged") continue;
            const data = {
                input: v.input, expected: v.expected as Prisma.InputJsonValue,
                tags: v.split ? v.tags : [...new Set([...v.tags, "_unsplit"])],
                split: v.split ?? old?.split ?? "dev",
                publicInput: v.publicInput ?? old?.publicInput ?? true,
                notes: v.notes ?? old?.notes,
            };
            if (!old) await tx.example.create({ data: { orgId, taskId, ref: v.id, ...data } });
            else {
                await tx.example.update({ where: { id: old.id }, data: { ...data, ...(labelChanged ? { revision: { increment: 1 } } : {}) } });
                if (labelChanged) {
                    await recordAudit({ orgId, actor, action: "example.relabel", target: { type: "example", id: old.id },
                        diff: { expected: { from: old.expected, to: v.expected } } }, tx);
                }
            }
        }
    });
    return { dryRun: false, ...summary };
};
```

`updateExample(orgId, taskId, id, body, actor)`: re-validates `expected` with the answer schema,
increments `revision` when `input` or `expected` changes, audits `example.relabel` with the old value,
and audits `example.split_moved` when `split` goes test → dev (with `// Phase 17: flag when a test
run already used it`).

`autoSplit(taskId, { devShare, reassign })`:

```ts
const order = (slug: string, ref: string) => createHash("sha256").update(`${slug}:${ref}`).digest("hex");
// group by first real tag (sorted) or "_none"; within a group sort by order(); first round(n × devShare) → dev
```

It updates in one transaction and returns `{ dev, test, groups: { salary_lpa: { dev: 3, test: 7 }, … } }`.

`setSecondLabel(exampleId, label, reviewerId)`: validates `label` with the answer schema, stores it,
and refuses when `reviewerId` is the user who last relabelled `expected` (from the audit log: blind
double-labelling means a different person).

`agreement(taskId)`:

```ts
// For each field key: agree / total over examples that have a secondLabel.
// Phase 16: replace `same` with scoreField(rule, a, b) === 1 so normalisation and tolerances apply.
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
return { examples: n, fields: rules.map((r) => ({ key: r.key, agree, total: n, rate: agree / n, disagreements: refs })) };
```

`exportExamples(taskId, { split?, public? })` streams JSONL lines in the case-line shape:
`{ id: ref, split, tags (minus "_unsplit"), input (or "[hidden]" when public and !publicInput), expected }`.

### 6.5 Routes

```ts
export const exampleRouter = Router({ mergeParams: true });              // /orgs/:orgId/tasks/:taskId/examples
exampleRouter.use(authenticate, protectedApiLimiter, resolveOrg);
exampleRouter.get("/", requireOrgRole("examples.read"), listExamplesHandler);          // cursor list (pageOf)
exampleRouter.post("/import", express.json({ limit: "3mb" }), requireOrgRole("examples.label"), importExamplesHandler);
exampleRouter.post("/split", requireOrgRole("tasks.manage"), autoSplitHandler);
exampleRouter.get("/agreement", requireOrgRole("examples.read"), agreementHandler);
exampleRouter.get("/export.jsonl", requireOrgRole("examples.read"), exportExamplesHandler);   // application/x-ndjson
exampleRouter.patch("/:exampleId", requireOrgRole("examples.label"), updateExampleHandler);
exampleRouter.put("/:exampleId/second-label", requireOrgRole("examples.label"), secondLabelHandler);
exampleRouter.delete("/:exampleId", requireOrgRole("tasks.manage"), deleteExampleHandler);   // Phase 17: 409 if results reference it
```

Mount the route-level `express.json({ limit: "3mb" })` **before** the app-wide 64 kb parser sees the
body: register `app.use("/orgs/:orgId/tasks/:taskId/examples/import", express.json({ limit: "3mb" }))`
ahead of the global `express.json()` in `app.ts`. The Playbook build showed what happens otherwise:
the global parser answers 413 first.

### 6.6 `import-cases.ts`

After the task, read every `cases/<case>/data/*.jsonl`, call `importExamples` with `dryRun: true`,
print the summary, abort on any invalid row, then commit. `--dry-run` stops after the preview.

## 7. Verify

1. A 5-line JSONL with one bad enum (line 2) and one broken line (line 4) → dry run lists both with
   issues; `dryRun: false` → still a dry-run response, nothing written.
2. Fix it, commit → 5 examples. Re-import unchanged → `unchanged: 5`. Change one label → `changed: 1`,
   that row's `revision: 2`, and an `example.relabel` audit row with the old `expected`.
3. The same data as CSV, with a multi-line quoted input → same counts.
4. A file without `split` → rows tagged `_unsplit`. Auto-split 100 tagged examples → 30 dev; every tag
   with ≥ 2 examples appears in both splits; run it again → identical assignment
   (`SELECT ref, split FROM examples ORDER BY ref` diff is empty).
5. As a reviewer, PUT a second label on 3 examples (one disagreeing on `remote`) →
   `GET …/agreement` shows `remote` 2/3 with that ref.
6. `GET …/export.jsonl?public=true` → every line parses with a copy of the Playbook's
   `promptLabCaseLineSchema` (`node -e` over the stream), and private inputs show `[hidden]`.
7. Another workspace's org id → 404. A viewer PATCH → 403. A 4 MB import body → 413.

## 8. Definition of done

- [ ] JSONL and CSV import with a line-numbered dry run; labels validated by the task's schema;
      commit refused while anything is invalid.
- [ ] Upsert by `ref`; `revision` + audit on every label change; split moves audited.
- [ ] Deterministic stratified auto-split; tags; `publicInput`.
- [ ] Blind second labels and a per-field agreement report.
- [ ] Export in the Playbook's case-line format.
- [ ] Commit: `feat: test sets — import, validate, split, second labels`.

## 9. Interview angle

*"Where does your benchmark's credibility come from?"* Hand-checked labels validated by the scorer's
own schema, a second labeller on a sample with measured per-field agreement, a deterministic stratified
dev/test split, few-shot drawn only from dev, and the test set run once. Label edits are versioned and
audited, so a result scored against an older label is flagged instead of silently wrong.
