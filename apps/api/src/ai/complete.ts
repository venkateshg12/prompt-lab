import type { ModelConfig } from "../config/models.config";
import type { CompleteRequest, CompleteResult, Provider } from "./types";
import { LLM_ATTEMPTS, LLM_TIMEOUT_MS } from "../constants/llm";
import { LLM_PROVIDER, NVIDIA_BASE_URL } from "../constants/env";
import { breakerFor } from "./breakers";
import { assertRpmBudget, withLease } from "./concurrency";
import { withRetry } from "./reliability";
import { ModelRetired, ProviderBusy, ProviderNotConfigured, ProviderSkipped, isClientError } from "./errors";
import { createOpenAiCompatible } from "./providers/openaiCompatible";
import { anthropicProvider } from "./providers/anthropic";
import { geminiProvider } from "./providers/gemini";
import { fakeProvider } from "./providers/fake";
import { replayProvider } from "./providers/replay";
import { serverKey } from "./enabled";
import { markRetired } from "../services/model.service";
import { costUsdMicros, type Price } from "../utils/cost";

const adapters: Record<ModelConfig["provider"], Provider> = {
    nvidia: createOpenAiCompatible(NVIDIA_BASE_URL),
    openai: createOpenAiCompatible("https://api.openai.com/v1"),
    anthropic: anthropicProvider,
    gemini: geminiProvider,
    fake: fakeProvider,
};

export type CallOutcome = CompleteResult & { latencyMs: number; attempts: number; costUsdMicros: number };

/** Today's registry price (scripts, the probe). Runs never use it: they pass the run's price snapshot. */
export const priceOf = (m: Price): Price => ({
    inputUsdMicrosPerMTok: m.inputUsdMicrosPerMTok,
    outputUsdMicrosPerMTok: m.outputUsdMicrosPerMTok,
});

/*
  One model call as a benchmark needs it: transient failures retried, the model paced, a dead provider
  skipped fast — and the text returned untouched. There is no fallback model: a cell for model A must
  be answered by model A. `apiKey` overrides the server key only for the bring-your-own-key demo
  (Phase 23); it is never stored or logged.
 */
export const complete = async (
    model: ModelConfig,
    price: Price,
    req: CompleteRequest,
    opts: { apiKey?: string; signal?: AbortSignal; adapter?: Provider } = {}
): Promise<CallOutcome> => {
    const apiKey = opts.apiKey ?? serverKey(model.provider);
    if (!apiKey) throw new ProviderNotConfigured(model.key);
    const adapter = opts.adapter ?? (LLM_PROVIDER === "replay" ? replayProvider : adapters[model.provider]);
    let attempts = 0;
    let latencyMs = 0;
    let lastError: unknown;

    // The RPM budget is checked BEFORE the breaker: a full per-minute budget is the normal state of a big
    // benchmark run, not a sign the provider is unhealthy, so it must never count as a breaker failure.
    await assertRpmBudget(model.key);

    const outcome = await breakerFor(model.key).execute(
        async () => {
            try {
                const result = await withLease(model.key, () =>
                    withRetry(
                        async (signal) => {
                            attempts++;
                            const started = performance.now();
                            const out = await adapter.complete(model, { ...req, signal }, apiKey);
                            // Measured around the successful attempt: p95 describes the model, not the retry policy.
                            latencyMs = Math.round(performance.now() - started);
                            return out;
                        },
                        { attempts: LLM_ATTEMPTS, timeoutMs: LLM_TIMEOUT_MS, model: model.key, signal: opts.signal }
                    )
                );
                return { ok: true as const, result };
            } catch (error) {
                lastError = error;
                // A wrong key or a retired id says nothing about the provider's health, and neither does
                // waiting for a free concurrency lease: return it as a value so the breaker records a
                // success, and rethrow it below. (PaperTrail counts ProviderBusy; a benchmark must not.)
                if (isClientError(error) || error instanceof ProviderBusy) return { ok: false as const, error };
                throw error; // counts against the breaker
            }
        },
        async () => {
            throw new ProviderSkipped(model.key, { cause: lastError });
        }
    );
    if (!outcome.ok) {
        if (outcome.error instanceof ModelRetired) await markRetired(model.key);
        throw outcome.error;
    }
    return { ...outcome.result, latencyMs, attempts, costUsdMicros: costUsdMicros(price, outcome.result.usage) };
};
