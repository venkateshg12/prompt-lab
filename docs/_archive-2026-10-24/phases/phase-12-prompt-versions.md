# Phase 12 — Prompt versions

## 1. Goal

Store prompts as **immutable, versioned** artefacts:
- a name and a **technique** (`zero_shot`, `few_shot`, `cot`, `structured`);
- a **system template** and a **user template** with `{{placeholders}}` (`{{input}}`,
  `{{instructions}}`, `{{fields}}`, `{{schema}}`, `{{examples}}`);
- optional **few-shot examples**, references to **dev** examples only;
- model options (`temperature`, `maxTokens`).

Once a run uses a version, it's **frozen**. Editing creates the next version, so every past result
points at the exact text that produced it. Prompts are also files (`cases/job-postings/prompts/*.md`
with front matter), seeded like the task.

## 2. What I will understand after this phase

1. Why prompt versions must be immutable for results to mean anything.
2. How a tiny template language keeps the *task* separate from the *technique*.
3. Why few-shot examples are references to dev examples, not pasted text.
4. How a content hash detects "nothing actually changed".

## 3. Prerequisites

Phase 11 done.

## 4. Files

```
packages/types/src/prompt.ts                  NEW   (schemas, PLACEHOLDERS, techniques)
packages/scoring/src/render.ts                NEW   (pure: renderTemplate, fieldsList)
apps/api/src/
├── models/prompt.model.ts                    NEW
├── services/prompt.service.ts                NEW   (create, newVersion, freeze, list)
├── controllers/prompt.controller.ts · routes/prompt.route.ts   NEW
├── utils/frontMatter.ts                      NEW   (parse the .md prompt files)
└── scripts/seed-job-postings.ts              ADAPT (+ prompts from cases/job-postings/prompts/*.md)
```

> `render.ts` lives in `packages/scoring` because the CLI, the worker and the web (prompt preview)
> all render prompts. "Scoring" is really "the pure core" here; rename the package to `@repo/core` if
> you prefer, and do it now or never.

## 5. Concepts

**Immutability.** A results table that says "v2 few-shot: 81 %" is only true for the v2 text that ran.
If v2 can be edited afterwards, the number points at text that no longer exists. Rules:
- a version gets `frozenAt` the moment a run is created with it (inside the run-creation
  transaction, Phase 16);
- `PATCH` on a frozen version → 409 "This version was used by a run — create a new version";
- `POST /prompts/:id/versions` copies it into `version + 1` (same `name` family, `parentId` set) and
  opens it for editing.

**Separate the task from the technique.** Writing the field list into every prompt by hand means v1
and v4 can drift in *wording*, and then you're comparing wording, not techniques. The spec warns about
this ("keep the system instructions the same"). Placeholders pull shared text from the task:

| Placeholder | Renders |
| --- | --- |
| `{{input}}` | the example's input (the job posting) |
| `{{instructions}}` | `task.instructions` |
| `{{fields}}` | a bullet list generated from the field rules: key, kind, allowed values, null rule, description |
| `{{schema}}` | the JSON Schema (`jsonSchemaFor`), pretty-printed |
| `{{examples}}` | the few-shot block (rendered per technique in Phase 14) |

Unknown placeholders are rejected when the prompt is saved, not at run time.

**Single-pass rendering.** Values are substituted in **one pass**. If a posting contains the text
`{{instructions}}`, it is *not* expanded again. The renderer replaces placeholder tokens in the
template only, never inside substituted values. That's a small, real injection guard.

**Few-shot by reference.** `fewShotExampleIds: string[]` (≤ 8), each validated to be a **dev** example
of the same task. The rendered prompt uses that example's current `input` and `expected`. The run
snapshots the rendered few-shot block (Phase 16), so a later label edit can't change what a past run
saw.

**Content hash.** `sha256(system + user + JSON(fewShotIds) + JSON(options) + technique)`. Creating a
new version identical to its parent → 409 "no changes". The CLI uses the hash to say whether a file on
disk differs from the database copy.

## 6. Steps

### 6.1 Schemas (`@repo/types/src/prompt.ts`)

```ts
export const TECHNIQUES = ["zero_shot", "few_shot", "cot", "structured"] as const;
export const PLACEHOLDERS = ["input", "instructions", "fields", "schema", "examples"] as const;

const templateText = z.string().min(1).max(20_000).superRefine((text, ctx) => {
    for (const match of text.matchAll(/{{\s*([a-zA-Z_]+)\s*}}/g)) {
        if (!(PLACEHOLDERS as readonly string[]).includes(match[1]!)) {
            ctx.addIssue({ code: "custom", message: `Unknown placeholder {{${match[1]}}}` });
        }
    }
});

export const promptBodySchema = z.object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/),          // "v2-few-shot"
    technique: z.enum(TECHNIQUES),
    system: templateText,
    user: templateText.refine((t) => /{{\s*input\s*}}/.test(t), "The user template must contain {{input}}"),
    fewShotExampleIds: z.array(objectIdSchema("example id")).max(8).default([]),
    options: z.object({
        temperature: z.number().min(0).max(2).default(0),
        maxTokens: z.number().int().min(64).max(8192).default(1024),
    }).default({ temperature: 0, maxTokens: 1024 }),
    notes: z.string().max(4000).optional(),                         // "why this version exists"
}).refine((p) => p.technique !== "few_shot" || p.fewShotExampleIds.length > 0, "few_shot needs examples")
  .refine((p) => p.technique === "few_shot" || p.fewShotExampleIds.length === 0 || /{{\s*examples\s*}}/.test(p.system + p.user),
          "Examples are attached but {{examples}} is not used");
```

