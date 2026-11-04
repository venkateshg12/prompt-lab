# Phase 15 — Techniques: few-shot, chain-of-thought, structured output + the probe

## 1. Goal

Turn *(prompt version, task, example, model)* into the exact request a provider receives, for the four
techniques the spec compares, with the differences living **only** in the technique:

| Technique | What changes in the request | How the answer is found (Phase 16) |
| --- | --- | --- |
| `zero_shot` | system + one user turn | the whole reply (a code fence is stripped) |
| `few_shot` | + 3 worked **dev** examples, inline (`{{examples}}`) or as prior user/assistant turns | the whole reply |
| `cot` | the user turn asks for reasoning first, then the final JSON between `<json>` and `</json>` | the **last** `<json>` block |
| `structured` | + the provider's schema mode, with the task's schema converted for that provider | the whole reply |

Plus a **probe** (`probe-structured.ts`) that checks, per model, whether schema mode is really honoured.
It writes `models.structured`, and with `--csv` a file the Playbook's Lesson 4 imports. A `structured`
prompt on an `unsupported` model becomes a **skipped** cell ("n/a"), never a fake number.

## 2. What I will understand after this phase

1. Why few-shot can be inline or multi-turn, and why the choice is part of the version.
2. Why chain-of-thought needs a machine-readable delimiter, and why the *last* block wins.
3. What schema mode guarantees (format) and what it doesn't (correctness).
4. Why each provider needs its own small schema conversion (OpenAI strict, Anthropic, Gemini subset,
   NVIDIA guided JSON).
5. Why "probe, don't assume": hosted models silently ignore schema parameters.
6. Why the rendered request is snapshotted per run (Phase 17 stores it).

## 3. Prerequisites

- Phase 11 (`@repo/types/fieldRules.ts`: `FieldRule`, `jsonSchemaFor`, `answerSchemaFor`,
  `valueSchemaFor`, `fieldsList`), Phase 13 (`PromptVersion`, `renderTemplate` single-pass,
  `fewShotExampleIds` dev-only), Phase 14 (`Model` registry, `complete()`, the four provider adapters).
- `packages/scoring` exists as an empty workspace package from Phase 00 (architecture.md §2). This
  phase adds its first two files; Phase 16 adds the rest.

## 4. Files

```
packages/scoring/src/
├── renderPrompt.ts                 NEW   (pure: prompt + task + input + few-shots → RenderedRequest)
├── providerSchema.ts               NEW   (pure: toOpenAiStrict, toAnthropicSchema, toGeminiSchema, toNimGuided)
└── __tests__/{renderPrompt,providerSchema}.test.ts   NEW
apps/api/src/
├── ai/providers/openai.ts          ADAPT (Phase 14 file: + response_format json_schema strict)
├── ai/providers/anthropic.ts       ADAPT (+ output_config.format)
├── ai/providers/gemini.ts          ADAPT (+ generationConfig.responseFormat.text)
├── ai/providers/nvidia.ts          ADAPT @pt-api/src/ai/providers/nvidia.ts via Phase 14 (+ nvext.guided_json)
├── services/prompt.service.ts      ADAPT (Phase 13: preview uses renderPrompt)
├── services/model.service.ts       ADAPT (Phase 14: setStructuredSupport)
├── controllers/model.controller.ts ADAPT (+ POST /admin/models/probe, platform admin)
└── scripts/probe-structured.ts     NEW   (--model <key> | --all, --csv <file>)
cases/job-postings/prompts/{v1-zero-shot,v2-few-shot,v3-cot,v4-structured}.md   NEW (drafts; Phase 25 finalises)
```

No migration: `Model.structured` and `structuredProbedAt` exist from Phase 14.

## 5. Concepts

**Few-shot, two ways.**
- **Inline**: the template contains `{{examples}}`, rendered as numbered "Posting / JSON" pairs. The
  model reads the examples as part of the instructions.
