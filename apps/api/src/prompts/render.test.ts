import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTaskSchema, promptBodySchema } from "@repo/types";
import { examplesBlock, renderPrompt, renderTemplate } from "./render";

const task = createTaskSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8")));

describe("renderTemplate", () => {
    it("substitutes in a single pass: a value that looks like a placeholder stays literal", () => {
        const out = renderTemplate("A: {{instructions}} / {{input}}", { instructions: "be careful", input: "hello {{instructions}}" });
        expect(out).toBe("A: be careful / hello {{instructions}}");
    });
    it("renders a placeholder with no value as empty text", () => {
        expect(renderTemplate("x{{examples}}y", {})).toBe("xy");
    });
    it("tolerates spaces inside the braces", () => {
        expect(renderTemplate("{{ input }}", { input: "ok" })).toBe("ok");
    });
});

describe("renderPrompt", () => {
    const prompt = { system: "{{instructions}}\n\nFields:\n{{fields}}", template: 'Posting:\n"""\n{{input}}\n"""' };
    it("puts the task's instructions and generated field list in the system text", () => {
        const { system, messages } = renderPrompt(prompt, task, "Backend intern", []);
        expect(system).toContain(task.instructions);
        expect(system).toContain('- remote: one of "remote", "hybrid", "onsite", "unknown"');
        expect(system).toContain("- stipend_or_salary:");
        expect(messages).toEqual([{ role: "user", content: 'Posting:\n"""\nBackend intern\n"""' }]);
    });
    it("an input containing {{instructions}} is not expanded", () => {
        const { messages } = renderPrompt(prompt, task, "evil {{instructions}}", []);
        expect(messages[0]!.content).toContain("evil {{instructions}}");
        expect(messages[0]!.content).not.toContain(task.instructions);
    });
    it("matches the field-list snapshot for the job-posting task", () => {
        expect(renderPrompt({ system: "{{fields}}", template: "{{input}}" }, task, "x", []).system).toMatchInlineSnapshot(`
          "- title: string or null if not stated
          - company: string or null if not stated
          - location: string or null if not stated
          - remote: one of "remote", "hybrid", "onsite", "unknown"
          - employment_type: one of "full_time", "part_time", "internship", "contract", "unknown"
          - experience_years_min: integer or null if not stated
          - skills: array of lower-case strings
          - stipend_or_salary: {"min": number|null, "max": number|null, "currency": ISO 4217 code, "period": "hour"|"day"|"week"|"month"|"year"} or null if not stated"
        `);
    });
});

describe("examplesBlock", () => {
    it("shows each example's input and expected JSON", () => {
        expect(examplesBlock([{ input: "in1", expected: { a: 1 } }])).toBe('Example 1\nInput:\n"""\nin1\n"""\nOutput:\n{"a":1}');
    });
});

describe("promptBodySchema", () => {
    const base = { key: "v1-zero-shot", technique: "zero_shot" as const, system: "{{instructions}}", template: "{{input}}" };
    it("accepts a valid prompt", () => expect(promptBodySchema.safeParse(base).success).toBe(true));
    it("rejects an unknown placeholder", () => {
        const r = promptBodySchema.safeParse({ ...base, system: "{{salary}}" });
        expect(r.success ? "" : r.error.issues[0]!.message).toMatch(/Unknown placeholder/);
    });
    it("requires {{input}} in the template", () => expect(promptBodySchema.safeParse({ ...base, template: "no input" }).success).toBe(false));
    it("few_shot needs examples", () => expect(promptBodySchema.safeParse({ ...base, technique: "few_shot" }).success).toBe(false));
    it("attached examples need {{examples}}", () => {
        const id = "01a1a72d-0000-7000-8000-000000000001";
        expect(promptBodySchema.safeParse({ ...base, fewShotExampleIds: [id] }).success).toBe(false);
        expect(promptBodySchema.safeParse({ ...base, fewShotExampleIds: [id], template: "{{examples}} {{input}}" }).success).toBe(true);
    });
});
