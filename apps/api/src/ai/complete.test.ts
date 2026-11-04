import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./concurrency", () => ({
    withLease: async (_m: string, fn: () => Promise<unknown>) => fn(),
    assertRpmBudget: async () => undefined,
}));
const { markRetired } = vi.hoisted(() => ({ markRetired: vi.fn(async (_key: string) => undefined) }));
vi.mock("../services/model.service", () => ({ markRetired }));

import { complete } from "./complete";
import { fakeLlm } from "./providers/fake";
import { breakerFor, resetBreakers } from "./breakers";
import { ModelRetired, ProviderAuthError, ProviderHttpError, ProviderNotConfigured, ProviderSkipped } from "./errors";
import { modelConfigByKey } from "../config/models.config";
import { CircuitState } from "../types/rateLimiter.types";

const model = modelConfigByKey("fake:text")!;
const price = { inputUsdMicrosPerMTok: 1_000_000, outputUsdMicrosPerMTok: 5_000_000 };
const req = { system: "s", messages: [{ role: "user" as const, content: "hi" }], temperature: 0, maxTokens: 100 };

beforeEach(() => {
    fakeLlm.reset();
    resetBreakers();
    markRetired.mockClear();
    vi.spyOn(Math, "random").mockReturnValue(0); // no backoff sleeps
});

describe("complete()", () => {
    it("returns the model's text untouched, fences and all", async () => {
        const raw = '```json\n{"a":1}\n```';
        fakeLlm.push({ kind: "text", text: raw });
        const out = await complete(model, price, req);
        expect(out.text).toBe(raw);
        expect(out.attempts).toBe(1);
        // 1000 in × $1/M + 200 out × $5/M = $0.002 = 2000 micro-dollars
        expect(out.costUsdMicros).toBe(2000);
    });

    it("retries 429, 429, then succeeds: attempts 3", async () => {
        fakeLlm.push(
            { kind: "error", error: new ProviderHttpError("fake:text", 429, "slow") },
            { kind: "error", error: new ProviderHttpError("fake:text", 429, "slow") },
            { kind: "text", text: "ok" }
        );
        const out = await complete(model, price, req);
        expect(out).toMatchObject({ text: "ok", attempts: 3 });
    });

    it("never retries a 400 and never opens the breaker for client errors", async () => {
        for (let i = 0; i < 10; i++) {
            fakeLlm.push({ kind: "error", error: new ProviderAuthError("fake:text", 403, "bad key nvapi-abcdefghijklmnopqrstuvwxyz") });
            await expect(complete(model, price, req)).rejects.toBeInstanceOf(ProviderAuthError);
        }
        expect(fakeLlm.calls()).toHaveLength(10); // one attempt each
        expect(breakerFor("fake:text").getState()).toBe(CircuitState.CLOSED);
    });

    it("scrubs credentials out of error bodies", () => {
        const e = new ProviderHttpError("m", 400, "echo: Bearer sk-abcdefghijklmnopqrstuvwxyz and nvapi-abcdefghijklmnopqrstuvwxyz");
        expect(e.message).not.toMatch(/sk-abcdef|nvapi-abcdef/);
    });

    it("a 410 throws ModelRetired and deactivates the model", async () => {
        fakeLlm.push({ kind: "error", error: new ModelRetired("fake:text", 410, "gone") });
        await expect(complete(model, price, req)).rejects.toBeInstanceOf(ModelRetired);
        expect(markRetired).toHaveBeenCalledWith("fake:text");
    });

    it("a provider that keeps answering 503 opens the breaker; then calls fail fast with the 503 as cause", async () => {
        for (let i = 0; i < 60; i++) fakeLlm.push({ kind: "error", error: new ProviderHttpError("fake:text", 503, "down") });
        // Each failed call (3 attempts) is a ProviderSkipped carrying the real 503; 5 of them open the breaker.
        for (let i = 0; i < 5; i++) {
            const err = await complete(model, price, req).catch((e) => e);
            expect(err).toBeInstanceOf(ProviderSkipped);
            expect(((err as ProviderSkipped).cause as ProviderHttpError).status).toBe(503);
        }
        expect(breakerFor("fake:text").getState()).toBe(CircuitState.OPEN);
        const callsBefore = fakeLlm.calls().length;
        const fast = await complete(model, price, req).catch((e) => e);
        expect(fast).toBeInstanceOf(ProviderSkipped);
        expect(fakeLlm.calls().length).toBe(callsBefore); // failed instantly: no provider call
    });

    it("refuses a model whose provider has no key", async () => {
        const nvidia = modelConfigByKey("nvidia:openai/gpt-oss-20b")!;
        await expect(complete(nvidia, price, req)).rejects.toBeInstanceOf(ProviderNotConfigured);
    });
});