### 6.2 Renderer (`packages/scoring/src/render.ts`, pure)

```ts
export const renderTemplate = (template: string, values: Partial<Record<Placeholder, string>>) =>
    // One pass over the TEMPLATE: substituted values are never scanned again.
    template.replace(/{{\s*([a-zA-Z_]+)\s*}}/g, (_m, name: Placeholder) => values[name] ?? "");

export const fieldsList = (rules: FieldRule[]) =>
    rules.map((r) => {
        switch (r.kind) {
            case "text": return `- ${r.key}: string${r.nullable ? " or null if not stated" : ""}${r.description ? ` — ${r.description}` : ""}`;
            case "enum": return `- ${r.key}: one of ${r.values.map((v) => `"${v}"`).join(", ")}`;
            case "integer": return `- ${r.key}: integer${r.nullable ? " or null if not stated" : ""}`;
            case "set_f1": return `- ${r.key}: array of lower-case strings`;
            case "money": return `- ${r.key}: { "min": number|null, "max": number|null, "currency": ISO code, "period": "hour"|"day"|"week"|"month"|"year" } or null if not stated`;
        }
    }).join("\n");
```

Phase 14 adds `renderPrompt(prompt, task, example, fewShots) → { system, messages }` on top of these.

### 6.3 Model and service

```ts
const promptSchema = new mongoose.Schema({
    ownerId: { type: Schema.Types.ObjectId, required: true },
    taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
    name: { type: String, required: true },
    version: { type: Number, required: true },
    parentId: Schema.Types.ObjectId,
    technique: { type: String, enum: TECHNIQUES, required: true },
    system: String, user: String,
    fewShotExampleIds: [Schema.Types.ObjectId],
    options: { temperature: Number, maxTokens: Number },
    notes: String,
    contentHash: { type: String, required: true },
    frozenAt: Date,
}, { timestamps: true });
promptSchema.index({ taskId: 1, name: 1, version: 1 }, { unique: true });
promptSchema.index({ ownerId: 1, taskId: 1, createdAt: -1 });
```

Service rules:
- `create` → version 1;
- `update` refused when `frozenAt` is set;
- `newVersion` copies and increments, refused when the content hash equals the parent's;
- `freeze(ids, session)` → `updateMany({ _id: { $in: ids }, ownerId }, { $set: { frozenAt: now } }, { session })`,
  idempotent (`frozenAt` is only set when missing: use `$min` or a filter);
- few-shot ids are validated with
  `ExampleModel.countDocuments({ _id: { $in }, taskId, split: "dev" }) === ids.length`, else 400
  "Few-shot examples must come from the dev split".

Routes: `GET /tasks/:id/prompts` (latest version per name, plus history), `POST /tasks/:id/prompts`,
`GET /prompts/:id`, `PATCH /prompts/:id`, `POST /prompts/:id/versions`, and
`GET /prompts/:id/preview?exampleId=` (the rendered messages for one example: the "what will the model
actually see" button).

### 6.4 Prompt files (`cases/job-postings/prompts/v1-zero-shot.md`)

```markdown
---
name: v1-zero-shot
technique: zero_shot
temperature: 0
maxTokens: 800
notes: Baseline. Instructions + field list + "JSON only".
---
## system
{{instructions}}

Fields:
{{fields}}

Return only a JSON object with exactly these keys. No prose, no code fences.

## user
Job posting:
"""
{{input}}
"""
```

`utils/frontMatter.ts` splits the `---` block (parse it with the `yaml` package), then the `## system`
and `## user` sections. Few-shot files list `fewShot: [jp_004, jp_017, jp_023]` (external ids), which
the seed resolves to dev example ids. The seed creates version 1, or a new version when the file's
content hash differs from the latest in the database.

## 7. Verify

1. Create v1 via the API → version 1; PATCH works.
2. Start a run with it (Phase 16), or call `freeze` from tsx → PATCH → 409; `POST …/versions` →
   version 2 with `parentId`.
3. `POST …/versions` with no changes → 409.
4. A prompt with `{{salary}}` → 400 "Unknown placeholder"; a user template without `{{input}}` → 400.
5. Few-shot with a test example id → 400.
6. Preview with a posting containing `{{instructions}}` → the literal text appears, not expanded.
7. The seed creates v1 from the file; editing the file and re-seeding creates v2.

## 8. Definition of done

- [ ] Versions are immutable once frozen; new versions are explicit; no-op versions refused.
- [ ] Placeholders validated on save; single-pass rendering; shared text comes from the task.
- [ ] Few-shot from dev only; the preview endpoint works.
- [ ] Commit: `feat: immutable prompt versions with templates`.

## 9. Interview angle

*"How do you version prompts?"* Like code: each version is immutable once a run used it and has a
content hash. Shared task text comes in through placeholders, so different techniques differ only in
technique, not wording. Few-shot examples are references to dev examples, never test.
