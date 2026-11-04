import type { Usage } from "../ai/types";

export type Price = { inputUsdMicrosPerMTok: number; outputUsdMicrosPerMTok: number };

// $/1M tokens × 1e6 (= micro-dollars per million tokens) × tokens ÷ 1e6 = micro-dollars. Integers only.
export const costUsdMicros = (price: Price, usage: Usage): number =>
    Math.round((usage.inputTokens * price.inputUsdMicrosPerMTok + usage.outputTokens * price.outputUsdMicrosPerMTok) / 1_000_000);
