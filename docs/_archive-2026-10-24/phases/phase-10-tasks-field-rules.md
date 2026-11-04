# Phase 10 — Tasks and the field-rule DSL

## 1. Goal

Model a **task** generically: a name, the shared instructions, and the expected output as a list of
**field rules**. Each rule says what the field is *and how it's scored*:

| `kind` | Value | Scored by |
| --- | --- | --- |
| `text` | string or null | normalised exact match |
| `enum` | one of `values` | exact |
| `integer` | integer or null | exact |
| `set_f1` | string[] | F1 over normalised sets, with a synonym table |
| `money` | `{ min, max, currency, period }` or null | per-year normalisation, ±tolerance |

From the rules, code **derives** the answer's Zod schema (used to validate labels and outputs) and a
JSON Schema (used for the structured-output technique in Phase 14). The job-posting task is seeded
from files in the repo.

## 2. What I will understand after this phase

1. Why scoring rules live **with the task**, not in code per task.
2. How one rule list produces a Zod schema, a JSON Schema and a scorer: one source of truth.
3. Why changing a task's rules after runs exist needs a `fieldsVersion` and a re-score.
4. Why the case study lives in files (git-tracked) and is seeded into the database.

## 3. Prerequisites

Phase 09 done.

## 4. Files

```
packages/types/src/
├── fieldRules.ts                 NEW   (the DSL + answerSchemaFor + jsonSchemaFor)
├── task.ts                       NEW   (create/update schemas)
└── index.ts                      ADAPT
apps/api/src/
├── models/task.model.ts          NEW
├── services/task.service.ts      NEW
├── controllers/task.controller.ts · routes/task.route.ts   NEW
├── scripts/seed-job-postings.ts  NEW   (task + prompts + examples from cases/job-postings/)
└── app.ts                        ADAPT (mount /tasks)
cases/job-postings/
├── task.json                     NEW   (the field rules for the case study)
├── prompts/                      (Phase 24 fills v1…v5)
└── data/job_postings.jsonl       (Phase 23 fills it)
```

The spec suggests `prompts/` and `data/` at the repo root. Grouping them under `cases/job-postings/`
makes a second case study a second folder. Mention the mapping in the README.

## 5. Concepts

**Rules with the task.** The scorer (Phase 15) is generic: it walks the task's rules. A second task
(say, "extract product attributes") needs only a new `task.json`, and the app, runner, scorer and
results UI all work unchanged. That generality is the point: Prompt Lab is a tool; the job-posting
extractor is one case study.

**One list, three artefacts.**

```
fields (rules) ──► answerSchemaFor(fields)  : Zod      → validate labels on import (Phase 11), schema check (Phase 15)
               ├─► jsonSchemaFor(fields)    : JSON Schema → structured-output mode (Phase 14), shown in the UI
               └─► scoreFields(fields, …)   : scores   → Phase 15
```

