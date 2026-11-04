# Phase 13 — Model registry and provider adapters

## 1. Goal

One function, `complete()`, that sends a rendered prompt to any registered model and returns **exactly
what the model said**, with tokens, latency and cost:
- a **model registry** seeded from `models.config.ts`: provider, model id, family, prices with
  `priceCheckedOn`, structured-output support, limits;
- **adapters**:
  - `openaiCompatible` (NVIDIA NIM, the default, and OpenAI);
  - `anthropic`;
  - `gemini`;
  - `fake` and `replay` for tests;
- PaperTrail's reliability layer reused as is: `withRetry` (429/5xx/timeouts only), typed errors,
  the per-model lease semaphore, the RPM budget and the circuit breaker;
- a model is **enabled** only when its provider key is configured; NVIDIA is always on.

Read [../reference/providers.md](../reference/providers.md) first.

## 2. What I will understand after this phase

1. Why Prompt Lab's model call returns raw text, unlike PaperTrail's `generateJson`.
2. Why there's **no fallback model**: a benchmark measures *this* model.
3. Why every adapter is plain `fetch`.
4. How the copied breaker, lease and RPM budget compose around one call.
5. Why prices carry a date.

## 3. Prerequisites

Phase 12 done. An NVIDIA API key. Optional OpenAI / Anthropic / Gemini keys.

## 4. Files

```
packages/types/src/model.ts                 NEW   (model registry schema, CompleteRequest/Result types)
apps/api/src/
├── config/models.config.ts                 NEW   (the registry seed: ids, prices, dates, limits)
├── models/model.model.ts                   NEW
├── ai/types.ts                             ADAPT @pt-api/src/ai/types.ts          (Provider + complete contract)
├── ai/errors.ts                            ADAPT @pt-api/src/ai/errors.ts         (drop SchemaViolation; add ProviderHttpError, ProviderNotConfigured)
├── ai/reliability.ts (+ test)              COPY  @pt-api/src/ai/reliability.ts, reliability.test.ts
├── ai/breakers.ts                          COPY  @pt-api/src/ai/breakers.ts
├── ai/concurrency.ts                       COPY  @pt-api/src/ai/concurrency.ts
├── constants/llm.ts                        ADAPT @pt-api/src/constants/llm.ts     (MODEL_LIMITS from the registry)
├── ai/providers/openaiCompatible.ts        ADAPT @pt-api/src/ai/providers/nvidia.ts (raw text; base URL + key per provider)
├── ai/providers/anthropic.ts               NEW
├── ai/providers/gemini.ts                  NEW
├── ai/providers/fake.ts                    ADAPT @pt-api/src/ai/providers/fake.ts  (scripted TEXT)
├── ai/providers/replay.ts                  ADAPT @pt-api/src/ai/providers/replay.ts (records TEXT responses)
├── ai/complete.ts                          NEW   (registry lookup → breaker → RPM → lease → withRetry → adapter)
├── utils/cost.ts                           ADAPT @pt-api/src/utils/cost.ts         (prices from the model record)
├── services/model.service.ts · routes/model.route.ts   NEW
├── scripts/try-model.ts                    NEW
└── constants/env.ts                        ADAPT (+ NVIDIA_*, OPENAI_*, ANTHROPIC_*, GEMINI_*, LLM_PROVIDER)
```

## 5. Concepts

**Raw text, always.** PaperTrail's `generateJson` parses, repairs (`parseModelJson`) and validates,
because it needs a usable answer. Prompt Lab needs the opposite: the **exact** text, because "this
prompt breaks JSON 9 % of the time on model X" is one of the results. `complete()` never parses.
Scoring does that later, with recorded rules (Phase 15).

**No fallback.** PaperTrail falls back to another model so a document still gets processed. A
benchmark cell for *model A* answered by *model B* is a lie in the results table. So when a provider
is down:
1. the call retries (transient errors, `withRetry`);
2. the breaker opens after repeated failures, so further calls fail fast with `ProviderSkipped`
   instead of each waiting 3 × 45 s;
3. the **cell job** backs off and retries later (Phase 16);
4. after its attempts it's recorded as an **error cell**, shown in the table and excluded from
   accuracy.

