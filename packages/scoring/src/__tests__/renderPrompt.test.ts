import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTaskSchema, promptBodySchema, type Technique } from "@repo/types";
import { renderPrompt, type FewShot } from "../renderPrompt";
import { renderTemplate } from "../template";

const task = createTaskSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8")));
const answer = { title: "Dev", company: "Co", location: "Pune", remote: "remote", employment_type: "full_time", experience_years_min: 1, skills: ["react"], stipend_or_salary: null };
const shots: FewShot[] = [1, 2, 3].map((i) => ({ ref: `jp_00${i}`, split: "dev", input: `posting ${i}`, expected: { ...answer, company: `Co${i}` } }));
const base = { system: "{{instructions}}\n\nFields:\n{{fields}}", template: 'Posting:\n"""\n{{input}}\n"""' };
const render = (technique: Technique, over: Partial<typeof base> = {}, fewShots: FewShot[] = [], input = "the real posting") =>
    renderPrompt({ prompt: { technique, ...base, ...over }, task, input, fewShots });

describe("renderTemplate", () => {
    it("is single pass, leaves unknown placeholders, and blanks known ones with no value", () => {
        expect(renderTemplate("{{input}} {{instructions}}", { input: "x {{instructions}}", instructions: "i" })).toBe("x {{instructions}} i");
        expect(renderTemplate("a{{examples}}b {{salary}}", {})).toBe("ab {{salary}}");
    });
});

describe("renderPrompt", () => {
    it("zero_shot: system + one user turn, no examples", () => {
        const r = render("zero_shot");
        expect(r.messages).toHaveLength(1);
        expect(r.fewShotStyle).toBe("none");
        expect(r.structured).toBeUndefined();
        expect(r.maxTokens).toBe(800);
    });
    it("few_shot inline: numbered examples in the system text", () => {
        const r = render("few_shot", { system: `${base.system}\n\n{{examples}}` }, shots);
        expect(r.fewShotStyle).toBe("inline");
        for (const n of [1, 2, 3]) expect(r.system).toContain(`Example ${n}`);
        expect(r.messages).toHaveLength(1);
    });
    it("few_shot multi-turn when {{examples}} is absent: user/assistant pairs, then the real input", () => {
        const r = render("few_shot", {}, shots);
        expect(r.fewShotStyle).toBe("multi_turn");
        expect(r.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant", "user", "assistant", "user"]);
        expect(r.messages.at(-1)!.content).toContain("the real posting");
        expect(JSON.parse(r.messages[1]!.content)).toMatchObject({ company: "Co1" });
    });
    it("expected JSON is rendered canonically (field order, 2-space)", () => {
        const r = render("few_shot", {}, shots);
        expect(Object.keys(JSON.parse(r.messages[1]!.content))).toEqual(task.fields.map((f) => f.key));
        expect(r.messages[1]!.content).toContain('\n  "title"');
    });
    it("a test example as a few-shot throws (second lock)", () => {
        expect(() => render("few_shot", {}, [{ ...shots[0]!, split: "test" }])).toThrow(/dev split/);
    });
    it("cot: the user template can carry the <json> instruction; 2000 tokens", () => {
        const r = render("cot", { template: `${base.template}\nThen write the final answer between <json> and </json>.` });
        expect(r.messages.at(-1)!.content.trim().endsWith("</json>.")).toBe(true);
        expect(r.maxTokens).toBe(2000);
    });
    it("structured: the schema has 8 properties", () => {
        const r = render("structured");
        expect(Object.keys((r.structured!.schema as { properties: object }).properties)).toHaveLength(8);
        expect(r.structured!.name).toBe("answer");
    });
    it("input containing {{fields}} survives literally", () => {
        const r = render("zero_shot", {}, [], "evil {{fields}}");
        expect(r.messages[0]!.content).toContain("evil {{fields}}");
    });
});

describe("promptBodySchema", () => {
    const body = { key: "v1-zero-shot", technique: "zero_shot" as const, system: "{{instructions}}", template: "{{input}}" };
    it("examples without {{examples}}: allowed for few_shot (multi-turn), refused for other techniques", () => {
        const ids = ["01a1a72d-0000-7000-8000-000000000001"];
        expect(promptBodySchema.safeParse({ ...body, technique: "few_shot", fewShotExampleIds: ids }).success).toBe(true);
        expect(promptBodySchema.safeParse({ ...body, technique: "zero_shot", fewShotExampleIds: ids }).success).toBe(false);
        expect(promptBodySchema.safeParse({ ...body, technique: "zero_shot", fewShotExampleIds: ids, template: "{{examples}} {{input}}" }).success).toBe(true);
    });
    it("accepts valid, rejects unknown placeholder / missing {{input}} / few_shot without examples", () => {
        expect(promptBodySchema.safeParse(body).success).toBe(true);
        expect(promptBodySchema.safeParse({ ...body, system: "{{salary}}" }).success).toBe(false);
        expect(promptBodySchema.safeParse({ ...body, template: "no input" }).success).toBe(false);
        expect(promptBodySchema.safeParse({ ...body, technique: "few_shot" }).success).toBe(false);
    });
});

describe("field list snapshot", () => {
    it("matches for the job-posting task", () => {
        expect(render("zero_shot", { system: "{{fields}}" }).system).toMatchInlineSnapshot(`
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
