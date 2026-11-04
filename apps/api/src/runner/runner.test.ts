import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("../ai/concurrency", () => ({
    withLease: async (_m: string, fn: () => Promise<unknown>) => fn(),
    assertRpmBudget: async () => undefined,
}));
vi.mock("../services/model.service", () => ({ markRetired: async () => undefined }));

import { createTaskSchema, type Technique } from "@repo/types";
import { renderPrompt } from "@repo/scoring";
import { cellJobId } from "./cellJobId";
import { INPUT_SENTINEL, userTurnFor, type VariantSnapshot } from "./snapshot";
import { executeCell } from "./executeCell";
import { estimateCostMicros } from "./createRun";
import { toResultLine } from "./resultLine";
import { complete } from "../ai/complete";
import { fakeLlm } from "../ai/providers/fake";
import { resetBreakers } from "../ai/breakers";
import { ModelRetired, ProviderBusy, ProviderHttpError, ProviderSkipped, ProviderTimeout } from "../ai/errors";
import { errorCode, isTransient } from "../jobs/processors/runCell.processor";
import { modelConfigByKey } from "../config/models.config";

const task = createTaskSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8")));
const model = modelConfigByKey("fake:text")!;
const price = { inputUsdMicrosPerMTok: 1_000_000, outputUsdMicrosPerMTok: 5_000_000 };
const expected = { title: "Dev", company: "Co", location: "Pune", remote: "remote", employment_type: "full_time", experience_years_min: 1, skills: ["react"], stipend_or_salary: null };

const snapshotOf = (technique: Technique, over: Partial<{ system: string; template: string }> = {}, fewShots: { ref: string; split: "dev" | "test"; input: string; expected: unknown }[] = []): VariantSnapshot => {
    const prompt = { technique, system: "{{instructions}}\n{{fields}}", template: "Posting: {{input}}", ...over };
    const rendered = renderPrompt({ prompt, task, input: INPUT_SENTINEL, fewShots });
    return {
        promptVersionId: "p", versionId: "k@1", technique, system: rendered.system,
        priorTurns: rendered.messages.slice(0, -1), userTemplate: rendered.messages.at(-1)!.content,
        structured: rendered.structured, temperature: 0, maxTokens: rendered.maxTokens, fewShotStyle: rendered.fewShotStyle,
        fewShotRefs: fewShots.map((s) => s.ref),
    };
};

beforeEach(() => {
    fakeLlm.reset();
    resetBreakers();
    vi.spyOn(Math, "random").mockReturnValue(0);
});

describe("cellJobId", () => {
    it("is deterministic, dash-only, and short", () => {
        const a = cellJobId("run1", "v1", "e1", 0);
        expect(a).toBe(cellJobId("run1", "v1", "e1", 0));
        expect(a).toMatch(/^cell-run1-[0-9a-f]{16}$/);
        expect(a).not.toContain(":");
        expect(cellJobId("run1", "v1", "e1", 1)).not.toBe(a);
        expect(cellJobId("run1", "v2", "e1", 0)).not.toBe(a);
    });
});

describe("snapshot", () => {
    it("swapping the input into the snapshot equals rendering the prompt directly (all techniques)", () => {
        const shots = [{ ref: "jp_1", split: "dev" as const, input: "shot posting", expected }];
        const cases: [Technique, Partial<{ system: string; template: string }>][] = [
            ["zero_shot", {}], ["cot", {}], ["structured", {}],
            ["few_shot", { system: "{{instructions}}\n{{examples}}" }], // inline
            ["few_shot", {}], // multi-turn
        ];
        for (const [technique, over] of cases) {
            const fs = technique === "few_shot" ? shots : [];
            const snap = snapshotOf(technique, over, fs);
            const direct = renderPrompt({ prompt: { technique, system: "{{instructions}}\n{{fields}}", template: "Posting: {{input}}", ...over }, task, input: "the real {{fields}} posting", fewShots: fs });
            expect(userTurnFor(snap, "the real {{fields}} posting")).toBe(direct.messages.at(-1)!.content);
            expect([...snap.priorTurns, { role: "user", content: userTurnFor(snap, "the real {{fields}} posting") }]).toEqual(direct.messages);
            expect(snap.system).toBe(direct.system);
        }
    });
    it("survives a JSON round trip (the snapshot is stored as jsonb)", () => {
        const snap = snapshotOf("zero_shot");
        expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
        expect(snap.userTemplate).toContain(INPUT_SENTINEL);
        expect(INPUT_SENTINEL).not.toContain("\u0000"); // jsonb cannot store NUL
    });
});

