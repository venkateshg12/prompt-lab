# Phase 13 — Prompt versions: templates, few-shot, freezing

## 1. Goal

Store prompts as **versioned, immutable-once-used** artefacts:
- a `key` (`v2-few-shot`), a `version` (exported as `v2-few-shot@1`), a **technique**
  (`zero_shot | few_shot | cot | structured | custom`);
- a **system** text and a user **template** with placeholders `{{input}}`, `{{instructions}}`,
  `{{fields}}`, `{{examples}}`;
- **few-shot examples** as references to **dev** examples only;
- **frozen** the moment a run uses them (`frozenAt`): editing then means a new version;
- a **render preview**: exactly what the model will see for one example;
- the case-study prompts as files (`cases/job-postings/prompts/*.md`), synced by `import-cases.ts`.

## 2. What I will understand after this phase

1. Why a prompt version must be immutable for its results to mean anything.
2. How placeholders keep the *task text* identical across techniques, so a comparison measures the
   technique, not the wording.
3. Why few-shot examples are references to dev examples, and why that's checked twice.
4. Why rendering is single-pass, and what it protects against.
5. How the exported id `key@version` ties a Playbook lesson to one exact text.

## 3. Prerequisites

Phase 12 done. Permissions `prompts.read` / `prompts.manage` exist (Phase 10).

## 4. Files

```
packages/types/src/
├── prompt.ts                              NEW   (TECHNIQUES, PLACEHOLDERS, MAX_TOKENS_BY_TECHNIQUE, body schemas, versionId())
└── index.ts                               ADAPT
apps/api/
├── prisma/schema.prisma                   ADAPT (+ enum Technique, model PromptVersion; Task.prompts)
├── prisma/migrations/<ts>_prompts/        NEW
└── src/
    ├── prompts/render.ts (+ render.test.ts)  NEW   (pure: renderTemplate, fieldsList, examplesBlock, renderPrompt)
    ├── prompts/promptFile.ts              NEW   (parse/serialise the .md prompt files)
    ├── services/prompt.service.ts         NEW   (create, update draft, newVersion, duplicate, freeze, preview, list)
    ├── controllers/prompt.controller.ts   NEW
    ├── routes/prompt.route.ts             NEW   (under /orgs/:orgId/tasks/:taskId/prompts)
    ├── app.ts                             ADAPT
    └── scripts/import-cases.ts            ADAPT (+ prompts/*.md; --check reports drift)
cases/job-postings/prompts/
└── v1-zero-shot.md                        NEW   (the baseline; Phase 15 adds v2–v4, Phase 25 v0 and v5)
```

```bash
pnpm --filter api add yaml
```

Why `render.ts` lives in the API and not in a package: the worker (Phase 17), the CLI and the preview
endpoint all run in the API, and the web shows the server's preview instead of re-implementing it.
One renderer, one place.

## 5. Concepts

**Immutability.** "v2 few-shot: 81 %" is only true for the v2 text that ran. Rules:
- a version gets `frozenAt` inside the run-creation transaction (`freezePromptVersions(tx, ids)` here,
  called by Phase 17);
- `PATCH` on a frozen version → 409 "This version was used by a run. Create a new version";
- `POST …/prompts/:id/versions` copies it into `version + 1` with the same key, unfrozen;
- `POST …/prompts/:id/duplicate { key }` starts a new key at version 1 (v2 from v1, say).

**No-op versions are refused.** The content hash is computed, not stored:
`sha256(technique ‖ system ‖ template ‖ fewShotExampleIds)`. Creating a version identical to the
latest of its key → 409 "No changes". `import-cases --check` uses the same hash to report files that
differ from the database.

**Separate the task from the technique.** If every prompt types out the field list, v1 and v4 drift in
wording and you end up comparing wording. Placeholders pull shared text from the task:

| Placeholder | Renders |
| --- | --- |
| `{{input}}` | the example's input (required in the user template) |
| `{{instructions}}` | `task.instructions` |
| `{{fields}}` | a bullet list generated from the field rules: key, type, allowed values, null rule, description |
| `{{examples}}` | the few-shot block: each example's input and its `expected` as compact JSON |

There's no `{{schema}}`: the structured technique hands the schema to the provider's JSON mode instead
(Phase 15). Unknown placeholders are rejected **on save**, not at run time.

**Single-pass rendering.** Values are substituted in one pass over the **template**. A posting that
contains the text `{{instructions}}` is not expanded again. It's a small, real guard against a test
input changing the prompt.

**Task text and freezing.** `{{instructions}}` and `{{fields}}` come from the task at render time. A
task edit bumps `Task.version` (Phase 11), and runs record `taskVersion` (Phase 17). Together,
`key@version` + `taskVersion` identify exactly what a run sent.