- **Multi-turn**: no `{{examples}}` placeholder, so each example becomes a `user` turn followed by an
  `assistant` turn with its expected JSON, then the real input. Many chat models imitate earlier
  assistant turns more faithfully.

Which one a version uses is visible in its template, so it is part of the frozen version
(`fewShotStyle` is recorded in the snapshot). The expected JSON is rendered **canonically**
(`JSON.stringify` with keys in field order, 2-space indent), so the examples also teach the exact shape.
Few-shot examples must be `dev` examples: Phase 13 enforces it at save time, and `renderPrompt` throws
if handed a `test` example, as a second lock.

**Chain-of-thought with a delimiter.** "Think step by step" turns the reply into prose plus JSON. The
technique asks for the final answer between `<json>` and `</json>`, and the extractor (Phase 16) takes
the **last** block: a model that drafts an answer and then corrects it is judged on its final answer.
No block → `validJson: false`. CoT also needs more output tokens (`maxTokens: 1500` vs 600), which
shows up in cost. The spec's interview question asks for exactly that trade-off.

**Schema mode = format, not truth.** Constrained decoding makes the reply parse and match the schema.
It doesn't make `stipend_or_salary.min` right. Expect v4 to win on valid-JSON % and not necessarily
on accuracy. Either outcome is a good README finding.

**Provider variants** (all derived from `jsonSchemaFor(task.fields)`, all pure, all unit-tested). The
request shapes were re-checked on 3 November 2026 (see `providers.md`, and the sources at its end):

| Provider | Request field | Converter |
| --- | --- | --- |
| OpenAI | `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }` | `toOpenAiStrict`: every property in `required`, `additionalProperties: false` on every object, optional → `type: [T, "null"]`, drops `format`/`default`/`pattern` |
| Anthropic | `output_config: { format: { type: "json_schema", schema } }` (current Messages API reference) | `toAnthropicSchema`: `additionalProperties: false` on objects; drops keywords the structured-outputs page lists as unsupported |
| Gemini | `generationConfig.responseFormat.text: { mimeType: "APPLICATION_JSON", schema }` (current docs; older `responseMimeType` + `responseSchema` still appears in examples) | `toGeminiSchema`: keeps the documented subset only (`GEMINI_ALLOWED_KEYS`, dated) |
| NVIDIA NIM | `nvext: { guided_json: schema }` | `toNimGuided`: drops `$schema` |

`json_object` modes are not used anywhere: they allow *any* JSON, even `{}`.

**Probe, don't assume.** A model card saying "supports JSON mode" describes the model, not the hosted
endpoint you call. `probe-structured.ts` sends a tiny schema (`{ colour: "red" | "blue", sure: boolean }`)
three times with a prompt designed to tempt prose ("Explain your reasoning, then answer"). 3/3 bare,
schema-valid JSON → `supported`; anything else → `unsupported`; a transport error leaves the model
`untested` and prints why. The probe never overwrites a result with `untested`.

**Untested blocks structured runs.** `createRun` (Phase 17) rejects a `structured` prompt on an
`untested` model with "probe this model first". `unsupported` → the cells are `skipped`. Only
`supported` models produce v4 numbers.

**Snapshot the request.** Phase 17 renders each prompt version once per run (system text, few-shot
turns, structured schema, `fewShotStyle`) and stores it on the run. A label edit mid-run then can't
change what later cells see, and the error browser shows exactly what the model received.

## 6. Steps

### 6.1 `renderPrompt.ts`

