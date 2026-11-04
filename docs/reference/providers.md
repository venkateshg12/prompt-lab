# Model providers

Prompt Lab calls models through one function, `complete()`, backed by small `fetch` adapters. **NVIDIA
NIM is the default** (free credits, OpenAI-compatible). OpenAI, Anthropic and Gemini adapters are
built and switch on automatically when their API key is set.

> First checked on **24 October 2026**; updated **3 November 2026** with what the Playbook build found
> (NVIDIA retired its Llama 3.x endpoints on 26 Aug 2026: they answer **410 Gone**).
> Everything on this page was checked on **24 October 2026**: request shapes against provider docs,
> model ids on the providers' model pages. Providers rename models and fields often. Re-check before
> Phase 13 and update the dates in `models.config.ts`.

## 1. The common contract

```ts
type CompleteRequest = {
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
    temperature: number;            // 0 for benchmarks; consistency is measured, not assumed
    maxTokens: number;
    structured?: { name: string; schema: JsonSchema };   // v4 "structured output" technique only
    signal: AbortSignal;
};
type CompleteResult = {
    text: string;                   // EXACTLY what the model returned (never parsed or repaired here)
    usage: { inputTokens: number; outputTokens: number };
    finishReason: "stop" | "length" | "other";
    providerRequestId?: string;
};
```

A provider throws a `ProviderHttpError` that carries `status`, so `isRetryable` (copied from PaperTrail)
can decide. Retried: 408/429/5xx/timeouts/network. Never retried: anything else, and never "the JSON
was wrong".

## 2. NVIDIA NIM (default)

- `POST https://integrate.api.nvidia.com/v1/chat/completions`, `Authorization: Bearer $NVIDIA_API_KEY`.
- Body: `{ model, messages: [{role:"system"},…], temperature, max_tokens }`.
  Usage: `usage.prompt_tokens` / `usage.completion_tokens`.
- **Structured output.** NVIDIA's NIM docs recommend `guided_json` passed through the `nvext`
  extension (`"nvext": { "guided_json": <schema> }`). Their VLM docs show
  `response_format: { type: "json_schema", json_schema: … }`. Both pages describe the
  **self-hosted** NIM. Whether the **hosted** `integrate.api.nvidia.com` endpoint honours them can
  vary by model, so the adapter sends `nvext.guided_json`, and Phase 14 includes a probe script that
  checks each chosen model ("does it obey a tiny schema?"). A model that ignores it is labelled
  `structured: "unsupported"` in the registry, and the v4 cell is reported as "n/a", never as a fake
  number.
- `json_object` mode isn't used: NVIDIA notes it lets the model return *any* JSON, even `{}`.
- Some Nemotron models "think" first. Benchmarks keep the model's default behaviour unless the
  technique says otherwise. Record `chat_template_kwargs` per model in the registry if you change it,
  because it's part of what's being compared.

**Pick three model families** hosted on build.nvidia.com from the live `GET /v1/models` list plus a
one-call probe (Phase 14), never from memory. Verified working on 2 Nov 2026 in the Playbook build:
`nvidia/nemotron-3-super-120b-a12b`, `openai/gpt-oss-20b`; add a third family (e.g. a Qwen or Mistral
instruct) that the probe accepts. Map **410** to `model_retired`, **401/403** to `auth_error`. Three families make the comparison mean something. Write the chosen ids,
context lengths and dates in `models.config.ts`.

## 3. OpenAI (optional: `OPENAI_API_KEY`)

- Same Chat Completions shape as NVIDIA, base URL `https://api.openai.com/v1`, so one adapter
  (`openaiCompatible`) serves both.
- Structured output: `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`.
  Strict mode needs every property listed in `required` and `additionalProperties: false` on every
  object. Phase 14's `toStrictJsonSchema()` makes optional fields nullable instead of optional.

## 4. Anthropic Claude (optional: `ANTHROPIC_API_KEY`)

- `POST https://api.anthropic.com/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`,
  `content-type: application/json`.
- Body: `{ model, system, messages, max_tokens, temperature }`. The reply text is the concatenation of
  `content[].text`; usage is `usage.input_tokens` / `usage.output_tokens`; the end reason is
  `stop_reason` (`end_turn`, `max_tokens`, …).
- Structured output: the Messages API's JSON outputs take a schema as
  `output_config: { format: { type: "json_schema", schema } }`. Older beta material uses
  `output_format`. Check the current API reference and use whatever it says on the day. Objects need
  `additionalProperties: false`.

## 5. Google Gemini (optional: `GEMINI_API_KEY`)

- `POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`, header
  `x-goog-api-key`.
- Body: `{ systemInstruction: { parts:[{text}] }, contents: [{ role:"user", parts:[{text}] }], generationConfig: { temperature, maxOutputTokens } }`.
  Text: `candidates[0].content.parts[].text`; usage is `usageMetadata.promptTokenCount` /
  `candidatesTokenCount`.
- Structured output: current docs show
  `generationConfig.responseFormat.text = { mimeType: "APPLICATION_JSON", schema }`, and older
  examples use `responseMimeType: "application/json"` + `responseSchema` (OpenAPI-subset types) or
  `responseJsonSchema`. Use the form the current reference shows. Gemini supports a **subset** of JSON
  Schema, and Phase 14's converter strips unsupported keywords.
- Gemini also has a newer "interactions" endpoint. The adapter uses `generateContent`, which is
  simpler and stable.

## 6. Prices

Prices live in the `models` table (PostgreSQL, seeded from `models.config.ts`; each run snapshots them), per million tokens, with
`priceCheckedOn`. NVIDIA's hosted free tier costs ≈ $0, so for NVIDIA models record the **published
price of the same open model at a reference host**, and say so in the README. Cost per 100 inputs is
otherwise meaningless. Never compare a "free" NVIDIA cell with a paid OpenAI cell without that note.

## Sources

- NVIDIA NIM structured generation (LLMs, `nvext.guided_json`): https://docs.nvidia.com/nim/large-language-models/1.12.0/structured-generation.html
- NVIDIA NIM structured generation (VLMs, `response_format`): https://docs.nvidia.com/nim/vision-language-models/1.7.0/structured-generation.html
- Claude Messages API (`output_config.format`, JSON outputs): https://platform.claude.com/docs/en/api/messages
- Gemini structured output: https://ai.google.dev/gemini-api/docs/generate-content/structured-output
- OpenAI-style `json_schema` + `strict`: https://docs.deno.com/examples/openai_structured_output/ (verify against platform.openai.com)

## Live-call status (`try-model` / `list-nvidia-models`)

| Model | Status | Date |
| --- | --- | --- |
| `nvidia:openai/gpt-oss-20b` | adapter verified against a local NIM-shaped stub (wire format, 403/410 mapping, cost). **Live call not run: no `NVIDIA_API_KEY` in this environment.** | 4 Nov 2026 |
| `nvidia:nvidia/nemotron-3-super-120b-a12b` | as above | 4 Nov 2026 |
| third NVIDIA family | not chosen yet: needs `list-nvidia-models` + the probe with a key | |
| OpenAI / Anthropic / Gemini | adapters unit-tested for request shape only; enabled when their key is set | |

Prices in `models.config.ts` come from price aggregators (pricepertoken.com, anotherwrapper.com), checked
4 Nov 2026; re-check against the host's own pricing page before any reported run.
