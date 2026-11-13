import { toNimGuided, toOpenAiStrict } from "@repo/scoring";
import type { Provider } from "../types";
import { httpError } from "../errors";

// NVIDIA NIM and OpenAI share Chat Completions.
type ChatCompletion = {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export const createOpenAiCompatible = (baseUrl: string): Provider => ({
    async complete(model, req, apiKey) {
        const q = model.quirks ?? {};
        const body: Record<string, unknown> = {
            model: model.modelId,
            // No system message at all when the prompt has none (Phase 25's v0-vague), not an empty one.
            messages: [...(req.system ? [{ role: "system", content: req.system }] : []), ...req.messages],
            [q.maxTokensParam ?? "max_tokens"]: req.maxTokens,
            ...(q.noTemperature ? {} : { temperature: req.temperature }),
            ...q.extraBody,
        };
        if (req.structured) {
            if (model.provider === "nvidia") {
                body.nvext = { guided_json: toNimGuided(req.structured.schema) }; // providers.md §2; probed by probe-structured
            } else {
                body.response_format = {
                    type: "json_schema",
                    json_schema: { name: req.structured.name, strict: true, schema: toOpenAiStrict(req.structured.schema) },
                };
            }
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
