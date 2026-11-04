# Phase 14 — Techniques: few-shot, chain-of-thought, structured output

## 1. Goal

Turn *(prompt version, task, example, model)* into the exact request sent to the model, for each of
the four techniques the spec compares. Keep the differences between techniques **only** in the
technique:

| Technique | What changes in the request | How the answer is found (Phase 15) |
| --- | --- | --- |
| `zero_shot` | system + user | the whole reply (code fences stripped) |
| `few_shot` | + 3 worked dev examples (inline block, or as prior user/assistant turns) | the whole reply |
| `cot` | the user turn asks for reasoning first, then the final JSON in `<json>…</json>` | the **last** `<json>` block |
| `structured` | + the provider's JSON-schema mode with the task's schema | the whole reply |

Plus a **probe** that checks, per model, whether structured mode is really honoured, so a model that
ignores it gets "n/a" instead of a misleading number.

## 2. What I will understand after this phase

1. Why few-shot can be inline or multi-turn, and why the choice is recorded.
2. Why CoT needs a machine-readable delimiter, and why the *last* block wins.
3. What structured-output mode guarantees (format) and what it doesn't (correctness).
4. Why provider schemas need small conversions (OpenAI strict, Gemini subset, NIM guided JSON).
5. Why the rendered request is snapshotted per run.

## 3. Prerequisites

Phase 13 done.

## 4. Files

```
packages/scoring/src/
├── renderPrompt.ts           NEW   (pure: prompt + task + example + fewShots → { system, messages, structured? })
└── providerSchema.ts         NEW   (pure: toOpenAiStrict, toGeminiSchema, toNimGuided)
apps/api/src/
├── scripts/probe-structured.ts   NEW   (does model X obey a schema? → updates models.structured)
└── services/prompt.service.ts    ADAPT (preview uses renderPrompt)
cases/job-postings/prompts/{v1-zero-shot,v2-few-shot,v3-cot,v4-structured}.md   NEW (drafts; Phase 24 finalises them)
```

## 5. Concepts

**Few-shot, two ways.**
- **Inline**: the system prompt contains `{{examples}}`, rendered as numbered "Posting / JSON" pairs.
  It's simple, and the model sees examples as part of the instructions.
- **Multi-turn**: no `{{examples}}` placeholder, so each example becomes a `user` turn (the posting)
  followed by an `assistant` turn (the expected JSON), then the real input. Many chat models imitate
  prior assistant turns more faithfully.

Which one a version uses is visible in its template, so it's part of the version. The spec asks for
3 examples, including a tricky salary case. Phase 24 picks them from dev, tagged `salary_lpa`.

The expected JSON in examples is **canonical**: `JSON.stringify(expected, null, 2)` with keys in field
order. Few-shot then also teaches the exact shape.

**Chain-of-thought with a delimiter.** "Think step by step" makes the reply prose plus JSON. The
technique tells the model to put the final answer in `<json>` … `</json>`, and the extractor takes the
**last** such block. A model that "drafts" a JSON block and then corrects it should be judged on its
final answer. No block at all → `validJson: false`. That's the cost of CoT, and it's measured. CoT
also needs more output tokens (`maxTokens: 1500`), which shows up in cost, and the spec's interview
question asks about exactly that trade-off.

**Structured output = format, not truth.** JSON-schema modes constrain decoding so the reply parses
and matches the schema. They don't make `salary.min` right. Expect v4 to win on valid JSON % and not
necessarily on accuracy. That's a good README finding either way.

**Provider schema variants** (from `jsonSchemaFor(task.fields)`, all pure, all unit-tested):
- **OpenAI strict**: every property in `required`, `additionalProperties: false` on every object,
  nullable as `type: [T, "null"]` (or `anyOf` with `null`). Our answer schema already lists every key
  and is `.strict()`; the converter normalises nullable forms and removes unsupported keywords
  (e.g. `format`, `default`).
- **Gemini**: a JSON Schema **subset**. The converter keeps `type`, `properties`, `required`, `items`,
  `enum`, `description`, `nullable`-equivalents, and drops anything outside the documented subset.
  Check the current list in Gemini's structured-output docs and write it into `providerSchema.ts` as
  a constant with the date.
- **NIM `guided_json`**: a standard JSON Schema; the converter only strips `$schema`.

**Probe, don't assume.** `probe-structured.ts <modelKey>` sends a small task 3 times with a schema
(`{ "colour": enum["red","blue"] }`) and a prompt designed to tempt prose ("Explain, then answer").
3/3 bare, schema-valid JSON → `structured: "native"` (or `"guided_json"` for NIM). Otherwise
`"unsupported"`. The registry is updated, and `providers.md` records the outcome and date. In the
runner (Phase 16), a `structured` prompt × `unsupported` model cell is recorded as **skipped (n/a)**.

**Snapshot the request.** The run stores, per prompt version, the rendered system text, the few-shot
turns and the structured schema it sent (`run.promptSnapshots`). Few-shot labels can be edited later
(Phase 11); the snapshot keeps the run reproducible and the error browser honest about what the model
saw.

## 6. Steps

### 6.1 `renderPrompt.ts`

