/*
  The model registry seed (Phase 14). Model ids are DATA to check, not constants to trust: NVIDIA
  retired its Llama 3.x endpoints on 26 Aug 2026 (410). Run `list-nvidia-models` and `try-model`
  before relying on a row, and update `checkedOn`.

  Prices are USD per million tokens. NVIDIA's hosted tier is free on credits, so NVIDIA rows record the
  published price of the same open model at a reference host, and say so in `note` (providers.md §6).
  The numbers below come from price aggregators (pricepertoken.com, anotherwrapper.com), checked
  4 Nov 2026, NOT from a provider page: re-check against the host's own pricing page before any
  reported run. Runs snapshot these prices, so a later edit never rewrites history.
 */
export type ModelConfig = {
    key: string; // "<provider>:<modelId>": what results and exports show
    provider: "nvidia" | "openai" | "anthropic" | "gemini" | "fake";
    modelId: string;
    label: string;
    contextTokens?: number;
    price: { inputPerMTokUsd: number; outputPerMTokUsd: number; checkedOn: string; note?: string };
    limits: { concurrency: number; rpm: number };
    quirks?: {
        noTemperature?: boolean;
        maxTokensParam?: "max_tokens" | "max_completion_tokens";
        extraBody?: Record<string, unknown>;
    };
};

export const MODELS: ModelConfig[] = [
    {
        key: "nvidia:openai/gpt-oss-20b",
        provider: "nvidia",
        modelId: "openai/gpt-oss-20b",
        label: "gpt-oss 20B (NIM)",
        contextTokens: 131_072,
        price: {
            inputPerMTokUsd: 0.05,
            outputPerMTokUsd: 0.2,
            checkedOn: "2026-11-04",
            note: "reference price: OpenAI list price for the same open model, via anotherwrapper.com; NVIDIA free tier costs $0. Verify before reporting.",
        },
        limits: { concurrency: 4, rpm: 40 },
    },
    {
        key: "nvidia:nvidia/nemotron-3-super-120b-a12b",
        provider: "nvidia",
        modelId: "nvidia/nemotron-3-super-120b-a12b",
        label: "Nemotron 3 Super 120B (NIM)",
        price: {
            inputPerMTokUsd: 0.09,
            outputPerMTokUsd: 0.45,
            checkedOn: "2026-11-04",
            note: "reference price: OpenRouter, via anotherwrapper.com; NVIDIA free tier costs $0. Verify before reporting.",
        },
        limits: { concurrency: 4, rpm: 40 },
    },
    // A third NVIDIA family (a Qwen or Mistral instruct) is added once the probe accepts one:
    //   pnpm --filter api exec tsx src/scripts/list-nvidia-models.ts   (needs NVIDIA_API_KEY)
    // Optional providers: enabled only when their key is set. Add a row per model you want to compare.
    {
        key: "fake:text",
        provider: "fake",
        modelId: "fake",
        label: "Fake (tests)",
        price: { inputPerMTokUsd: 1, outputPerMTokUsd: 5, checkedOn: "2026-11-04", note: "test only" },
        limits: { concurrency: 50, rpm: 100_000 },
    },
];

export const modelConfigByKey = (key: string): ModelConfig | undefined => MODELS.find((m) => m.key === key);