**Few-shot by reference, checked twice.** `fewShotExampleIds` (≤ 8) must be **dev** examples of the
same task, checked when the prompt is saved. An example can later move to test (Phase 12), so
`freezePromptVersions` checks again and refuses a run whose prompt now points at a test example.
Rendering uses the example's current `input`/`expected`. Phase 17 stores the rendered system text per
variant, so later label edits can't change what a past run saw.

**Max tokens per technique.** data-model.md has no per-prompt options. Temperature is per run
(`Run.temperature`), and output length follows the technique: `MAX_TOKENS_BY_TECHNIQUE`
(`zero_shot`/`few_shot`/`structured` 800, `cot` 2000, `custom` 1200). A CoT answer cut off at 800
tokens would be measured as "invalid JSON", which is a budget bug, not a technique result.

## 6. Steps

### 6.1 Schemas (`packages/types/src/prompt.ts`)

```ts
import { z } from "zod";
import { idSchema } from "./id";

export const TECHNIQUES = ["zero_shot", "few_shot", "cot", "structured", "custom"] as const;
export type Technique = (typeof TECHNIQUES)[number];
export const PLACEHOLDERS = ["input", "instructions", "fields", "examples"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
export const MAX_TOKENS_BY_TECHNIQUE: Record<Technique, number> = {
    zero_shot: 800, few_shot: 800, structured: 800, cot: 2000, custom: 1200,
};
export const PLACEHOLDER_RE = /{{\s*([a-zA-Z_]+)\s*}}/g;

const templateText = z.string().min(1).max(20_000).superRefine((text, ctx) => {
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
        if (!(PLACEHOLDERS as readonly string[]).includes(m[1]!)) {
            ctx.addIssue({ code: "custom", message: `Unknown placeholder {{${m[1]}}}` });
        }
    }
});

export const promptKeySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/);   // "v2-few-shot"

export const promptBodySchema = z
    .object({
        key: promptKeySchema,
        technique: z.enum(TECHNIQUES),
        system: templateText,
        template: templateText.refine((t) => /{{\s*input\s*}}/.test(t), "The template must contain {{input}}"),
        fewShotExampleIds: z.array(idSchema("example id")).max(8).default([]),
        notes: z.string().max(4000).optional(),
    })
    .refine((p) => p.technique !== "few_shot" || p.fewShotExampleIds.length > 0, "few_shot needs examples")
    .refine(
        (p) => p.fewShotExampleIds.length === 0 || /{{\s*examples\s*}}/.test(p.system + p.template),
        "Examples are attached but {{examples}} is not used"
    );

/** The id every export and every Playbook lesson uses. */
export const versionId = (p: { key: string; version: number }) => `${p.key}@${p.version}`;
```

### 6.2 Prisma

Add `enum Technique` and `model PromptVersion` as data-model.md defines it (`key`, `version`,
`technique`, `system`, `template`, `fewShotExampleIds String[] @db.Uuid`, `notes`, `frozenAt`,
`@@unique([taskId, key, version])`), plus `prompts PromptVersion[]` on `Task`. The `variants`
back-relation arrives with `RunVariant` in Phase 17.

```bash
pnpm --filter api exec prisma migrate dev --name prompts < /dev/null && pnpm --filter api exec prisma generate
```

### 6.3 Renderer (`apps/api/src/prompts/render.ts`, pure, unit-tested)

```ts
import type { FieldRule, Placeholder } from "@repo/types";
import { PLACEHOLDER_RE } from "@repo/types";

// One pass over the TEMPLATE: substituted values are never scanned again.
export const renderTemplate = (template: string, values: Partial<Record<Placeholder, string>>) =>
    template.replace(PLACEHOLDER_RE, (_m, name: string) => values[name as Placeholder] ?? "");

const nullNote = (nullable: boolean) => (nullable ? " or null if not stated" : "");

export const fieldsList = (rules: FieldRule[]) =>
    rules
        .map((r) => {
            const d = r.description ? `: ${r.description}` : "";
            switch (r.kind) {
                case "text": return `- ${r.key}: string${nullNote(r.nullable)}${d}`;
                case "enum": return `- ${r.key}: one of ${r.values.map((v) => `"${v}"`).join(", ")}${d}`;
                case "integer": return `- ${r.key}: integer${nullNote(r.nullable)}${d}`;
                case "boolean": return `- ${r.key}: true or false${nullNote(r.nullable)}${d}`;
                case "set_f1": return `- ${r.key}: array of lower-case strings${d}`;
                case "money":
                    return `- ${r.key}: {"min": number|null, "max": number|null, "currency": ISO 4217 code, "period": "hour"|"day"|"week"|"month"|"year"} or null if not stated${d}`;
            }
        })
        .join("\n");

export type FewShot = { input: string; expected: unknown };

// Generic block. Phase 15 wraps it per technique (CoT shows the reasoning tag format, structured omits nothing).
export const examplesBlock = (shots: FewShot[]) =>
    shots
        .map((s, i) => `Example ${i + 1}\nInput:\n"""\n${s.input}\n"""\nOutput:\n${JSON.stringify(s.expected)}`)
        .join("\n\n");

export const renderPrompt = (
    prompt: { system: string; template: string },
    task: { instructions: string; fields: FieldRule[] },
    input: string,
    shots: FewShot[]
) => {
    const shared = { instructions: task.instructions, fields: fieldsList(task.fields), examples: examplesBlock(shots) };
    return {
        system: renderTemplate(prompt.system, shared),                      // no {{input}} in system: it'd be ignored
        messages: [{ role: "user" as const, content: renderTemplate(prompt.template, { ...shared, input }) }],
    };
};
```

