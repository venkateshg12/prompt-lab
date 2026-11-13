import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiCompatible } from "./openaiCompatible";
import { anthropicProvider } from "./anthropic";
import { geminiProvider } from "./gemini";
import { ModelRetired, ProviderAuthError, ProviderHttpError } from "../errors";
import type { ModelConfig } from "../../config/models.config";
import type { Provider } from "../types";

/* Every adapter against three recorded-shape responses, with fetch stubbed: no network in unit tests. */
const fixture = (provider: string, name: string) =>
    JSON.parse(readFileSync(path.join(__dirname, "__fixtures__", provider, `${name}.json`), "utf8")) as { status: number; body: unknown };

const sent: { url: string; init: RequestInit }[] = [];
const serve = (provider: string, name: string) => {
    const f = fixture(provider, name);
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, init });
        return new Response(JSON.stringify(f.body), { status: f.status, headers: { "content-type": "application/json" } });
    }));
};
afterEach(() => {
    vi.unstubAllGlobals();
    sent.length = 0;
});

const model = (provider: ModelConfig["provider"], modelId: string): ModelConfig => ({
    key: `${provider}:${modelId}`, provider, modelId, label: modelId,
    price: { inputPerMTokUsd: 1, outputPerMTokUsd: 1, checkedOn: "2026-11-04" }, limits: { concurrency: 1, rpm: 1 },
});
const schema = { type: "object", properties: { title: { type: ["string", "null"] } }, required: ["title"], additionalProperties: false };
const req = { system: "sys", messages: [{ role: "user" as const, content: "hello" }], temperature: 0, maxTokens: 800, structured: { name: "answer", schema } };

const cases: { provider: string; adapter: Provider; m: ModelConfig; url: RegExp; auth: [string, string]; structuredPath: (b: Record<string, any>) => unknown; usage: { inputTokens: number; outputTokens: number }; errorType: unknown }[] = [
    { provider: "nvidia", adapter: createOpenAiCompatible("https://nim.test/v1"), m: model("nvidia", "openai/gpt-oss-20b"), url: /\/chat\/completions$/, auth: ["Authorization", "Bearer k"], structuredPath: (b) => b.nvext?.guided_json, usage: { inputTokens: 812, outputTokens: 64 }, errorType: ProviderAuthError },
    { provider: "openai", adapter: createOpenAiCompatible("https://openai.test/v1"), m: model("openai", "gpt-5-mini"), url: /\/chat\/completions$/, auth: ["Authorization", "Bearer k"], structuredPath: (b) => b.response_format?.json_schema?.strict, usage: { inputTokens: 700, outputTokens: 40 }, errorType: ProviderHttpError },
    { provider: "anthropic", adapter: anthropicProvider, m: model("anthropic", "claude-haiku-5-5"), url: /\/v1\/messages$/, auth: ["x-api-key", "k"], structuredPath: (b) => b.output_config?.format?.type, usage: { inputTokens: 650, outputTokens: 38 }, errorType: ProviderAuthError },
    // Gemini bills thinking tokens as output: 30 + 120.
    { provider: "gemini", adapter: geminiProvider, m: model("gemini", "gemini-3-flash"), url: /:generateContent$/, auth: ["x-goog-api-key", "k"], structuredPath: (b) => b.generationConfig?.responseFormat?.text?.mimeType, usage: { inputTokens: 600, outputTokens: 150 }, errorType: ModelRetired },
];

describe.each(cases)("$provider adapter (recorded responses)", ({ provider, adapter, m, url, auth, structuredPath, usage, errorType }) => {
    it("sends the documented request (auth header, structured-output field) and returns raw text + usage", async () => {
        serve(provider, "ok");
        const out = await adapter.complete(m, req, "k");
        expect(out).toEqual({ text: '{"title": "Engineer"}', usage, finishReason: "stop" }); // byte for byte: nothing reformatted
        const { url: u, init } = sent[0]!;
        expect(u).toMatch(url);
        expect((init.headers as Record<string, string>)[auth[0]]).toBe(auth[1]);
        expect(structuredPath(JSON.parse(String(init.body)))).toBeTruthy();
    });
    it("reports a token-limit stop as finishReason length, and never completes the cut-off JSON", async () => {
        serve(provider, "length");
        const out = await adapter.complete(m, req, "k");
        expect(out.finishReason).toBe("length");
        expect(() => JSON.parse(out.text)).toThrow();
    });
    it("turns an error body into a typed error, with no key-shaped text in its message", async () => {
        serve(provider, "error");
        const err = await adapter.complete(m, req, "k").catch((e) => e);
        expect(err).toBeInstanceOf(errorType);
        expect((err as Error).message).not.toMatch(/nvapi-[A-Za-z0-9]{20}/);
    });
});
