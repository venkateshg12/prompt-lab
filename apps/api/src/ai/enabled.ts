import type { ModelConfig } from "../config/models.config";
import { ANTHROPIC_API_KEY, GEMINI_API_KEY, NVIDIA_API_KEY, OPENAI_API_KEY } from "../constants/env";

export const serverKey = (provider: ModelConfig["provider"]): string =>
    ({ nvidia: NVIDIA_API_KEY, openai: OPENAI_API_KEY, anthropic: ANTHROPIC_API_KEY, gemini: GEMINI_API_KEY, fake: "fake" })[provider];

/** A model is enabled only when its provider's key is set on the server. */
export const isEnabled = (m: Pick<ModelConfig, "provider">) => Boolean(serverKey(m.provider));