```ts
import { jsonSchemaFor, fieldsList, type FieldRule, type Technique } from "@repo/types";
import { renderTemplate } from "./template";          // Phase 13 moved it here: single pass, unknown {{x}} left as-is

export type FewShot = { ref: string; split: "dev" | "test"; input: string; expected: unknown };
export type RenderInput = {
    prompt: { technique: Technique; system: string; template: string; maxTokens?: number; temperature?: number };
    task: { instructions: string; fields: FieldRule[] };
    input: string;
    fewShots: FewShot[];
};
export type Turn = { role: "user" | "assistant"; content: string };
export type RenderedRequest = {
    system: string;
    messages: Turn[];
    structured?: { name: string; schema: Record<string, unknown> };
    temperature: number;
    maxTokens: number;
    fewShotStyle: "inline" | "multi_turn" | "none";
};

export const canonical = (fields: FieldRule[], value: unknown) =>
    JSON.stringify(Object.fromEntries(fields.map((f) => [f.key, (value as Record<string, unknown>)?.[f.key] ?? null])), null, 2);

const EXAMPLES = /{{\s*examples\s*}}/;

export const renderPrompt = ({ prompt, task, input, fewShots }: RenderInput): RenderedRequest => {
    if (fewShots.some((s) => s.split !== "dev")) throw new Error("few-shot examples must come from the dev split");
    const inline = EXAMPLES.test(prompt.system + prompt.template);
    const examples = fewShots
        .map((ex, i) => `Example ${i + 1}\nPosting:\n"""\n${ex.input}\n"""\nJSON:\n${canonical(task.fields, ex.expected)}`)
        .join("\n\n");
    const shared = { instructions: task.instructions, fields: fieldsList(task.fields), examples: inline ? examples : "" };
    const user = (text: string) => renderTemplate(prompt.template, { ...shared, input: text });

    const prior: Turn[] =
        !inline && prompt.technique === "few_shot"
            ? fewShots.flatMap((ex) => [
                  { role: "user" as const, content: user(ex.input) },
                  { role: "assistant" as const, content: canonical(task.fields, ex.expected) },
              ])
            : [];

    return {
        system: renderTemplate(prompt.system, shared),
        messages: [...prior, { role: "user", content: user(input) }],
        structured: prompt.technique === "structured" ? { name: "answer", schema: jsonSchemaFor(task.fields) } : undefined,
        temperature: prompt.temperature ?? 0,
        maxTokens: prompt.maxTokens ?? (prompt.technique === "cot" ? 1500 : 600),
        fewShotStyle: fewShots.length === 0 ? "none" : inline ? "inline" : "multi_turn",
    };
};
```

`input` goes in last and through the same single pass, so a posting that contains `{{fields}}` stays
literal text (a test covers it).

### 6.2 `providerSchema.ts`

```ts
type Json = Record<string, unknown>;

const walk = (node: Json, fn: (n: Json) => Json): Json => {
    const out = fn({ ...node });
    if (out.properties) out.properties = Object.fromEntries(Object.entries(out.properties as Json).map(([k, v]) => [k, walk(v as Json, fn)]));
    if (out.items) out.items = walk(out.items as Json, fn);
    for (const key of ["anyOf", "oneOf"] as const) if (Array.isArray(out[key])) out[key] = (out[key] as Json[]).map((s) => walk(s, fn));
    return out;
};
const drop = (n: Json, keys: string[]) => Object.fromEntries(Object.entries(n).filter(([k]) => !keys.includes(k)));

export const toOpenAiStrict = (schema: Json) =>
    walk(drop(schema, ["$schema"]), (n) => {
        const node = drop(n, ["format", "default", "pattern", "minLength", "maxLength"]);
        if (node.type !== "object") return node;
        const props = (node.properties ?? {}) as Json;
        const required = new Set((node.required as string[]) ?? []);
        // Strict mode needs every key required: an optional key becomes "required but nullable".
        const nullable = Object.fromEntries(Object.entries(props).map(([k, v]) => {
            const p = v as Json;
            if (required.has(k) || (Array.isArray(p.type) && p.type.includes("null"))) return [k, p];
            return [k, { ...p, type: [p.type, "null"].flat() }];
        }));
        return { ...node, properties: nullable, required: Object.keys(props), additionalProperties: false };
    });

export const toAnthropicSchema = (schema: Json) =>
    walk(drop(schema, ["$schema"]), (n) => (n.type === "object" ? { ...n, additionalProperties: false } : n));

/** Gemini accepts a documented subset of JSON Schema. Checked 3 Nov 2026; re-check when Phase 14 is built. */
export const GEMINI_ALLOWED_KEYS = ["type", "properties", "required", "items", "enum", "description", "anyOf", "minimum", "maximum", "minItems", "maxItems", "title"] as const;
export const toGeminiSchema = (schema: Json) =>
    walk(schema, (n) => Object.fromEntries(Object.entries(n).filter(([k]) => (GEMINI_ALLOWED_KEYS as readonly string[]).includes(k))));

export const toNimGuided = (schema: Json) => drop(schema, ["$schema"]);
```

