import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOpenAiCompatible } from "./openaiCompatible";
import { createReplayProvider } from "./replay";
import { fakeProvider, requestKey } from "./fake";
import { ModelRetired, ProviderAuthError, ReplayMiss } from "../errors";
import { modelConfigByKey, type ModelConfig } from "../../config/models.config";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A stub that speaks Chat Completions, so the adapter's wire format is tested without a real key.
let server: http.Server;
let base = "";
const seen: { url: string; auth: string | undefined; body: Record<string, any> }[] = [];

beforeAll(async () => {
    server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
            seen.push({ url: req.url ?? "", auth: req.headers.authorization, body });
            const send = (status: number, json: unknown) => {
                res.writeHead(status, { "content-type": "application/json" });
                res.end(JSON.stringify(json));
            };
            if (body.model === "retired/model") return send(410, { error: "Gone" });
            if (req.headers.authorization === "Bearer wrong") return send(403, { error: "Forbidden" });
            send(200, {
                choices: [{ message: { content: '```json\n{"hi":true}\n```' }, finish_reason: "stop" }],
                usage: { prompt_tokens: 12, completion_tokens: 7 },
            });
        });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const nim: ModelConfig = { ...modelConfigByKey("nvidia:openai/gpt-oss-20b")! };
const req = { system: "sys", messages: [{ role: "user" as const, content: "hello" }], temperature: 0, maxTokens: 50, signal: new AbortController().signal };

describe("openaiCompatible", () => {
    const adapter = createOpenAiCompatible(base || "http://127.0.0.1:0");
    it("posts Chat Completions, returns raw text + usage, and does not strip fences", async () => {
        const live = createOpenAiCompatible(base);
        const out = await live.complete(nim, req, "good-key");
        expect(out.text).toBe('```json\n{"hi":true}\n```');
        expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 7 });
        const last = seen.at(-1)!;
        expect(last.url).toBe("/chat/completions");
        expect(last.auth).toBe("Bearer good-key");
        expect(last.body).toMatchObject({ model: "openai/gpt-oss-20b", max_tokens: 50, temperature: 0 });
        expect(last.body.messages[0]).toEqual({ role: "system", content: "sys" });
        expect(adapter).toBeDefined();
    });
    it("sends nvext.guided_json for NVIDIA structured output and response_format for OpenAI", async () => {
        const live = createOpenAiCompatible(base);
        const structured = { name: "answer", schema: { type: "object" } };
        await live.complete(nim, { ...req, structured }, "k");
        expect(seen.at(-1)!.body.nvext).toEqual({ guided_json: { type: "object" } });
        await live.complete({ ...nim, provider: "openai" }, { ...req, structured }, "k");
        expect(seen.at(-1)!.body.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "answer", strict: true } });
    });
    it("applies model quirks (no temperature, max_completion_tokens, extra body)", async () => {
        const live = createOpenAiCompatible(base);
        await live.complete({ ...nim, quirks: { noTemperature: true, maxTokensParam: "max_completion_tokens", extraBody: { chat_template_kwargs: { thinking: false } } } }, req, "k");
        const body = seen.at(-1)!.body;
        expect(body.temperature).toBeUndefined();
        expect(body.max_completion_tokens).toBe(50);
        expect(body.chat_template_kwargs).toEqual({ thinking: false });
    });
    it("maps 410 → ModelRetired and 403 → ProviderAuthError", async () => {
        const live = createOpenAiCompatible(base);
        await expect(live.complete({ ...nim, modelId: "retired/model" }, req, "k")).rejects.toBeInstanceOf(ModelRetired);
        await expect(live.complete(nim, req, "wrong")).rejects.toBeInstanceOf(ProviderAuthError);
    });
});

describe("replay", () => {
    const fakeModel = modelConfigByKey("fake:text")!;
    const r = { system: "sys", messages: [{ role: "user" as const, content: "q" }], temperature: 0, maxTokens: 10 };
    it("records on a miss, reads on a hit, and the system prompt is part of the key", async () => {
        const dir = mkdtempSync(join(tmpdir(), "replay-"));
        const recorded = createReplayProvider({ dir, fallback: fakeProvider, recordOnMiss: true });
        const first = await recorded.complete(fakeModel, { ...r, signal: req.signal }, "k");
        const offline = createReplayProvider({ dir });
        expect(await offline.complete(fakeModel, { ...r, signal: req.signal }, "k")).toEqual(first);
        await expect(offline.complete(fakeModel, { ...r, system: "other", signal: req.signal }, "k")).rejects.toBeInstanceOf(ReplayMiss);
        expect(requestKey(fakeModel, r)).not.toBe(requestKey(fakeModel, { ...r, system: "other" }));
        writeFileSync(join(dir, "x.json"), "{}"); // stray files are ignored
    });
});