describe("executeCell", () => {
    const cell = (snapshot = snapshotOf("zero_shot"), over = {}) => ({ model, modelStructured: "untested" as const, price, snapshot, fields: task.fields, input: "posting text", expected, ...over });

    it("renders the final user turn from the snapshot, scores the raw text, prices with the run's snapshot", async () => {
        fakeLlm.push({ kind: "text", text: JSON.stringify(expected) });
        const out = await executeCell(cell(), { complete });
        expect(out).toMatchObject({ status: "scored", validJson: true, schemaValid: true, overallScore: 1, exactMatch: true, attempts: 1 });
        expect(out.costUsdMicros).toBe(2000); // 1000 in × $1/M + 200 out × $5/M
        expect(fakeLlm.calls()[0]!.messages.at(-1)!.content).toBe("Posting: posting text");
    });
    it("invalid JSON is a scored wrong answer, never repaired", async () => {
        fakeLlm.push({ kind: "text", text: `Sure! ${JSON.stringify(expected)}` });
        const out = await executeCell(cell(), { complete });
        expect(out).toMatchObject({ status: "scored", validJson: false, overallScore: 0 });
        expect(out.rawOutput).toContain("Sure!");
    });
    it("a structured prompt on an unsupported model is skipped, not a fake number", async () => {
        const real = { ...model, provider: "nvidia" as const };
        const out = await executeCell(cell(snapshotOf("structured"), { model: real, modelStructured: "unsupported" }), { complete });
        expect(out).toEqual({ status: "skipped", error: "structured_unsupported" });
        expect(fakeLlm.calls()).toHaveLength(0);
    });
    it("provider errors propagate to the processor", async () => {
        fakeLlm.push({ kind: "error", error: new ModelRetired("fake:text", 410, "gone") });
        await expect(executeCell(cell(), { complete })).rejects.toBeInstanceOf(ModelRetired);
    });
});

describe("cell error classification", () => {
    it("busy / timeout / open breaker / 5xx / 429 are transient; 4xx and retired models are not", () => {
        expect(isTransient(new ProviderBusy("m"))).toBe(true);
        expect(isTransient(new ProviderTimeout("m", 1))).toBe(true);
        expect(isTransient(new ProviderSkipped("m"))).toBe(true);
        expect(isTransient(new ProviderHttpError("m", 503, "x"))).toBe(true);
        expect(isTransient(new ProviderHttpError("m", 429, "x"))).toBe(true);
        expect(isTransient(new ProviderHttpError("m", 400, "x"))).toBe(false);
        expect(isTransient(new ModelRetired("m", 410, "x"))).toBe(false);
    });
    it("error codes carry the class name and a scrubbed, bounded message", () => {
        const code = errorCode(new ProviderHttpError("m", 400, `bad key nvapi-abcdefghijklmnopqrstuvwxyz ${"x".repeat(900)}`));
        expect(code.startsWith("ProviderHttpError: ")).toBe(true);
        expect(code).not.toMatch(/nvapi-abcdef/);
        expect(code.length).toBeLessThanOrEqual(19 + 300);
    });
});

describe("estimateCostMicros", () => {
    it("is cells × (input tokens × in-price + maxTokens × out-price), BigInt", () => {
        const snap = snapshotOf("zero_shot");
        const est = estimateCostMicros([snap], [price], 400, 10);
        const promptChars = snap.system.length + snap.userTemplate.length + 400;
        const inTok = Math.ceil(promptChars / 4);
        expect(est).toBe(BigInt(Math.ceil((inTok * 1_000_000 + snap.maxTokens * 5_000_000) / 1_000_000)) * 10n);
    });
});

describe("toResultLine", () => {
    const base = {
        runId: "r", split: "dev" as const, promptKey: "v1-zero-shot", promptVersion: 1, modelKey: "fake:text", exampleRef: "jp_001",
        exampleTags: ["salary_lpa"], repeatIndex: 0, status: "scored" as const, rawOutput: "{}", validJson: true, schemaValid: false,
        exactMatch: false, overallScore: 0.5, fieldScores: [{ key: "title", score: 1, reason: "match" }] as { key: string; score: number }[],
        outputTokens: 10, costUsdMicros: 5, latencyMs: 12, testReused: false, completedAt: new Date("2026-11-05T00:00:00Z"),
    };
    it("matches the Playbook contract, with the extras on top", () => {
        const line = toResultLine(base);
        expect(line).toMatchObject({ promptVersion: "v1-zero-shot@1", exampleId: "jp_001", repeat: 0, completedAt: "2026-11-05T00:00:00.000Z", tags: ["salary_lpa"], testReused: false });
        expect(line.fieldScores).toEqual([{ key: "title", score: 1 }]); // reason stripped: {key, score} are binding
    });
    it("an error cell is still a valid line", () => {
        const line = toResultLine({ ...base, status: "error", rawOutput: null, overallScore: null, fieldScores: null, error: "ProviderBusy: x" });
        expect(line).toMatchObject({ status: "error", rawOutput: null, overallScore: null, fieldScores: null, error: "ProviderBusy: x" });
    });
    it("a contract break throws instead of writing a bad line", () => {
        expect(() => toResultLine({ ...base, overallScore: 1.5 })).toThrow();
    });
});