The breaker class is still PaperTrail's (originally e-commerce's rate-limiter breaker); only the
fallback action changed.

**Composition, per call** (copied pieces in bold):

```
**breakerFor(model)** → **assertRpmBudget(model)** → **withLease(model)** → **withRetry**(adapter.complete, 3 attempts, 60 s)
```

The lease and RPM keys use the registry `key` (e.g. `nvidia:meta/llama-3.3-70b-instruct`), so two
models from the same provider get separate budgets. Add a per-**provider** lease too
(`provider:nvidia`) when a provider limits total concurrency across models.

**Plain fetch.** Official SDKs retry by themselves (OpenAI's retries twice by default), which would
hide attempts under `withRetry`, inflate latency and break the "one recorded call = one model
answer" rule. Every adapter is ~60 lines of `fetch`. CounselDesk and PaperTrail made the same choice.

**Latency** is measured around the **successful attempt** (`performance.now()` before and after the
adapter call), not including backoff waits. p95 should describe the model, not your retry policy.
Retries are counted separately (`attempts` on the result).

**Prices with dates.** `inputPerM` / `outputPerM` in USD, `priceCheckedOn: "2026-10-24"`,
`priceSource` (URL). NVIDIA hosted calls are free on credits, so for cost per 100 inputs to mean
anything, record the published price of the same open model at a reference host, with
`priceSource` saying so. Cost is computed into integer micro-dollars by the copied `cost.ts`
(adapted to take the price from the model record).

## 6. Steps

### 6.1 Registry (`config/models.config.ts`)

```ts
export type ModelConfig = {
    key: string;                                    // stable id used everywhere: "<provider>:<modelId>"
    provider: "nvidia" | "openai" | "anthropic" | "gemini" | "fake";
    modelId: string;                                 // what the provider API expects
    label: string;                                   // "Llama 3.3 70B (NIM)"
    family: string;                                  // "llama" | "nemotron" | "qwen" | "gpt" | "claude" | "gemini"
    contextTokens: number;
    structured: "native" | "guided_json" | "unsupported" | "unknown";   // Phase 14 probes and updates it
    price: { inputPerM: number; outputPerM: number; checkedOn: string; source: string };
    limits: { concurrency: number; rpm: number };
};

// Fill every row on the day you build this phase: ids from each provider's model page, prices from
// their pricing page, dates = today. Three NVIDIA families by default; the rest enable with a key.
export const MODELS: ModelConfig[] = [
    // { key: "nvidia:<id>", provider: "nvidia", modelId: "<id>", label: "…", family: "llama", contextTokens: 128000,
    //   structured: "unknown", price: { inputPerM: …, outputPerM: …, checkedOn: "2026-10-24", source: "<reference host pricing URL>" },
    //   limits: { concurrency: 4, rpm: 40 } },
    // … nemotron, qwen/mistral on NVIDIA …
    // … one OpenAI, one Anthropic, one Gemini model (cheap tier is fine for extraction) …
    { key: "fake:text", provider: "fake", modelId: "fake", label: "Fake (tests)", family: "fake", contextTokens: 100000,
      structured: "native", price: { inputPerM: 1, outputPerM: 5, checkedOn: "2026-10-24", source: "test" }, limits: { concurrency: 50, rpm: 100000 } },
];
```

`models` collection: the same fields, plus `enabled` (computed at startup: the provider's key is
set, or the provider is `nvidia`/`fake`) and `archivedAt`. It's **global** (not per owner): the
registry is configuration. `npm run seed:models` upserts by `key`. A price change keeps old results'
stored `costUsdMicros` intact, since cost is computed at call time and stored on the result.

`GET /models` lists enabled models with prices and dates; the UI shows the date next to every price.

### 6.2 Contract (`ai/types.ts`, ADAPT)

```ts
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type CompleteRequest = {
    system: string;
    messages: ChatMessage[];
    temperature: number;
    maxTokens: number;
    structured?: { name: string; schema: Record<string, unknown> };
    signal: AbortSignal;
};
export type CompleteResult = {
    text: string;
    usage: { inputTokens: number; outputTokens: number };
    finishReason: "stop" | "length" | "other";
};
export interface Provider {
    complete(model: ModelConfig, request: CompleteRequest, apiKey: string): Promise<CompleteResult>;
}
```

### 6.3 Adapters

```ts
// ai/providers/openaiCompatible.ts — NVIDIA NIM and OpenAI share the Chat Completions shape.
type ChatCompletion = {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export const createOpenAiCompatible = (baseUrl: string): Provider => ({
    async complete(model, req, apiKey) {
        const body: Record<string, unknown> = {
            model: model.modelId,
            temperature: req.temperature,
            max_tokens: req.maxTokens,
            messages: [{ role: "system", content: req.system }, ...req.messages],
        };
        if (req.structured) {
            if (model.provider === "nvidia") {
                // NIM's documented constrained decoding (see providers.md); Phase 14 probes per model.
                body.nvext = { guided_json: req.structured.schema };
            } else {
                body.response_format = { type: "json_schema", json_schema: { name: req.structured.name, schema: req.structured.schema, strict: true } };
            }
        }
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: req.signal,
        });
        if (!response.ok) throw new ProviderHttpError(model.key, response.status, await response.text());
        const json = (await response.json()) as ChatCompletion;
        const choice = json.choices?.[0];
        return {
            text: choice?.message?.content ?? "",
            usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 },
            finishReason: choice?.finish_reason === "stop" ? "stop" : choice?.finish_reason === "length" ? "length" : "other",
        };
    },
});
```

```ts
// ai/providers/anthropic.ts
export const anthropicProvider: Provider = {
    async complete(model, req, apiKey) {
        const body: Record<string, unknown> = {
            model: model.modelId, system: req.system, messages: req.messages,
            max_tokens: req.maxTokens, temperature: req.temperature,
        };
        // JSON outputs: check the current Messages API reference for the exact field (providers.md §4).
        if (req.structured) body.output_config = { format: { type: "json_schema", schema: req.structured.schema } };
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify(body), signal: req.signal,
        });
        if (!response.ok) throw new ProviderHttpError(model.key, response.status, await response.text());
        const json = (await response.json()) as {
            content?: { type: string; text?: string }[]; stop_reason?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
        };
        return {
            text: (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
            usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
            finishReason: json.stop_reason === "end_turn" ? "stop" : json.stop_reason === "max_tokens" ? "length" : "other",
        };
    },
};
```

```ts
// ai/providers/gemini.ts
export const geminiProvider: Provider = {
    async complete(model, req, apiKey) {
        const generationConfig: Record<string, unknown> = { temperature: req.temperature, maxOutputTokens: req.maxTokens };
        // Current docs: responseFormat.text { mimeType, schema }. Older: responseMimeType + responseSchema. See providers.md §5.
        if (req.structured) generationConfig.responseFormat = { text: { mimeType: "APPLICATION_JSON", schema: req.structured.schema } };
        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.modelId)}:generateContent`,
            {
                method: "POST",
                headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: req.system }] },
                    contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
                    generationConfig,
                }),
                signal: req.signal,
            }
        );
        if (!response.ok) throw new ProviderHttpError(model.key, response.status, await response.text());
        const json = (await response.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const candidate = json.candidates?.[0];
        return {
            text: (candidate?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
            usage: { inputTokens: json.usageMetadata?.promptTokenCount ?? 0, outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0 },
            finishReason: candidate?.finishReason === "STOP" ? "stop" : candidate?.finishReason === "MAX_TOKENS" ? "length" : "other",
        };
    },
};
```

`fake.ts`: a scripted queue of `{ text }` or `{ error }` (PaperTrail's `fakeLlm.push` API), defaulting
to `"{}"`. `replay.ts`: PaperTrail's cache-by-hash, storing the **text** result keyed by
`sha256(modelKey + JSON(request without signal))`. It powers free re-runs in tests and the CLI's
`--replay`.

### 6.4 `ai/complete.ts`

```ts
const providers: Record<ModelConfig["provider"], Provider> = {
    nvidia: createOpenAiCompatible(NVIDIA_BASE_URL),
    openai: createOpenAiCompatible("https://api.openai.com/v1"),
    anthropic: anthropicProvider,
    gemini: geminiProvider,
    fake: fakeProvider,
};
const serverKey = (p: ModelConfig["provider"]) =>
    ({ nvidia: NVIDIA_API_KEY, openai: OPENAI_API_KEY, anthropic: ANTHROPIC_API_KEY, gemini: GEMINI_API_KEY, fake: "fake" })[p];