`render.test.ts`: an input containing `{{instructions}}` renders literally; an unknown placeholder in
a template is caught by the schema, not here; the field list for the job-posting task matches a
snapshot.

### 6.4 Service (`services/prompt.service.ts`)

```ts
const contentHash = (p: { technique: string; system: string; template: string; fewShotExampleIds: string[] }) =>
    createHash("sha256").update(JSON.stringify([p.technique, p.system, p.template, [...p.fewShotExampleIds].sort()])).digest("hex");

const assertDevShots = async (db: DbOrTx, taskId: string, ids: string[]) => {
    if (ids.length === 0) return;
    const n = await db.example.count({ where: { id: { in: ids }, taskId, split: "dev" } });
    appAssert(n === new Set(ids).size, BAD_REQUEST, "Few-shot examples must be dev examples of this task");
};

export const createPrompt = async (orgId: string, taskId: string, body: PromptBody, actor: AuditActor) => {
    await assertDevShots(prisma, taskId, body.fewShotExampleIds);
    const latest = await prisma.promptVersion.findFirst({ where: { taskId, key: body.key }, orderBy: { version: "desc" } });
    appAssert(!latest || contentHash(latest) !== contentHash(body), CONFLICT, "No changes from the latest version");
    try {
        return await prisma.promptVersion.create({
            data: { orgId, taskId, ...body, version: (latest?.version ?? 0) + 1 },
        });
    } catch (e) {
        appAssert(!isUniqueViolation(e), CONFLICT, "Someone created this version at the same time; reload");
        throw e;
    }
};

export const updateDraft = async (id: string, patch: Partial<PromptBody>) => {
    const p = await prisma.promptVersion.findUnique({ where: { id } });
    appAssert(p, NOT_FOUND, "Prompt not found");
    appAssert(!p.frozenAt, CONFLICT, "This version was used by a run. Create a new version");
    const next = promptBodySchema.parse({ ...p, ...patch });              // re-run the cross-field refinements
    await assertDevShots(prisma, p.taskId, next.fewShotExampleIds);
    // Conditional update: a run may freeze it between our read and this write.
    const { count } = await prisma.promptVersion.updateMany({ where: { id, frozenAt: null }, data: { ...patch } });
    appAssert(count === 1, CONFLICT, "This version was just used by a run. Create a new version");
    return prisma.promptVersion.findUniqueOrThrow({ where: { id } });
};

export const newVersion = async (orgId: string, id: string, patch: Partial<PromptBody>, actor: AuditActor) => {
    const p = await prisma.promptVersion.findUnique({ where: { id } });
    appAssert(p, NOT_FOUND, "Prompt not found");
    return createPrompt(orgId, p.taskId, promptBodySchema.parse({ ...p, ...patch, key: p.key }), actor);
};

export const duplicatePrompt = async (orgId: string, id: string, key: string, actor: AuditActor) => {
    const p = await prisma.promptVersion.findUnique({ where: { id } });
    appAssert(p, NOT_FOUND, "Prompt not found");
    return createPrompt(orgId, p.taskId, promptBodySchema.parse({ ...p, key }), actor);
};

/** Called by Phase 17 inside the run-creation transaction. Idempotent: frozenAt is only set once. */
export const freezePromptVersions = async (tx: Tx, taskId: string, ids: string[]) => {
    const prompts = await tx.promptVersion.findMany({ where: { id: { in: ids }, taskId } });
    appAssert(prompts.length === ids.length, BAD_REQUEST, "Unknown prompt version");
    for (const p of prompts) await assertDevShots(tx, taskId, p.fewShotExampleIds);   // check #2
    await tx.promptVersion.updateMany({ where: { id: { in: ids }, frozenAt: null }, data: { frozenAt: new Date() } });
    return prompts;
};

export const previewPrompt = async (taskId: string, id: string, exampleId: string) => {
    const [task, p, example] = await Promise.all([getTask(taskId), getPrompt(id), getExample(exampleId)]);
    const shots = await prisma.example.findMany({ where: { id: { in: p.fewShotExampleIds } } });
    const ordered = p.fewShotExampleIds.map((sid) => shots.find((s) => s.id === sid)!);
    return {
        ...renderPrompt(p, task, example.input, ordered.map((s) => ({ input: s.input, expected: s.expected }))),
        maxTokens: MAX_TOKENS_BY_TECHNIQUE[p.technique],
        // Phase 15: technique wrappers (CoT tag instruction, structured schema) shown here too.
    };
};
```