### 6.3 Provider adapters (ADAPT the Phase 14 files)

Each adapter reads `request.structured` and adds exactly one field; nothing else changes:

```ts
// openai.ts
...(req.structured && { response_format: { type: "json_schema", json_schema: { name: req.structured.name, schema: toOpenAiStrict(req.structured.schema), strict: true } } }),
// anthropic.ts
...(req.structured && { output_config: { format: { type: "json_schema", schema: toAnthropicSchema(req.structured.schema) } } }),
// gemini.ts (inside generationConfig)
...(req.structured && { responseFormat: { text: { mimeType: "APPLICATION_JSON", schema: toGeminiSchema(req.structured.schema) } } }),
// nvidia.ts
...(req.structured && { nvext: { guided_json: toNimGuided(req.structured.schema) } }),
```

If a provider rejects the field with a 400 (the API changed), that's an `unrecoverable` error for the
cell, and the probe marks the model `unsupported`: the run doesn't silently fall back to free text.

### 6.4 Draft prompt files (`cases/job-postings/prompts/`)

Front matter + body, imported by Phase 13's `import-cases.ts`:

- `v1-zero-shot.md`: `technique: zero_shot`. System: `{{instructions}}` + "Fields:\n{{fields}}" +
  "Return only a JSON object with exactly these keys. Use null when a value isn't stated. No prose,
  no code fences." User: `Posting:\n"""\n{{input}}\n"""`.
- `v2-few-shot.md`: v1's text plus `{{examples}}` at the end of the system, front matter
  `fewShot: [jp_0xx, jp_0yy, jp_0zz]` (3 dev refs, one tagged `salary_lpa`; Phase 25 picks them).
- `v3-cot.md`: v1's text, with the user turn ending:

  ```
  Think through the posting step by step: title, company, location, work mode, employment type,
  minimum experience, skills (only real technical skills), and pay (convert "3-5 LPA" to numbers;
  "competitive" means null). Then write the final answer as a JSON object between <json> and </json>.
  ```
  `maxTokens: 1500`.
- `v4-structured.md`: v1's text, `technique: structured`. Keep "Return only a JSON object": it helps
  models that half-honour the schema.

### 6.5 The probe

```ts
// scripts/probe-structured.ts (outline)
const PROBE_VERSION = "probe@1";
const SCHEMA = { type: "object", properties: { colour: { type: "string", enum: ["red", "blue"] }, sure: { type: "boolean" } }, required: ["colour", "sure"] };
const PROMPT = "Explain your reasoning in a sentence, then answer: is the sky on a clear day red or blue?";

for (const model of targets) {                      // --all = every active model; --model <key> = one
    let ok = 0, transportError: string | null = null;
    for (let i = 0; i < 3; i++) {
        try {
            const r = await complete(model, priceOf(model), { system: "Answer the question.", messages: [{ role: "user", content: PROMPT }],
                structured: { name: "probe", schema: SCHEMA }, temperature: 0, maxTokens: 100 });
            if (isBareSchemaValid(r.text, SCHEMA)) ok++;            // JSON.parse of the whole text, then Zod
        } catch (e) { transportError = String((e as Error).message).slice(0, 200); break; }
    }
    const support = transportError ? "untested" : ok === 3 ? "supported" : "unsupported";
    if (support !== "untested") await setStructuredSupport(model.key, support, modeOf(model.provider, support), new Date());   // writes Model.structured + structuredMode
    rows.push({ model: model.key, support, mode: modeOf(model.provider, support), probed_on: today(), probe_version: PROBE_VERSION });
}
printTable(rows);
if (flagValue("--csv")) await writeCsv(flagValue("--csv")!, rows);     // header: model,support,mode,probed_on,probe_version
```

`modeOf` is `guided_json` for NVIDIA, `native` for the other three, `none` when unsupported. CSV
writing uses `utils/csv.ts` (COPY of `@pt-api/src/utils/csv.ts`, added in Phase 22; until then, build
the five fields by hand, since none can contain a comma). The script closes Prisma, the queue
connection and the cache in `finally`: a CLI that imports services otherwise hangs on their sockets.

`POST /admin/models/probe { modelKey }` (platform admin) calls the same function for one model, so the
web app can re-probe after a provider update.

### 6.6 Tests

| Case | Expected |
| --- | --- |
| v2 inline | system contains `Example 1` … `Example 3`; `fewShotStyle: "inline"` |
| v2 with `{{examples}}` removed | 3 user/assistant pairs before the real input; `multi_turn` |
| a `test` example passed as a few-shot | throws |
| v3 | last user turn ends with the `<json>` instruction; `maxTokens: 1500` |
| v4 | `structured.schema` has 8 properties |
| input containing `{{fields}}` | survives literally |
| `toOpenAiStrict` on a schema with an optional key | key in `required`, type `[T, "null"]`, `additionalProperties: false` at every depth |
| `toGeminiSchema` on `{ format: "date", $schema: … }` | both keys gone |
| `toNimGuided` | `$schema` gone, everything else identical |

## 7. Verify

```bash
pnpm --filter @repo/scoring test -- renderPrompt providerSchema     # all green
curl -s -b cookies.txt "localhost:5000/orgs/$ORG/tasks/$TASK/prompts/$V2/preview?exampleRef=jp_005" | jq '.data.fewShotStyle, (.data.system | test("Example 3"))'
# "inline"
# true
pnpm --filter api exec tsx src/scripts/probe-structured.ts --all --csv /tmp/probe.csv
# model                                   support      mode
# nvidia:nvidia/nemotron-3-super-120b-a12b <result>    <mode>
# …
head -1 /tmp/probe.csv
# model,support,mode,probed_on,probe_version
psql "$DATABASE_URL" -c "select key, structured, structured_probed_at from models"
```

Expected: each model's `structured` matches the CSV; a model whose probe hit a 410 (retired) or 401
stays `untested` with the error printed, and Phase 14's registry marks a 410 model inactive.

## 8. Definition of done

- [ ] One `renderPrompt` renders all four techniques; the differences live only in the technique.
- [ ] Provider schema converters are pure and unit-tested; each adapter adds exactly one field.
- [ ] The probe updates `models.structured` and writes the CSV the Playbook imports.
- [ ] `structured` on an `untested` model is refused by `createRun` (asserted in Phase 17's Verify).
- [ ] Draft v1–v4 files share their instructions word for word.
- [ ] Commit: `feat: technique rendering, provider schema modes and the structured-output probe`.

## 9. Interview angle

- *"Did chain-of-thought help?"* (Your numbers.) Extraction rarely needs reasoning, so CoT mostly adds
  output tokens. The delimiter means a model that rambles without a final block scores as broken JSON,
  which is fair: a production parser would fail on it too.
- *"Why structured output?"* It guarantees format, not correctness. My table separates valid-JSON %
  from field accuracy, and I probe every hosted model, because some accept the parameter and ignore it.
  An unsupported model shows "n/a", not a number from a different technique.
