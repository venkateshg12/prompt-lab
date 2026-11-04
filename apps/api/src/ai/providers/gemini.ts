import type { Provider } from "../types";
import { httpError } from "../errors";
import { GEMINI_BASE_URL } from "../../constants/env";

// generateContent (checked 3 Nov 2026: responseMimeType + responseJsonSchema for JSON Schema).

export const geminiProvider: Provider = {
    async complete(model, req, apiKey) {
        const generationConfig: Record<string, unknown> = { temperature: req.temperature, maxOutputTokens: req.maxTokens };
        if (req.structured) {
            generationConfig.responseMimeType = "application/json";
            generationConfig.responseJsonSchema = req.structured.schema; // Phase 15 strips unsupported keywords
        }
        const res = await fetch(`${GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(model.modelId)}:generateContent`, {
            method: "POST",
            headers: { "x-goog-api-key": apiKey, "content-type": "application/json" },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: req.system }] },
                contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
                generationConfig,
            }),
            signal: req.signal,
        });
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
