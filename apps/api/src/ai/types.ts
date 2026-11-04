import type { ModelConfig } from "../config/models.config";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type CompleteRequest = {
    system: string;
    messages: ChatMessage[];
    temperature: number;
    maxTokens: number;
    structured?: { name: string; schema: Record<string, unknown> }; // Phase 15 builds the per-provider schema
};
export type Usage = { inputTokens: number; outputTokens: number };
/** `text` is EXACTLY what the model returned: never parsed, trimmed or repaired here. */
export type CompleteResult = { text: string; usage: Usage; finishReason: "stop" | "length" | "other" };
export interface Provider {
    complete(model: ModelConfig, req: CompleteRequest & { signal: AbortSignal }, apiKey: string): Promise<CompleteResult>;
}