export type CallOutcome = CompleteResult & { latencyMs: number; attempts: number; costUsdMicros: number };

/*
  One model call, exactly as the benchmark needs it: transient failures retried, the provider paced,
  a dead provider skipped fast — and the text returned untouched. `apiKey` overrides the server key
  only for bring-your-own-key demo runs (Phase 22); it is never stored or logged.
 */
export const complete = async (model: ModelConfig, request: Omit<CompleteRequest, "signal">, opts: { apiKey?: string; signal?: AbortSignal } = {}): Promise<CallOutcome> => {
    const apiKey = opts.apiKey ?? serverKey(model.provider);
    if (!apiKey) throw new ProviderNotConfigured(model.key);
    const provider = LLM_PROVIDER === "replay" ? replayProvider : providers[model.provider];
    let attempts = 0;
    let latencyMs = 0;

    const result = await breakerFor(model.key).execute(
        async () => {
            await assertRpmBudget(model.key);
            return withLease(model.key, () =>
                withRetry(async (signal) => {
                    attempts++;
                    const started = performance.now();
                    const out = await provider.complete(model, { ...request, signal }, apiKey);
                    latencyMs = Math.round(performance.now() - started);
                    return out;
                }, { attempts: LLM_ATTEMPTS, timeoutMs: LLM_TIMEOUT_MS, model: model.key, signal: opts.signal }));
        },
        async () => { throw new ProviderSkipped(model.key); }
    );
    return { ...result, latencyMs, attempts, costUsdMicros: costUsdMicros(model, result.usage) };
};
```

> Read PaperTrail's `breakers.ts` / `circuitBreaker.ts` once more: in the CLOSED state the breaker
> records the failure **and returns the fallback**, so the original error is replaced by
> `ProviderSkipped`. Capture the last error inside the operation if you want it in the result's
> `error` field (you do: Phase 16 stores it).

`MODEL_LIMITS` (`constants/llm.ts`) is built from the registry's `limits`, so `withLease` and
`assertRpmBudget` (copied, unchanged) read per-model numbers.

### 6.5 `scripts/try-model.ts`

`pnpm --filter api exec tsx src/scripts/try-model.ts <modelKey> "Say hi as JSON {\"hi\":true}"` prints
the text, usage, latency, attempts and cost. Run it once per registered model and write the results
into `providers.md` (works / auth error / model id wrong).

## 7. Verify

1. `try-model` on each of the 3 NVIDIA models → text plus non-zero tokens. On OpenAI/Anthropic/Gemini
   if keys are set; without a key → `ProviderNotConfigured`, and `GET /models` doesn't list them.
2. `try-model` with a bogus model id → no retries (4xx), `ProviderHttpError 404`.
3. Fake provider scripted to return 429 twice, then text → `attempts: 3`, success.
4. Fake 503 forever → after 5 calls the breaker opens; the 6th fails instantly with `ProviderSkipped`.
5. Two parallel scripts with a model limit of 1 → `ZCARD llm:leases:<key>` never exceeds 1.
6. The returned `text` for a reply wrapped in a code fence still **contains the fence** (nothing
   stripped here).
7. `diff -q` `reliability.ts`, `breakers.ts` and `concurrency.ts` against PaperTrail.

## 8. Definition of done

- [ ] Registry seeded with dated prices; models enabled by key presence.
- [ ] Four adapters plus fake/replay behind one `complete()` that returns raw text.
- [ ] The copied retry, breaker, lease and RPM pieces wrap every call; no fallback model.
- [ ] Commit: `feat(api): model registry and provider adapters`.

## 9. Interview angle

*"How do you call OpenAI, Claude and Gemini from one app?"* Small fetch adapters behind one
`complete()` contract, with no SDKs, so no hidden retries. The reliability layer I built for PaperTrail
wraps them: transient-only retries with jitter, a per-model concurrency lease in Redis, an RPM budget,
and a circuit breaker. Unlike PaperTrail there's no fallback model, because a benchmark cell must be
answered by the model it claims.