```ts
export type RenderInput = {
    prompt: { technique: Technique; system: string; user: string; options: { temperature: number; maxTokens: number } };
    task: { instructions: string; fields: FieldRule[] };
    input: string;
    fewShots: { input: string; expected: unknown }[];      // already resolved, dev only
};

export type RenderedRequest = {
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    structured?: { name: string; schema: Record<string, unknown> };
    temperature: number;
    maxTokens: number;
    fewShotStyle: "inline" | "multi_turn" | "none";
};

const canonical = (fields: FieldRule[], value: unknown) =>
    JSON.stringify(Object.fromEntries(fields.map((f) => [f.key, (value as Record<string, unknown>)[f.key] ?? null])), null, 2);

export const renderPrompt = ({ prompt, task, input, fewShots }: RenderInput): RenderedRequest => {
    const usesInline = /{{\s*examples\s*}}/.test(prompt.system + prompt.user);
    const examplesBlock = fewShots
        .map((ex, i) => `Example ${i + 1}\nPosting:\n"""\n${ex.input}\n"""\nJSON:\n${canonical(task.fields, ex.expected)}`)
        .join("\n\n");
    const values = {
        instructions: task.instructions,
        fields: fieldsList(task.fields),
        schema: JSON.stringify(jsonSchemaFor(task.fields), null, 2),
        examples: usesInline ? examplesBlock : "",
    };
    const system = renderTemplate(prompt.system, values);
    const finalUser = renderTemplate(prompt.user, { ...values, input });

    const priorTurns = !usesInline && prompt.technique === "few_shot"
        ? fewShots.flatMap((ex) => [
              { role: "user" as const, content: renderTemplate(prompt.user, { ...values, input: ex.input }) },
              { role: "assistant" as const, content: canonical(task.fields, ex.expected) },
          ])
        : [];

    return {
        system,
        messages: [...priorTurns, { role: "user", content: finalUser }],
        structured: prompt.technique === "structured"
            ? { name: "answer", schema: jsonSchemaFor(task.fields) }        // provider variant applied in complete()
            : undefined,
        temperature: prompt.options.temperature,
        maxTokens: prompt.options.maxTokens,
        fewShotStyle: fewShots.length === 0 ? "none" : usesInline ? "inline" : "multi_turn",
    };
};
```

`complete()` (Phase 13) applies the provider variant: `toOpenAiStrict`, `toGeminiSchema` or
`toNimGuided` on `request.structured.schema`, by `model.provider`.

### 6.2 `providerSchema.ts` (outline)

```ts
type Json = Record<string, unknown>;
const walk = (schema: Json, fn: (node: Json) => Json): Json => { /* recurse into properties, items, anyOf */ };

export const toOpenAiStrict = (schema: Json) => walk(schema, (node) => {
    const { format: _f, default: _d, ...rest } = node;
    if (rest.type === "object") return { ...rest, additionalProperties: false, required: Object.keys((rest.properties as Json) ?? {}) };
    return rest;
});
export const GEMINI_ALLOWED_KEYS = ["type", "properties", "required", "items", "enum", "description", "anyOf", "nullable", "minimum", "maximum", "minItems", "maxItems"]; // verify on the day; record the date
export const toGeminiSchema = (schema: Json) => walk(schema, (node) => Object.fromEntries(Object.entries(node).filter(([k]) => GEMINI_ALLOWED_KEYS.includes(k))));
export const toNimGuided = (schema: Json) => { const { $schema: _s, ...rest } = schema; return rest; };
```

### 6.3 Draft prompt files

- `v1-zero-shot.md`: as in Phase 12 §6.4.
- `v2-few-shot.md`: v1's text + `{{examples}}` in the system, front matter
  `fewShot: [<3 dev ids, one salary_lpa>]`. Use the **same** instructions as v1.
- `v3-cot.md`: v1's text, with the user turn ending in:

```
Think through the posting step by step: title, company, location, work mode, employment type,
minimum experience, skills (only real technical skills), and pay (convert ranges like "3-5 LPA" to
numbers; "competitive" means null). Then write the final answer as a JSON object between <json> and </json>.
```

  `maxTokens: 1500`.
- `v4-structured.md`: v1's text, `technique: structured`; the instruction "Return only JSON" stays (it
  helps models that half-honour the schema).

### 6.4 Probe

```bash
pnpm --filter api exec tsx src/scripts/probe-structured.ts --all   # each enabled model: native | guided_json | unsupported
```

The probe writes the result to the `models` collection and prints a table to paste into `providers.md`.

## 7. Verify

1. `GET /prompts/<v2>/preview?exampleId=<dev id>` → the system contains 3 numbered examples (inline),
   or the messages contain 3 user/assistant pairs (multi-turn) if `{{examples}}` is removed.
2. The v3 preview ends with the `<json>` instruction; `maxTokens` is 1500.
3. The v4 preview shows `structured.schema` with 8 properties; for an OpenAI model the converted
   schema has `additionalProperties: false` and all keys `required` (unit test).
4. The probe on 3 NVIDIA models → a table with results; models marked `unsupported` show "n/a" for v4
   in Phase 17.
5. `renderPrompt` with an input containing `{{fields}}` → the literal text survives (single pass).

## 8. Definition of done

- [ ] Four techniques render from one function; differences live only in the technique.
- [ ] Provider schema variants are unit-tested; the probe records per-model support.
- [ ] Draft v1–v4 files exist with shared instructions.
- [ ] Commit: `feat: technique rendering and structured-output probing`.

## 9. Interview angle

- *"Did chain-of-thought help?"* (Your numbers.) Extraction rarely needs reasoning, so CoT mostly adds
  output tokens. The delimiter means a model that rambles without a final block is scored as broken
  JSON, which is fair.
- *"Why structured output?"* It guarantees format, not correctness. My table separates valid-JSON %
  from field accuracy, and I probed each model, because some hosted models silently ignore the schema.
