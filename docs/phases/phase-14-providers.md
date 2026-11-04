# Phase 14 — Model registry and provider adapters

## 1. Goal

One function, `complete()`, that sends a rendered prompt to any registered model and returns **exactly
what the model said**, with tokens, latency, attempts and cost:
- a **model registry** (the global `models` table) seeded from `config/models.config.ts`: provider,
  model id, prices in micro-dollars per million tokens with `priceCheckedOn` and `priceNote`,
  structured-output support (`untested` until Phase 15's probe);
- **adapters** over plain `fetch`: `openaiCompatible` (NVIDIA NIM by default, and OpenAI),
  `anthropic`, `gemini`, plus `fake` and `replay` for tests;
- PaperTrail's reliability layer around every call: `withRetry` (408/429/5xx/timeouts only), the
  per-model concurrency lease, the RPM budget and the circuit breaker;
- error mapping that the results table can show honestly: **410 → `ModelRetired`** (the model is also
  deactivated), **401/403 → `ProviderAuthError`**, other 4xx → `ProviderHttpError`, never retried;
- a model is **enabled** only when its provider's key is set.

Read [../reference/providers.md](../reference/providers.md) first.

## 2. What I will understand after this phase

1. Why Prompt Lab returns raw text, unlike PaperTrail's `generateJson`.
2. Why there's **no fallback model**: a benchmark cell measures *this* model.
3. Why every adapter is plain `fetch` (no SDK retries hiding attempts).
4. How breaker → RPM budget → lease → retry compose around one call, and why client errors must not
   trip the breaker.
5. Why prices carry a date and a note, and are snapshotted per run.
6. What NVIDIA retiring its Llama 3.x endpoints (410, 26 Aug 2026) taught: model ids are data to check,
   not constants to trust.

## 3. Prerequisites

- Phase 13 done. Phases 06 and 08 provide `getDefaultStore()` (the limiter store, for the RPM budget)
  and `redisConnection` (the lease).
- An NVIDIA API key (`nvapi-…`). OpenAI / Anthropic / Gemini keys are optional.

## 4. Files

```
packages/types/src/model.ts                    NEW   (ModelDto, list response)
apps/api/
├── prisma/schema.prisma                       ADAPT (+ enums Provider, StructuredSupport; model Model)
├── prisma/migrations/<ts>_models/             NEW
└── src/
    ├── config/models.config.ts                NEW   (the registry seed + per-model limits and quirks)
    ├── constants/env.ts                       ADAPT (+ NVIDIA_API_KEY, NVIDIA_BASE_URL, OPENAI_*, ANTHROPIC_*, GEMINI_*, LLM_PROVIDER, REPLAY_DIR, FAKE_LLM_SCRIPT, FAKE_LLM_FIXTURES, MODELS_SEED)
    ├── constants/llm.ts                       ADAPT @pt-api/src/constants/llm.ts   (MODEL_LIMITS built from models.config.ts)
    ├── ai/types.ts                            ADAPT @pt-api/src/ai/types.ts        (complete() contract, raw text)
    ├── ai/errors.ts                           ADAPT @pt-api/src/ai/errors.ts       (drop SchemaViolation; + ProviderHttpError, ProviderAuthError, ModelRetired, ProviderNotConfigured)
    ├── ai/reliability.ts (+ .test.ts)         COPY  @pt-api/src/ai/reliability.ts, reliability.test.ts
    ├── ai/breakers.ts                         COPY  @pt-api/src/ai/breakers.ts
    ├── ai/concurrency.ts                      COPY  @pt-api/src/ai/concurrency.ts
    ├── ai/providers/openaiCompatible.ts       ADAPT @pt-api/src/ai/providers/nvidia.ts   (raw text; base URL + key per provider)
    ├── ai/providers/anthropic.ts              NEW
    ├── ai/providers/gemini.ts                 NEW
    ├── ai/providers/fake.ts                   ADAPT @pt-api/src/ai/providers/fake.ts     (scripted TEXT, not JSON)
    ├── ai/providers/replay.ts                 ADAPT @pt-api/src/ai/providers/replay.ts   (records TEXT; key includes the system prompt)
    ├── ai/complete.ts                         NEW   (registry → breaker → RPM → lease → withRetry → adapter)
    ├── utils/cost.ts                          ADAPT @pt-api/src/utils/cost.ts          (price from the model row, not a constant)
    ├── utils/scrubSecrets.ts                  COPY  @pb-root/apps/api/src/utils/scrubSecrets.ts
    ├── services/model.service.ts              NEW   (seed upsert, list enabled, markRetired)
    ├── controllers/model.controller.ts · routes/model.route.ts   NEW   (GET /models)
    └── scripts/{seed-models,try-model,list-nvidia-models}.ts     NEW
```

`@pt-api/src/constants/pricing.ts` is **not** copied: prices live in the `models` table.
`@pt-api/src/ai/{llm,cascade,modelJson}.ts` are not copied either: no fallback chain, no repair
(inherited-architecture.md, "Deliberately not copied").

## 5. Concepts

**Raw text, always.** PaperTrail's `generateJson` asks for JSON, repairs it (`parseModelJson`) and
validates it, because it needs a usable answer. Prompt Lab needs the opposite: the **exact** text,
because "this prompt breaks JSON 9 % of the time on model X" is a result. `complete()` never parses.
Scoring (Phase 16) does, with rules decided beforehand.

**No fallback.** PaperTrail falls back to another model so a document still gets processed. A cell for
*model A* answered by *model B* is a lie in the results table. When a provider is down:
1. the call retries transient errors (`withRetry`, copied);
2. after repeated **health** failures the breaker opens, and further calls fail fast with
   `ProviderSkipped` instead of each waiting out 3 × 45 s;
3. the cell job backs off and retries later (Phase 17);
4. after its attempts it's an **error cell**: shown, counted, excluded from accuracy.

**Client errors don't trip the breaker.** The copied `RedisCircuitBreaker.execute(op, fallback)`
records a failure for *any* throw and then returns the fallback, so the original error would be
replaced by `ProviderSkipped`. Two consequences, both handled in `complete.ts`:
- non-health errors (400/401/403/404/410) are **returned** from the operation as a value, so the
  breaker records a success and `complete()` rethrows them afterwards. A wrong key must not open the
  breaker for everyone else;
- the last real error is captured, so an open breaker's `ProviderSkipped` carries it as `cause`.

**Composition, per call** (copied pieces in bold):

```
**breakerFor(key)** → **assertRpmBudget(key)** → **withLease(key)** → **withRetry**(adapter.complete, LLM_ATTEMPTS, LLM_TIMEOUT_MS)
```

Lease and RPM keys are the registry `key` (`nvidia:openai/gpt-oss-20b`), so models get separate
budgets. A provider-wide lease (`provider:nvidia`) is added when a provider limits concurrency across
models. BullMQ ids elsewhere use `-`, but Redis keys can keep `:`.

**Plain fetch.** Official SDKs retry by themselves (OpenAI's retries twice by default). That would
hide attempts under `withRetry`, inflate latency, and break "one recorded call = one model answer".
Each adapter is about 60 lines.

**Latency** is measured around the **successful attempt** (`performance.now()`), not including
backoff. p95 should describe the model, not your retry policy. Retries are counted in `attempts`.

**Prices with dates.** `inputUsdMicrosPerMTok` / `outputUsdMicrosPerMTok` are integers (USD per
million tokens × 1e6), with `priceCheckedOn` and `priceNote`. NVIDIA's hosted tier is free on
credits, so for "$ / 100 inputs" to mean anything, NVIDIA rows record a reference host's published
price for the same open model, and `priceNote` says so (providers.md §6). Phase 17 snapshots the prices
into `Run.pricesSnapshot`, so a later price edit doesn't rewrite history.

**Model ids are data.** NVIDIA retired `meta/llama-3.3-70b-instruct` and `meta/llama-3.1-8b-instruct`
on 26 Aug 2026: calls answer **410 Gone**. The Playbook build found this the hard way. So:
- `list-nvidia-models.ts` prints the live `GET /v1/models` list;
- `try-model.ts` makes one real call per registered model;
- a 410 at runtime throws `ModelRetired` **and** sets `Model.active = false`, so the run launcher
  stops offering it.

Verified working on 2 Nov 2026 (Playbook Try-it): `nvidia/nemotron-3-super-120b-a12b`,
`openai/gpt-oss-20b`. Choose a third NVIDIA family with the probe. Served NVIDIA models answer a bad
key with **403**, not 401, so both map to `ProviderAuthError`.

**Model quirks live in config, not code.** Some models need request tweaks: OpenAI reasoning models
take `max_completion_tokens` and reject a non-default `temperature`; Nemotron/gpt-oss "think" first;
Gemini 2.5+ counts thinking tokens separately. `models.config.ts` carries `quirks` per model
(`noTemperature`, `maxTokensParam`, `extraBody` such as `chat_template_kwargs`). Benchmarks keep the
model's default behaviour unless a quirk is recorded, because it's part of what's being compared
(providers.md §2).

## 6. Steps

### 6.1 Registry seed (`config/models.config.ts`)

```ts
export type ModelConfig = {
    key: string;                                    // "<provider>:<modelId>" — what results and exports show
    provider: "nvidia" | "openai" | "anthropic" | "gemini" | "fake";
    modelId: string;
    label: string;
    contextTokens?: number;
    price: { inputPerMTokUsd: number; outputPerMTokUsd: number; checkedOn: string; note?: string };
    limits: { concurrency: number; rpm: number };
    quirks?: { noTemperature?: boolean; maxTokensParam?: "max_tokens" | "max_completion_tokens"; extraBody?: Record<string, unknown> };
};

// Fill on the day you build this phase: ids from list-nvidia-models / each provider's model page,
// prices from their pricing page (NVIDIA rows: a reference host's price, said in `note`), dates = today.
export const MODELS: ModelConfig[] = [
    {
        key: "nvidia:openai/gpt-oss-20b", provider: "nvidia", modelId: "openai/gpt-oss-20b", label: "gpt-oss 20B (NIM)",
        price: { inputPerMTokUsd: 0, outputPerMTokUsd: 0, checkedOn: "YYYY-MM-DD", note: "reference host price — fill in" },
        limits: { concurrency: 4, rpm: 40 },
    },
    {
        key: "nvidia:nvidia/nemotron-3-super-120b-a12b", provider: "nvidia", modelId: "nvidia/nemotron-3-super-120b-a12b",
        label: "Nemotron 3 Super (NIM)",
        price: { inputPerMTokUsd: 0, outputPerMTokUsd: 0, checkedOn: "YYYY-MM-DD", note: "reference host price — fill in" },
        limits: { concurrency: 4, rpm: 40 },
    },
    // + a third NVIDIA family accepted by the probe (a Qwen or Mistral instruct)
    // + one cheap OpenAI, one Anthropic (e.g. claude-haiku-5-5), one Gemini model — enabled only with their key
    {
        key: "fake:text", provider: "fake", modelId: "fake", label: "Fake (tests)",
        price: { inputPerMTokUsd: 1, outputPerMTokUsd: 5, checkedOn: "2026-11-03", note: "test only" },
        limits: { concurrency: 50, rpm: 100_000 },
    },
];
```

`seed-models.ts` upserts each row into `models` by `key`: provider, modelId, label, contextTokens,
`inputUsdMicrosPerMTok = Math.round(inputPerMTokUsd * 1e6)` and likewise output, `priceCheckedOn`,
`priceNote`. It **never** changes `structured`/`structuredProbedAt` (Phase 15 owns them) or re-activates
a row marked retired. `Model` is not a tenant model: the registry is configuration.

`constants/llm.ts` (ADAPT): keep PaperTrail's `LLM_TIMEOUT_MS`, `LLM_ATTEMPTS`, `MAX_BACKOFF_MS`,
`DEFAULT_MODEL_LIMIT`, `LEASE_TTL_MS`, `LEASE_WAIT_MS`, `BREAKER`; replace the hard-coded
`MODEL_LIMITS` with `Object.fromEntries(MODELS.map((m) => [m.key, m.limits]))`. The copied
`concurrency.ts` reads it unchanged.

### 6.2 Contract (`ai/types.ts`, ADAPT)

```ts
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type CompleteRequest = {
    system: string;
    messages: ChatMessage[];
    temperature: number;
    maxTokens: number;
    structured?: { name: string; schema: Record<string, unknown> };   // Phase 15 builds the per-provider schema
};
export type Usage = { inputTokens: number; outputTokens: number };
export type CompleteResult = { text: string; usage: Usage; finishReason: "stop" | "length" | "other" };
export interface Provider {
    complete(model: ModelConfig, req: CompleteRequest & { signal: AbortSignal }, apiKey: string): Promise<CompleteResult>;
}
```

### 6.3 Errors (`ai/errors.ts`, ADAPT)

Keep `ProviderTimeout`, `ProviderBusy`, `ProviderSkipped`, `BudgetExceeded` exactly. Remove
`SchemaViolation` and `ProviderUnavailable`. Add:

```ts
/** Carries the HTTP status so the copied isRetryable can read it. Body scrubbed of anything key-shaped. */
export class ProviderHttpError extends Error {
    readonly name = "ProviderHttpError";
    constructor(readonly model: string, readonly status: number, body: string) {
        super(`${model} answered ${status}: ${scrubSecrets(body).slice(0, 500)}`);
    }
}
export class ProviderAuthError extends ProviderHttpError {}     // 401 / 403
export class ModelRetired extends ProviderHttpError {}          // 410
export class ProviderNotConfigured extends Error {
    readonly name = "ProviderNotConfigured";
    constructor(readonly model: string) { super(`No API key configured for ${model}`); }
}

export const httpError = (model: string, status: number, body: string) =>
    status === 410 ? new ModelRetired(model, status, body)
    : status === 401 || status === 403 ? new ProviderAuthError(model, status, body)
    : new ProviderHttpError(model, status, body);

/** Errors that say nothing about the provider's health: never count them against the breaker. */
export const isClientError = (e: unknown) =>
    e instanceof ProviderHttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
```

### 6.4 Adapters

```ts
// ai/providers/openaiCompatible.ts — NVIDIA NIM and OpenAI share Chat Completions.
type ChatCompletion = {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export const createOpenAiCompatible = (baseUrl: string): Provider => ({
    async complete(model, req, apiKey) {
        const q = model.quirks ?? {};
        const body: Record<string, unknown> = {
            model: model.modelId,
            messages: [{ role: "system", content: req.system }, ...req.messages],
            [q.maxTokensParam ?? "max_tokens"]: req.maxTokens,
            ...(q.noTemperature ? {} : { temperature: req.temperature }),
            ...q.extraBody,
        };
        if (req.structured) {
            body[model.provider === "nvidia" ? "nvext" : "response_format"] =
                model.provider === "nvidia"
                    ? { guided_json: req.structured.schema }                     // providers.md §2; probed in Phase 15
                    : { type: "json_schema", json_schema: { name: req.structured.name, strict: true, schema: req.structured.schema } };
        }
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: req.signal,
        });
        if (!res.ok) throw httpError(model.key, res.status, await res.text());
        const json = (await res.json()) as ChatCompletion;
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
// ai/providers/anthropic.ts — Messages API (checked 3 Nov 2026: output_config.format = { type: "json_schema", schema })
export const anthropicProvider: Provider = {
    async complete(model, req, apiKey) {
        const body: Record<string, unknown> = {
            model: model.modelId, system: req.system, messages: req.messages,
            max_tokens: req.maxTokens, temperature: req.temperature,
        };
        if (req.structured) body.output_config = { format: { type: "json_schema", schema: req.structured.schema } };
        const res = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify(body), signal: req.signal,
        });
        if (!res.ok) throw httpError(model.key, res.status, await res.text());
        const json = (await res.json()) as {
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
// ai/providers/gemini.ts — generateContent (checked 3 Nov 2026: responseMimeType + responseJsonSchema for JSON Schema)
export const geminiProvider: Provider = {
    async complete(model, req, apiKey) {
        const generationConfig: Record<string, unknown> = { temperature: req.temperature, maxOutputTokens: req.maxTokens };
        if (req.structured) {
            generationConfig.responseMimeType = "application/json";
            generationConfig.responseJsonSchema = req.structured.schema;     // Phase 15 strips unsupported keywords
        }
        const res = await fetch(
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
        if (!res.ok) throw httpError(model.key, res.status, await res.text());
        const json = (await res.json()) as {
            candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        };
        const c = json.candidates?.[0];
        const u = json.usageMetadata;
        return {
            text: (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join(""),
            // Thinking tokens are billed as output: count them, or cost per 100 is understated.
            usage: { inputTokens: u?.promptTokenCount ?? 0, outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0) },
            finishReason: c?.finishReason === "STOP" ? "stop" : c?.finishReason === "MAX_TOKENS" ? "length" : "other",
        };
    },
};
```

> Provider request shapes change. Before building, re-check each against its current reference with
> Context7 and update the dates in providers.md. If Gemini's docs show only `responseSchema`
> (OpenAPI subset) for your model, use that and note it.

`fake.ts` (ADAPT): keep PaperTrail's `fakeLlm.push/reset/calls` test API, but the queue holds
`{ kind: "text"; text: string } | { kind: "error"; error: Error }` and the default answer is `"{}"`.
Usage stays `{ inputTokens: 1000, outputTokens: 200 }`. Test helpers: `fakeLlm.push(...)`,
`fakeLlm.alwaysReturn(text)` (every call answers `text`), and scripted failures (`{ kind: "error",
error: new ProviderHttpError(429 | 400, …) }`). `FAKE_LLM_SCRIPT=<name>` loads a named script from
`src/ai/providers/fakeScripts/` (e.g. `judge-mixed`, `rate-limited`) for processes the test can't
reach in-process; `FAKE_LLM_FIXTURES=<dir>` answers from recorded files keyed like `replay` (E2E). `replay.ts` (ADAPT): same file layout under
`REPLAY_DIR`, storing `{ text, usage, finishReason }`, keyed by
`sha256(model.key + JSON.stringify({ system, messages, temperature, maxTokens, structured }))`. The
system prompt is part of the key (PaperTrail's key isn't, and the Enquiry plan found why that matters).
`recordOnMiss` records real answers for CI fixtures (Phase 29).

### 6.5 `ai/complete.ts`

```ts
const adapters: Record<ModelConfig["provider"], Provider> = {
    nvidia: createOpenAiCompatible(NVIDIA_BASE_URL),
    openai: createOpenAiCompatible("https://api.openai.com/v1"),
    anthropic: anthropicProvider,
    gemini: geminiProvider,
    fake: fakeProvider,
};
const serverKey = (p: ModelConfig["provider"]) =>
    ({ nvidia: NVIDIA_API_KEY, openai: OPENAI_API_KEY, anthropic: ANTHROPIC_API_KEY, gemini: GEMINI_API_KEY, fake: "fake" })[p];

export const isEnabled = (m: ModelConfig) => Boolean(serverKey(m.provider));

export type CallOutcome = CompleteResult & { latencyMs: number; attempts: number; costUsdMicros: number };
export type Price = { inputUsdMicrosPerMTok: number; outputUsdMicrosPerMTok: number };
/** Today's registry price (scripts, the probe). Runs never use it: they pass the run's price snapshot. */
export const priceOf = (m: Price): Price => ({ inputUsdMicrosPerMTok: m.inputUsdMicrosPerMTok, outputUsdMicrosPerMTok: m.outputUsdMicrosPerMTok });

/*
  One model call as a benchmark needs it: transient failures retried, the model paced, a dead provider
  skipped fast — and the text returned untouched. `apiKey` overrides the server key only for the
  bring-your-own-key demo (Phase 23); it is never stored or logged.
 */
export const complete = async (
    model: ModelConfig, price: Price, req: CompleteRequest,
    opts: { apiKey?: string; signal?: AbortSignal } = {}
): Promise<CallOutcome> => {
    const apiKey = opts.apiKey ?? serverKey(model.provider);
    if (!apiKey) throw new ProviderNotConfigured(model.key);
    const adapter = LLM_PROVIDER === "replay" ? replayProvider : adapters[model.provider];
    let attempts = 0;
    let latencyMs = 0;
    let lastError: unknown;

    const outcome = await breakerFor(model.key).execute(
        async () => {
            await assertRpmBudget(model.key);
            try {
                const result = await withLease(model.key, () =>
                    withRetry(async (signal) => {
                        attempts++;
                        const started = performance.now();
                        const out = await adapter.complete(model, { ...req, signal }, apiKey);
                        latencyMs = Math.round(performance.now() - started);
                        return out;
                    }, { attempts: LLM_ATTEMPTS, timeoutMs: LLM_TIMEOUT_MS, model: model.key, signal: opts.signal })
                );
                return { ok: true as const, result };
            } catch (error) {
                lastError = error;
                if (isClientError(error)) return { ok: false as const, error };   // not a health failure
                throw error;                                                      // counts against the breaker
            }
        },
        async () => { throw new ProviderSkipped(model.key, { cause: lastError }); }
    );
    if (!outcome.ok) {
        if (outcome.error instanceof ModelRetired) await markRetired(model.key);   // launcher stops offering it
        throw outcome.error;
    }
    return { ...outcome.result, latencyMs, attempts, costUsdMicros: costUsdMicros(price, outcome.result.usage) };
};
```

`ProviderSkipped` gains an optional `ErrorOptions` argument (a one-line ADAPT in `errors.ts`).
`ProviderBusy` from the lease or RPM budget is thrown inside the operation and **does** count for the
breaker in PaperTrail. Keep that: a provider permanently at its limit is unhealthy for this run.

`utils/cost.ts` (ADAPT):

```ts
// $/1M tokens × 1e6 = micro-dollars per token × 1e6 → divide by 1e6 once.
export const costUsdMicros = (price: Price, usage: Usage): number =>
    Math.round((usage.inputTokens * price.inputUsdMicrosPerMTok + usage.outputTokens * price.outputUsdMicrosPerMTok) / 1_000_000);
```

### 6.6 Routes and scripts

- `GET /models` (`authenticate`): active, enabled models with `key`, `label`, `provider`, prices,
  `priceCheckedOn`, `priceNote`, `structured`. The UI prints the date next to every price.
- `pnpm --filter api db:seed-models` (script `tsx src/scripts/seed-models.ts`): upsert the registry.
  `MODELS_SEED=test` seeds only the `fake:*` rows (integration and E2E tests).
- `pnpm --filter api exec tsx src/scripts/list-nvidia-models.ts`: `GET $NVIDIA_BASE_URL/models`,
  prints ids, marks which registry rows are missing from it.
- `pnpm --filter api exec tsx src/scripts/try-model.ts <key> 'Reply with {"hi":true}'`: prints the
  text (verbatim), usage, latency, attempts and cost. Run it once per registered model and record the
  outcome (works / auth / retired / wrong id) in `providers.md`'s table with the date.

## 7. Verify

1. `db:seed-models` twice → rows created, then "unchanged"; `GET /models` lists only providers whose key
   is set (plus `fake` in development).
2. `try-model` on each NVIDIA row → text plus non-zero tokens and a cost that matches the formula by hand.
3. `try-model nvidia:meta/llama-3.3-70b-instruct` (add it temporarily) → one attempt, `ModelRetired`
   (410), and `SELECT active FROM models WHERE key = …` → `false`.
4. A bad NVIDIA key → `ProviderAuthError` (403), `attempts: 1`; repeat 10 times → the breaker stays
   CLOSED (`breakerStates()`), because client errors aren't health failures.
5. Fake scripted 429, 429, text → `attempts: 3`, success, `latencyMs` close to the last call's duration
   (not including backoff).
6. Fake 503 forever → after `BREAKER.failureThreshold` calls the breaker opens; the next call fails
   instantly with `ProviderSkipped` whose `cause` is the 503.
7. Two parallel scripts with a model limit of 1 → `ZCARD llm:leases:<key>` never exceeds 1.
8. A reply wrapped in a ```json fence comes back **with the fence** (nothing stripped here).
9. `LLM_PROVIDER=replay` with `recordOnMiss` → second identical call reads the file; changing only the
   system prompt → a miss.
10. `diff` `reliability.ts`, `reliability.test.ts`, `breakers.ts`, `concurrency.ts`, `scrubSecrets.ts`
    against their sources → identical.

## 8. Definition of done

- [ ] `models` table seeded with dated, noted prices; models enabled by key presence; retired models
      deactivated automatically.
- [ ] `openaiCompatible`, `anthropic`, `gemini`, `fake`, `replay` behind one `complete()` that returns
      raw text.
- [ ] Copied retry, breaker, lease and RPM budget wrap every call; client errors never trip the
      breaker; no fallback model.
- [ ] 410 / 401 / 403 mapped; error bodies scrubbed.
- [ ] `try-model` results recorded in providers.md with the date.
- [ ] Commit: `feat(api): model registry and provider adapters`.

## 9. Interview angle

*"How do you call OpenAI, Claude, Gemini and NVIDIA from one app?"* Small `fetch` adapters behind one
`complete()` contract, with no SDKs and therefore no hidden retries. The reliability layer from my
PaperTrail project wraps them: transient-only retries with jitter, a per-model concurrency lease in
Redis, an RPM budget, and a circuit breaker that ignores client errors. Unlike PaperTrail there's no
fallback model, because a benchmark cell must be answered by the model it names. And model ids are
treated as data: when NVIDIA retired a model, the 410 deactivated it instead of silently failing a run.
