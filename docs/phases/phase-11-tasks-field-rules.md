# Phase 11 — Tasks and the field-rule DSL

## 1. Goal

Model a **task** generically: a name, the shared instructions, and the expected answer as a list of
**field rules**. Each rule says what a field is *and how it will be scored*:

| `kind` | Value | Scored by (Phase 16) |
| --- | --- | --- |
| `text` | string or null | normalised exact match |
| `enum` | one of `values` | exact |
| `integer` | integer or null | exact |
| `boolean` | true / false or null | exact |
| `set_f1` | string[] | F1 over normalised sets, with a synonym table |
| `money` | `{ min, max, currency, period }` or null | per-year normalisation, ±tolerance |

From the rules, code **derives** the answer's Zod schema (validates labels and outputs) and a JSON
Schema (the structured-output technique, Phase 15). The job-posting task is a file in git
(`cases/job-postings/task.json`), loaded into PostgreSQL by `import-cases.ts`.

## 2. What I will understand after this phase

1. Why the scoring rules live **with the task** and not in per-task code.
2. How one rule list produces a Zod schema, a JSON Schema and (Phase 16) a scorer: one source of truth.
3. Why a task change bumps `Task.version`, and how a run that used version 2 stays explainable after
   version 3 exists.
4. Why the case study lives in files and is imported, not typed into a form.

## 3. Prerequisites

- Phase 10 done: workspaces (orgs), `resolveOrg`, `requireOrgRole`, `recordAudit`, and the
  permissions `tasks.read` / `tasks.manage` in `constants/permissions.ts`.
- `docs/reference/scoring-rules.md` read. The rules below implement its §2 exactly.

## 4. Files

```
packages/types/src/
├── fieldRules.ts                         NEW   (the DSL: fieldRulesSchema, valueSchemaFor, answerSchemaFor, jsonSchemaFor, fieldsList, PERIOD_TO_YEAR)
├── task.ts                               NEW   (create / update request schemas)
└── index.ts                              ADAPT (+ export both)
apps/api/
├── prisma/schema.prisma                  ADAPT (+ model Task, Org.tasks back-relation)
├── prisma/migrations/<ts>_tasks/         NEW   (generated)
└── src/
    ├── services/task.service.ts          NEW
    ├── controllers/task.controller.ts    NEW
    ├── routes/task.route.ts              NEW   (mergeParams, under /orgs/:orgId/tasks)
    ├── app.ts                            ADAPT (mount the router)
    └── scripts/import-cases.ts           NEW   (task now; Phase 12 adds examples, Phase 13 prompts)
cases/job-postings/
└── task.json                             NEW   (the case study's field rules)
```

No COPY files in this phase. The route/controller/service shape follows
`@pt-api/src/{routes/member.route.ts,controllers/member.controller.ts}` (`catchError` → Zod parse →
one service call → `ok()`), and auditing uses `recordAudit` from `@pt-api/src/services/audit.service.ts`
(copied in Phase 10).

## 5. Concepts

**Rules with the task.** The scorer (Phase 16) is generic: it walks a task's rules. A second case study
(`cases/reasoning-mini`, Phase 25) needs only a new `task.json`. The runner, scorer, results UI and
exports all work unchanged. That generality is the product; the job-posting extractor is one example.

**One list, three artefacts.**

```
fields ──► answerSchemaFor(fields) : Zod          → validate labels on import (Phase 12) + the schema check (Phase 16)
       ├─► jsonSchemaFor(fields)   : JSON Schema  → structured-output mode (Phase 15), shown in the UI
       └─► scoreFields(fields, …)  : field scores → Phase 16
```