Hand-writing the schema next to the rules is how they drift ("the scorer expects `remote`, the schema
says `work_mode`").

**`fieldsVersion`.** Rules are the definition of "correct". Changing one after a run (adding a
synonym, loosening a tolerance) changes past scores. So a rules change increments `fieldsVersion`,
results record the version they were scored with, and the results view says *"scored with rules v2;
re-score to v3"*. Re-scoring is cheap and needs no model calls, because raw outputs are stored
(Phase 17).

**Files → database.** The case study must be reproducible from git: task rules, prompt texts and
labelled data are files. `seed-job-postings.ts` upserts them (idempotent by `slug`), so a fresh clone
is one command away from the same experiment.

## 6. Steps

### 6.1 The DSL (`@repo/types/src/fieldRules.ts`)

```ts
import { z } from "zod";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, "snake_case field name");
const description = z.string().max(500).optional();

export const PERIODS = ["hour", "day", "week", "month", "year"] as const;

export const fieldRuleSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), key, description, nullable: z.boolean().default(true) }),
    z.object({ kind: z.literal("enum"), key, description, values: z.array(z.string().min(1)).min(2).max(30) }),
    z.object({ kind: z.literal("integer"), key, description, nullable: z.boolean().default(true), min: z.number().int().optional(), max: z.number().int().optional() }),
    z.object({
        kind: z.literal("set_f1"), key, description,
        // "js" → "javascript". Applied to both expected and predicted items before comparing.
        synonyms: z.record(z.string(), z.string()).default({}),
        maxItems: z.number().int().positive().default(50),
    }),
    z.object({
        kind: z.literal("money"), key, description,
        tolerance: z.number().min(0).max(0.5).default(0.05),
        currencies: z.array(z.string().length(3)).default(["INR", "USD", "EUR", "GBP"]),
    }),
]);
export type FieldRule = z.infer<typeof fieldRuleSchema>;

export const fieldRulesSchema = z.array(fieldRuleSchema).min(1).max(40)
    .refine((rules) => new Set(rules.map((r) => r.key)).size === rules.length, "Field keys must be unique");

export const moneySchema = z.object({
    min: z.number().nonnegative().nullable(),
    max: z.number().nonnegative().nullable(),
    currency: z.string().length(3),
    period: z.enum(PERIODS),
}).refine((m) => m.min !== null || m.max !== null, "At least one of min/max");

const valueSchemaFor = (rule: FieldRule): z.ZodType => {
    switch (rule.kind) {
        case "text": return rule.nullable ? z.string().nullable() : z.string();
        case "enum": return z.enum(rule.values as [string, ...string[]]);
        case "integer": {
            let n = z.number().int();
            if (rule.min !== undefined) n = n.min(rule.min);
            if (rule.max !== undefined) n = n.max(rule.max);
            return rule.nullable ? n.nullable() : n;
        }
        case "set_f1": return z.array(z.string()).max(rule.maxItems);
        case "money": return moneySchema.nullable();
    }
};

/** The answer's shape: every field present (null allowed where the rule says), nothing extra. */
export const answerSchemaFor = (rules: FieldRule[]) =>
    z.object(Object.fromEntries(rules.map((r) => [r.key, valueSchemaFor(r)]))).strict();

/** JSON Schema of the answer (Phase 14 makes provider-specific variants from it). */
export const jsonSchemaFor = (rules: FieldRule[]) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(answerSchemaFor(rules)) as Record<string, unknown>;
    return schema;
};
```

`.strict()` matters: an output with an extra key (`"notes": "…"`) fails the **schema** check but is
still scored field by field (the scoring rules in `scoring-rules.md`). That distinction shows up as
"schema valid %" vs "overall".

### 6.2 Task model and API

```ts
// models/task.model.ts
const taskSchema = new mongoose.Schema({
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    slug: { type: String, required: true },                   // unique per owner; seeds upsert by it
    name: { type: String, required: true, maxlength: 120 },
    description: { type: String, maxlength: 2000 },
    instructions: { type: String, required: true, maxlength: 20_000 },   // shared by every prompt version
    fields: { type: [Schema.Types.Mixed], required: true },  // validated by fieldRulesSchema in the service
    fieldsVersion: { type: Number, default: 1 },
}, { timestamps: true });
taskSchema.index({ ownerId: 1, slug: 1 }, { unique: true });
```

Routes (`authenticate, protectedApiLimiter`):
- `GET /tasks`, `POST /tasks`, `GET /tasks/:id`;
- `PATCH /tasks/:id`: a fields change increments `fieldsVersion` and returns
  `{ needsRescore: true }` when runs exist;
- `DELETE /tasks/:id`: only if it has no runs, else 409 "archive instead". Add `archivedAt`.

Every query filters by `{ ownerId: req.userId }`. Ids are parsed with `idParamSchema` (Phase 03).

### 6.3 The case study task (`cases/job-postings/task.json`)

```json
{
  "slug": "job-postings",
  "name": "Job Posting Extractor",
  "description": "Turn a messy job posting into clean JSON.",
  "instructions": "Extract the job posting into the JSON fields described. Use null for anything the posting does not state. Never guess a salary.",
  "fields": [
    { "kind": "text", "key": "title" },
    { "kind": "text", "key": "company" },
    { "kind": "text", "key": "location" },
    { "kind": "enum", "key": "remote", "values": ["remote", "hybrid", "onsite", "unknown"] },
    { "kind": "enum", "key": "employment_type", "values": ["full_time", "part_time", "internship", "contract", "unknown"] },
    { "kind": "integer", "key": "experience_years_min", "min": 0, "max": 40 },
    { "kind": "set_f1", "key": "skills", "synonyms": {
        "js": "javascript", "ts": "typescript", "reactjs": "react", "react.js": "react",
        "node": "node.js", "nodejs": "node.js", "postgres": "postgresql", "mongo": "mongodb",
        "k8s": "kubernetes", "ml": "machine learning", "golang": "go", "css3": "css", "html5": "html" } },
    { "kind": "money", "key": "stipend_or_salary", "tolerance": 0.05 }
  ]
}
```

### 6.4 Seed script

`scripts/seed-job-postings.ts --owner you@example.com`:
1. find the user;
2. upsert the task by `{ ownerId, slug }`;
3. Phase 11 adds examples from `data/job_postings.jsonl`, Phase 12 adds prompts from `prompts/*.md`;
4. print what changed.

It's idempotent: run it twice, and nothing changes the second time. Script: `"seed": "tsx src/scripts/seed-job-postings.ts"`.

## 7. Verify

```bash
pnpm --filter api seed -- --owner you@example.com          # task created
pnpm --filter api seed -- --owner you@example.com          # "no changes"
curl -s -b $J localhost:5000/tasks                          # the task, fieldsVersion 1
```

`tsx -e` checks:
- `answerSchemaFor(task.fields).safeParse(<the spec's example JSON>)` succeeds;
- the same object with `remote: "wfh"` fails;
- with an extra key it fails (`.strict()`);
- `jsonSchemaFor` prints an object with 8 properties.

PATCH a synonym → `fieldsVersion` becomes 2.

## 8. Definition of done

- [ ] The DSL, the derived Zod schema and JSON Schema live in `@repo/types`.
- [ ] Tasks CRUD, scoped by owner, with `fieldsVersion`.
- [ ] The case-study task is seeded from git, idempotently.
- [ ] Commit: `feat: tasks and the field-rule DSL`.

## 9. Interview angle

*"How is the scoring configured?"* Per task, as a list of typed field rules. One list generates the
validation schema, the JSON Schema for structured output, and drives the scorer, so they can't
disagree. Changing a rule bumps a version and stored outputs are re-scored without calling any model.
