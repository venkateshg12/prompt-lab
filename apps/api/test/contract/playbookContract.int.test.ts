import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promptLabCaseLineSchema, promptLabResultLineSchema } from "./importContracts.copy";
import { toResultLine, type ResultForExport } from "../../src/runner/resultLine";

const CASES = path.resolve(__dirname, "../../../../cases");
const lines = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>);

/* Real exports (export-run → cases/<task>/runs/<runId>.results.jsonl). None exist before Phase 25's final runs: then this skips, visibly. */
const exports = ["job-postings", "reasoning-mini"].flatMap((task) => {
    const dir = path.join(CASES, task, "runs");
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".results.jsonl")).map((f) => path.join(dir, f)) : [];
});

describe(`committed exports${exports.length ? "" : " (skipped: no cases/*/runs/*.results.jsonl yet)"}`, () => {
    if (exports.length === 0) it.skip("cases/*/runs/*.results.jsonl parse with the Playbook's result-line schema", () => undefined);
    else it.each(exports)("%s parses with the Playbook's result-line schema", (file) => {
        const parsed = lines(file).map((l) => promptLabResultLineSchema.parse(l));
        expect(new Set(parsed.map((p) => p.runId)).size).toBe(1); // one run per file
        expect(new Set(parsed.map((p) => p.split)).size).toBe(1); // one split per file
        expect(parsed.every((p) => /^[a-z0-9-]+@\d+$/.test(p.promptVersion))).toBe(true);
    });
});

const caseFiles = [path.join(CASES, "job-postings/data/job_postings.jsonl"), path.join(CASES, "reasoning-mini/data/reasoning_mini.jsonl")].filter(existsSync);
describe(`case files${caseFiles.length ? "" : " (skipped: no labelled case files yet)"}`, () => {
    it.skipIf(caseFiles.length === 0)("parse with the Playbook's case-line schema", () => {
        for (const f of caseFiles) for (const l of lines(f)) expect(() => promptLabCaseLineSchema.parse(l)).not.toThrow();
    });
});

/* Always runs (CI too): an export built in memory by the real serializer, from a fixture run. */
describe("an in-memory export", () => {
    const base: ResultForExport = {
        runId: "01a1d4f6-d984-778c-b94f-cb197104828d", split: "test", promptKey: "v2-few-shot", promptVersion: 1, modelKey: "nvidia:openai/gpt-oss-20b",
        exampleRef: "jp_017", exampleTags: ["salary_lpa"], repeatIndex: 0, status: "scored", rawOutput: '{"title":"x"}', validJson: true, schemaValid: true,
        exactMatch: false, overallScore: 0.875, fieldScores: [{ key: "title", score: 1 }, { key: "remote", score: 0 }], fieldDetails: { skills: { precision: 1, recall: 0.5 } },
        inputTokens: 900, outputTokens: 120, costUsdMicros: 31, latencyMs: 812, error: null, testReused: false, completedAt: new Date("2026-11-13T10:00:00Z"),
    };
    const exported = [
        base,
        { ...base, repeatIndex: 1, status: "error" as const, rawOutput: null, validJson: null, schemaValid: null, exactMatch: null, overallScore: null, fieldScores: null, outputTokens: null, costUsdMicros: null, error: "provider_error" },
        { ...base, repeatIndex: 2, status: "skipped" as const, rawOutput: null, overallScore: null, fieldScores: null, error: "structured_unsupported" },
    ].map((r) => JSON.parse(JSON.stringify(toResultLine(r))) as Record<string, unknown>);

    it("parses with the copied schema, with the frozen version id and the example ref", () => {
        for (const l of exported) {
            const p = promptLabResultLineSchema.parse(l);
            expect(p.promptVersion).toBe("v2-few-shot@1");
            expect(p.exampleId).toBe("jp_017");
        }
        expect(exported.map((l) => l.status)).toEqual(["scored", "error", "skipped"]);
    });
    it("fails with the Zod path when a binding key is renamed", () => {
        const { exampleId, ...rest } = exported[0]!;
        const r = promptLabResultLineSchema.safeParse({ ...rest, exampleRef: exampleId });
        expect(r.success).toBe(false);
        expect(r.error!.issues[0]!.path).toEqual(["exampleId"]);
    });
    it("still parses with an unknown extra field (the Playbook's object strips it)", () => {
        expect(promptLabResultLineSchema.safeParse({ ...exported[0], somethingNew: 1 }).success).toBe(true);
    });
});