Writing the schema by hand next to the rules is how they drift ("the scorer expects `remote`, the
schema says `work_mode`").

**`.strict()` on purpose.** An output with an extra key (`"notes": "…"`) fails the **schema** check
but is still scored field by field. That's why "schema valid %" and "overall" are separate columns.

**Money: labels mean what the posting means.** "3–5 LPA" is labelled
`{ min: 300000, max: 500000, currency: "INR", period: "year" }` (L = lakh = 100,000; PA = per annum).
The scorer converts both sides to per-year with `PERIOD_TO_YEAR` (hour 2080, day 260, week 52,
month 12, year 1), so `{ min: 25000, max: 41667, period: "month" }` is also correct within 5 %. The
multipliers live in the DSL module, not the scorer, so the field list shown to the model, the label
validator and the scorer share them.

**`boolean`.** Not used by job postings. It's here because `reasoning-mini` (Phase 25) has
yes/no answers. Exact match, `null` only equals `null`.

**`Task.version`.** Instructions and fields *define* a result: fields say what "correct" means,
instructions are rendered into every prompt through `{{instructions}}` (Phase 13). So any change to
either bumps `version`, writes an audit row whose `diff` holds the **old and new values**, and returns
`{ version, runsAffected }`. Runs record `taskVersion` (Phase 17), so the results page can say "scored
with task v2; current is v3". Old text stays recoverable from the audit trail. Re-scoring with new
rules needs no model calls, because raw outputs are stored (Phase 18).

**Files → database.** The case study must be reproducible from a fresh clone: rules, prompts and
labelled data are files. `import-cases.ts` upserts by `(orgId, slug)` and prints what changed.
Running it twice changes nothing the second time.

## 6. Steps

### 6.1 The DSL (`packages/types/src/fieldRules.ts`)

```ts
import { z } from "zod";

const key = z.string().regex(/^[a-z][a-z0-9_]{0,40}$/, "snake_case field name");
const description = z.string().max(500).optional();

export const PERIODS = ["hour", "day", "week", "month", "year"] as const;
export type Period = (typeof PERIODS)[number];
// scoring-rules.md §2: everything is compared as a per-year amount in the same currency.
export const PERIOD_TO_YEAR: Record<Period, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };

export const fieldRuleSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), key, description, nullable: z.boolean().default(true) }),
    z.object({ kind: z.literal("enum"), key, description, values: z.array(z.string().min(1)).min(2).max(30) }),
    z.object({
        kind: z.literal("integer"), key, description,
        nullable: z.boolean().default(true),
        min: z.number().int().optional(),
        max: z.number().int().optional(),
    }),
    z.object({ kind: z.literal("boolean"), key, description, nullable: z.boolean().default(true) }),
    z.object({
        kind: z.literal("set_f1"), key, description,
        synonyms: z.record(z.string(), z.string()).default({}),   // "js" → "javascript", applied to both sides
        maxItems: z.number().int().positive().default(50),
    }),
    z.object({
        kind: z.literal("money"), key, description,
        tolerance: z.number().min(0).max(0.5).default(0.05),
        currencies: z.array(z.string().length(3)).default(["INR", "USD", "EUR", "GBP"]),
    }),
]);
export type FieldRule = z.infer<typeof fieldRuleSchema>;

export const fieldRulesSchema = z
    .array(fieldRuleSchema)
    .min(1)
    .max(40)
    .refine((rules) => new Set(rules.map((r) => r.key)).size === rules.length, "Field keys must be unique");

export const moneySchema = z
    .object({
        min: z.number().nonnegative().nullable(),
        max: z.number().nonnegative().nullable(),
        currency: z.string().length(3),
        period: z.enum(PERIODS),
    })
    .strict()
    .refine((m) => m.min !== null || m.max !== null, "At least one of min/max");

export const valueSchemaFor = (rule: FieldRule): z.ZodType => {
    switch (rule.kind) {
        case "text":
            return rule.nullable ? z.string().nullable() : z.string();
        case "enum":
            return z.enum(rule.values as [string, ...string[]]);
        case "integer": {
            let n = z.number().int();
            if (rule.min !== undefined) n = n.min(rule.min);
            if (rule.max !== undefined) n = n.max(rule.max);
            return rule.nullable ? n.nullable() : n;
        }
        case "boolean":
            return rule.nullable ? z.boolean().nullable() : z.boolean();
        case "set_f1":
            return z.array(z.string()).max(rule.maxItems);
        case "money":
            return moneySchema.nullable();
    }
};

/** The answer's shape: every field present (null where allowed), nothing extra. */
export const answerSchemaFor = (rules: FieldRule[]) =>
    z.object(Object.fromEntries(rules.map((r) => [r.key, valueSchemaFor(r)]))).strict();

/** The {{fields}} placeholder (Phase 13/15): one line per field, with its kind, allowed values and null rule. */
export const fieldsList = (rules: FieldRule[]): string =>
    rules.map((r) => `- ${r.key} (${r.kind}${r.kind === "enum" ? `: ${r.values.join(" | ")}` : ""})` +
        ("nullable" in r && r.nullable ? ", null if not stated" : "") + (r.description ? `: ${r.description}` : "")).join("\n");

/** JSON Schema of the answer. Phase 15 derives provider-specific variants (strict, Gemini subset). */
export const jsonSchemaFor = (rules: FieldRule[]): Record<string, unknown> => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(answerSchemaFor(rules)) as Record<string, unknown>;
    return schema;
};
```

> `z.toJSONSchema` is Zod 4's built-in converter. A `.refine()` can't be expressed in JSON Schema and
> is dropped from the output. That's fine: the refinement still runs when Zod validates.

### 6.2 Request schemas (`packages/types/src/task.ts`)

```ts
import { z } from "zod";
import { fieldRulesSchema } from "./fieldRules";

export const taskSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/);

export const createTaskSchema = z.object({
    slug: taskSlugSchema,
    name: z.string().trim().min(1).max(120),
    description: z.string().max(2000).default(""),
    instructions: z.string().trim().min(1).max(20_000),
    fields: fieldRulesSchema,
});
export const updateTaskSchema = createTaskSchema.omit({ slug: true }).partial()
    .refine((b) => Object.keys(b).length > 0, "Nothing to update");
export type CreateTaskBody = z.infer<typeof createTaskSchema>;
```

### 6.3 Prisma model

Add `Task` to `schema.prisma` exactly as `docs/reference/data-model.md` defines it (`slug`, `name`,
`description`, `instructions`, `fields Json`, `version`, `@@unique([orgId, slug])`), and add only
`tasks Task[]` to `Org`. The `examples`, `prompts` and `runs` relations on `Task` arrive with their
models in Phases 12, 13 and 17. Leave them out now, or the schema won't validate.

```bash
pnpm --filter api exec prisma migrate dev --name tasks < /dev/null && pnpm --filter api exec prisma generate
```

`Task` is already in `TENANT_MODELS` (Phase 03 listed every tenant model up front), so every query
below is scoped to `req.orgId` by the extension. The service never adds `orgId` to a `where` itself;
it passes it only on `create` (the extension checks it matches).

### 6.4 Service (`services/task.service.ts`)

```ts
import { prisma, Prisma } from "../db/prisma";
import { withTransaction } from "../utils/db";
import { recordAudit, type AuditActor } from "./audit.service";
import appAssert from "../utils/errors/appAssert";
import { CONFLICT, NOT_FOUND } from "../constants/https";
import { isUniqueViolation } from "../db/errors";
import { fieldRulesSchema, type CreateTaskBody } from "@repo/types";

export const listTasks = () =>
    prisma.task.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, slug: true, name: true, version: true, updatedAt: true } });

export const getTask = async (id: string) => {
    const task = await prisma.task.findUnique({ where: { id } });
    appAssert(task, NOT_FOUND, "Task not found");
    return { ...task, fields: fieldRulesSchema.parse(task.fields) };   // jsonb is re-validated on read
};

export const createTask = async (orgId: string, body: CreateTaskBody, actor: AuditActor) => {
    try {
        return await withTransaction(async (tx) => {
            const task = await tx.task.create({ data: { orgId, ...body, fields: body.fields as Prisma.InputJsonValue } });
            await recordAudit({ orgId, actor, action: "task.create", target: { type: "task", id: task.id } }, tx);
            return task;
        });
    } catch (error) {
        appAssert(!isUniqueViolation(error), CONFLICT, `A task with slug "${body.slug}" already exists`);
        throw error;
    }
};

const DEFINING = ["instructions", "fields"] as const;

export const updateTask = (orgId: string, id: string, body: Partial<CreateTaskBody>, actor: AuditActor) =>
    withTransaction(async (tx) => {
        const before = await tx.task.findUnique({ where: { id } });
        appAssert(before, NOT_FOUND, "Task not found");
        const defining = DEFINING.filter(
            (k) => body[k] !== undefined && JSON.stringify(body[k]) !== JSON.stringify(before[k])
        );
        const task = await tx.task.update({
            where: { id },
            data: {
                ...body,
                fields: body.fields as Prisma.InputJsonValue | undefined,
                ...(defining.length ? { version: { increment: 1 } } : {}),
            },
        });
        await recordAudit({
            orgId, actor, action: defining.length ? "task.version" : "task.update",
            target: { type: "task", id },
            // Old values kept so a run made with an earlier version stays explainable.
            diff: Object.fromEntries(defining.map((k) => [k, { from: before[k], to: task[k] }])),
        }, tx);
        // Phase 17: runsAffected = count of runs with taskVersion < task.version
        return { task, versionBumped: defining.length > 0 };
    });

export const deleteTask = async (id: string) => {
    // Phase 17: refuse with 409 when the task has runs ("archive instead"); cascades examples + prompts.
    await prisma.task.delete({ where: { id } });
};
```

### 6.5 Controller and routes

```ts
// routes/task.route.ts
export const taskRouter = Router({ mergeParams: true });
taskRouter.use(authenticate, protectedApiLimiter, resolveOrg);
taskRouter.get("/", requireOrgRole("tasks.read"), listTasksHandler);
taskRouter.post("/", requireOrgRole("tasks.manage"), createTaskHandler);
taskRouter.get("/:taskId", requireOrgRole("tasks.read"), getTaskHandler);          // + jsonSchema in the response
taskRouter.patch("/:taskId", requireOrgRole("tasks.manage"), updateTaskHandler);
taskRouter.delete("/:taskId", requireOrgRole("tasks.manage"), deleteTaskHandler);

// app.ts
app.use("/orgs/:orgId/tasks", taskRouter);
```

```ts
// controllers/task.controller.ts (one shown; the rest follow the same four lines)
export const getTaskHandler = catchError(async (req, res) => {
    const task = await getTask(idSchema("task id").parse(req.params.taskId));
    res.status(OK).json(ok({ task, jsonSchema: jsonSchemaFor(task.fields) }));
});
```

### 6.6 The case-study task (`cases/job-postings/task.json`)

```json
{
  "slug": "job-postings",
  "name": "Job Posting Extractor",
  "description": "Turn a messy job posting into clean JSON.",
  "instructions": "Extract the job posting into the JSON fields described. Use null for anything the posting does not state. Never guess a salary: words like \"competitive\" mean null.",
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

### 6.7 `scripts/import-cases.ts`

```ts
// pnpm --filter api import-cases -- --case job-postings [--org <orgId>] [--dry-run] [--check]
// Without --org: use (or create) the workspace "Case studies" owned by the first platform admin,
// so a fresh clone and CI can load a case with one command.
const main = async () => {
    const { org, caseSlug, dryRun } = parseArgs(process.argv.slice(2));
    const dir = path.resolve(__dirname, "../../../../cases", caseSlug);
    const body = createTaskSchema.parse(JSON.parse(await readFile(path.join(dir, "task.json"), "utf8")));
    const actor = { type: "system" as const };
    // The tenant extension needs an org in context: run as that org, exactly like a request would.
    await runWithRequestContext({ orgId: org, requestId: `import-${Date.now()}` }, async () => {
        const existing = await prisma.task.findFirst({ where: { slug: body.slug } });
        if (!existing) {
            console.log(dryRun ? "would create task" : "created task", body.slug);
            if (!dryRun) await createTask(org, body, actor);
        } else {
            const { slug: _s, ...update } = body;
            const keys = ["name", "description", "instructions", "fields"] as const;
            const same = keys.every((k) => JSON.stringify(existing[k]) === JSON.stringify(update[k]));
            console.log(same ? "task unchanged" : dryRun ? "would update task" : "updated task", body.slug);
            if (!same && !dryRun) await updateTask(org, existing.id, update, actor);
        }
        // Phase 12: examples from data/*.jsonl. Phase 13: prompts from prompts/*.md.
    });
};
main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    // CLI scripts inherit service connections (Playbook lessons.md): close them or the process hangs.
    .finally(() => Promise.allSettled([prisma.$disconnect(), redisConnection.quit(), cache.close()]));
```

`package.json`: `"import-cases": "tsx src/scripts/import-cases.ts"`.

## 7. Verify

```bash
pnpm --filter api import-cases -- --org $ORG --case job-postings      # created task job-postings
pnpm --filter api import-cases -- --org $ORG --case job-postings      # task unchanged
curl -s -b $J localhost:5000/orgs/$ORG/tasks | jq '.data'              # 1 task, version 1
curl -s -b $J localhost:5000/orgs/$ORG/tasks/$TASK | jq '.data.jsonSchema.properties | keys | length'   # 8
```

`tsx -e` checks against `answerSchemaFor(task.fields)`:
- the spec's example JSON → success;
- the same with `remote: "wfh"` → fails on `remote`;
- with an extra key `notes` → fails (`.strict()`);
- `stipend_or_salary: { min: null, max: null, currency: "INR", period: "year" }` → fails ("At least one
  of min/max"); `stipend_or_salary: null` → success.

Then:
- PATCH a new synonym → `version: 2`, and `audit_logs` has a `task.version` row whose `diff.fields.from`
  is the old list (`SELECT diff FROM audit_logs ORDER BY at DESC LIMIT 1`).
- PATCH only `name` → version unchanged, `task.update` audit row.
- A second `POST` with the same slug → 409.
- The same task id under another workspace's `/orgs/:orgId` → 404 (the tenant extension).
- A `viewer` POST → 403.

## 8. Definition of done

- [ ] The DSL, `answerSchemaFor`, `jsonSchemaFor` and `PERIOD_TO_YEAR` live in `@repo/types`.
- [ ] `Task` migration applied; CRUD scoped by the tenant extension; roles enforced.
- [ ] Changing instructions or fields bumps `version` and audits old + new values.
- [ ] `cases/job-postings/task.json` imports idempotently; the script exits cleanly.
- [ ] Commit: `feat: tasks and the field-rule DSL`.

## 9. Interview angle

*"How is the scoring configured?"* Per task, as a list of typed field rules. One list generates the
validation schema, the JSON Schema for structured output, and drives the scorer, so they can't
disagree. A rule change bumps the task version, keeps the old definition in the audit trail, and stored
raw outputs can be re-scored without a single model call.
