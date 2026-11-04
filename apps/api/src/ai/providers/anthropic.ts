import type { Provider } from "../types";
import { httpError } from "../errors";
import { ANTHROPIC_BASE_URL } from "../../constants/env";

// Messages API (checked 3 Nov 2026: output_config.format = { type: "json_schema", schema }).

export const anthropicProvider: Provider = {
    async complete(model, req, apiKey) {
        const body: Record<string, unknown> = {
            model: model.modelId,
            system: req.system,
            messages: req.messages,
            max_tokens: req.maxTokens,
            temperature: req.temperature,
        };
        if (req.structured) body.output_config = { format: { type: "json_schema", schema: req.structured.schema } };
        const res = await fetch(`${ANTHROPIC_BASE_URL}/v1/messages`, {
            method: "POST",
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
            body: JSON.stringify(body),
            signal: req.signal,
        });
        if (!res.ok) throw httpError(model.key, res.status, await res.text());
        const json = (await res.json()) as {
            content?: { type: string; text?: string }[];
            stop_reason?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
        };
        return {
            text: (json.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(""),
            usage: { inputTokens: json.usage?.input_tokens ?? 0, outputTokens: json.usage?.output_tokens ?? 0 },
            finishReason: json.stop_reason === "end_turn" ? "stop" : json.stop_reason === "max_tokens" ? "length" : "other",
        };
    },
};