`listPrompts(taskId)` returns the latest version per key plus a `history` array (`version`,
`frozenAt`, `createdAt`), ordered by key.

### 6.5 Routes

```ts
export const promptRouter = Router({ mergeParams: true });              // /orgs/:orgId/tasks/:taskId/prompts
promptRouter.use(authenticate, protectedApiLimiter, resolveOrg);
promptRouter.get("/", requireOrgRole("prompts.read"), listPromptsHandler);
promptRouter.post("/", requireOrgRole("prompts.manage"), createPromptHandler);
promptRouter.get("/:promptId", requireOrgRole("prompts.read"), getPromptHandler);
promptRouter.patch("/:promptId", requireOrgRole("prompts.manage"), updateDraftHandler);
promptRouter.post("/:promptId/versions", requireOrgRole("prompts.manage"), newVersionHandler);
promptRouter.post("/:promptId/duplicate", requireOrgRole("prompts.manage"), duplicateHandler);
promptRouter.get("/:promptId/preview", requireOrgRole("prompts.read"), previewHandler);   // ?exampleId=
```

### 6.6 Prompt files (`cases/job-postings/prompts/v1-zero-shot.md`)

```markdown
---
key: v1-zero-shot
technique: zero_shot
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

`prompts/promptFile.ts` splits the front matter (parsed with `yaml`) from the `## system` and
`## user` sections. Few-shot files list external refs (`fewShot: [jp_004, jp_017, jp_023]`), which
the importer resolves to dev example ids (a test ref → abort with the file name). The file's `## user`
becomes `template`.

`import-cases.ts` then, per file:
- no version for the key → create `@1`;
- latest hash equal → "unchanged";
- different → create the next version (never edits, even an unfrozen one, so git and the database
  tell the same history);
- `--check` prints the decision without writing and exits 1 on drift (useful in CI, Phase 29).

## 7. Verify

1. `import-cases --case job-postings` → `created v1-zero-shot@1`; again → `unchanged`.
2. `GET …/prompts/<id>/preview?exampleId=<jp_001>` → the system text contains the bullet field list
   and the instructions; the user message contains the posting; `maxTokens: 800`.
3. Create an example whose input contains `{{instructions}}` → preview shows the literal text.
4. PATCH the draft → 200. Freeze it from `tsx -e` (`withTransaction(tx => freezePromptVersions(tx, task, [id]))`)
   → PATCH → 409; `POST …/versions` with a changed line → `@2`; with no change → 409 "No changes".
5. A prompt with `{{salary}}` → 400 "Unknown placeholder"; a template without `{{input}}` → 400;
   `few_shot` with no examples → 400; a test example id in `fewShotExampleIds` → 400.
6. Move a few-shot example to test (Phase 12 PATCH), then freeze → 400 "Few-shot examples must be dev
   examples".
7. Edit `v1-zero-shot.md`, run `import-cases --check` → exit 1, "would create v1-zero-shot@2".
8. Another workspace → 404; viewer POST → 403.

## 8. Definition of done

- [ ] `PromptVersion` migration applied; versions immutable once frozen; no-op versions refused.
- [ ] Placeholders validated on save; single-pass rendering; shared text comes from the task.
- [ ] Few-shot from dev only, checked on save and on freeze.
- [ ] Preview endpoint; `MAX_TOKENS_BY_TECHNIQUE`.
- [ ] Prompt files sync idempotently; `--check` reports drift.
- [ ] Commit: `feat: immutable prompt versions with templates`.

## 9. Interview angle

*"How do you version prompts?"* Like code releases: a version freezes the moment a run uses it, and an
edit is a new version, so `v2-few-shot@1` in a results table always points at the exact text that
produced it. Shared task text comes in through placeholders, so techniques differ only in technique.
Few-shot examples are references to dev examples, checked again when a run freezes the prompt.
