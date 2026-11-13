import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { promptBodySchema } from "@repo/types";
import { parsePromptFile } from "./promptFile";

const file = (name: string) => readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/prompts", name), "utf8");

describe("prompt files", () => {
    it("v0-vague is exactly the Playbook's text, with an empty system prompt", () => {
        const p = parsePromptFile(file("v0-vague.md"), "v0-vague.md");
        expect(p.system).toBe("");
        expect(p.template).toBe("Extract the important details from this job posting as JSON.\n\n{{input}}");
        expect(promptBodySchema.safeParse({ key: p.key, technique: p.technique, system: p.system, template: p.template }).success).toBe(true);
    });
    it("still needs a non-empty user section and a system heading", () => {
        expect(() => parsePromptFile("---\nkey: x\ntechnique: zero_shot\n---\n## user\n{{input}}\n", "x.md")).toThrow(/needs both/);
        expect(() => parsePromptFile("---\nkey: x\ntechnique: zero_shot\n---\n## system\nhi\n## user\n\n", "x.md")).toThrow(/needs both/);
    });
});
