import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fieldRulesSchema } from "@repo/types";
import { checkPublic, parseCell, secondLabelSample, sheetToCaseLines, SheetError, splitReport, stratifiedSplit } from "./caseTools";

const task = JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8"));
const fields = fieldRulesSchema.parse(task.fields);
const money = fields.find((f) => f.kind === "money")!;
const header = "id,split,tags,input,notes,title,company,location,remote,employment_type,experience_years_min,skills,stipend_or_salary";

describe("sheet → case lines", () => {
    it("parses every field kind, and money shorthand", () => {
        const csv = `${header}\njp_001,dev,salary_lpa;internship,"Hiring!\nInterns, Pune",,Frontend Intern,Acme Labs,Pune,onsite,internship,0,"react; node.js",600000-800000 INR year\n`;
        const [l] = sheetToCaseLines(csv, fields);
        expect(l).toMatchObject({ id: "jp_001", split: "dev", tags: ["salary_lpa", "internship"], input: "Hiring!\nInterns, Pune" });
        expect(l!.expected).toMatchObject({ skills: ["react", "node.js"], experience_years_min: 0, stipend_or_salary: { min: 600000, max: 800000, currency: "INR", period: "year" } });
        expect(parseCell(money, "-25000 INR month")).toEqual({ min: null, max: 25000, currency: "INR", period: "month" });
        expect(parseCell(money, "600000 INR year")).toEqual({ min: 600000, max: 600000, currency: "INR", period: "year" });
        expect(parseCell(money, "")).toBeNull();
        expect(parseCell(money, '{"min":1,"max":2,"currency":"USD","period":"hour"}')).toEqual({ min: 1, max: 2, currency: "USD", period: "hour" });
    });

    it("refuses the file on the first invalid row, naming the row and the Zod path", () => {
        const csv = `${header}\njp_001,,,x,,T,C,L,onsite,full_time,1,,\njp_002,,,y,,T,C,L,sometimes,full_time,1,,\n`;
        expect(() => sheetToCaseLines(csv, fields)).toThrow(SheetError);
        expect(() => sheetToCaseLines(csv, fields)).toThrow(/row 3 \(jp_002\): expected\.remote/);
        expect(() => sheetToCaseLines(`${header}\njp_001,,,x,,T,C,L,onsite,full_time,1,,\njp_001,,,x,,T,C,L,onsite,full_time,1,,\n`, fields)).toThrow(/duplicate id/);
        expect(() => sheetToCaseLines("id,input\njp_1,x\n", fields)).toThrow(/no column for field/);
    });
});

const lines = Array.from({ length: 100 }, (_, i) => ({
    id: `jp_${String(i).padStart(3, "0")}`,
    tags: [i % 4 === 0 ? "salary_lpa" : "full_time_in", ...(i % 7 === 0 ? ["salary_hidden"] : []), ...(i % 15 === 0 ? ["hinglish"] : [])],
}));

describe("stratified split", () => {
    it("is deterministic, exact in total, and puts every tag in both splits", () => {
        const a = stratifiedSplit(lines, { dev: 30, seed: 20261103 });
        const b = stratifiedSplit(lines, { dev: 30, seed: 20261103 });
        expect(a).toEqual(b);
        const report = splitReport(a);
        expect(report.dev).toBe(30);
        expect(report.test).toBe(70);
        for (const r of report.table) expect(r.dev > 0 && r.test > 0).toBe(true);
        expect(report.table.find((r) => r.tag === "salary_lpa")!.dev).toBeGreaterThanOrEqual(6); // ~30 % of 25
        expect(stratifiedSplit(lines, { dev: 30, seed: 1 })).not.toEqual(a); // the seed matters
    });

    it("flags a tag with fewer than 3 test examples", () => {
        expect(splitReport([{ tags: ["rare"], split: "test" }, { tags: ["rare"], split: "dev" }]).ok).toBe(false);
    });

    it("samples 20 for the second labeller: 8 dev / 12 test, deterministic", () => {
        const split = stratifiedSplit(lines, { dev: 30, seed: 7 });
        const s = secondLabelSample(split, { size: 20, devShare: 0.4, seed: 7 });
        expect(s).toHaveLength(20);
        expect(new Set(s).size).toBe(20);
        expect(s.filter((id) => split.find((l) => l.id === id)!.split === "dev")).toHaveLength(8);
        expect(secondLabelSample(split, { size: 20, devShare: 0.4, seed: 7 })).toEqual(s);
    });
});

describe("check-public", () => {
    it("finds emails, +91 numbers, 10-digit runs, URLs and private names; skips withheld inputs", () => {
        const found = checkPublic(
            [
                { id: "a", input: "Mail hr@acme.in or call +91 98765 43210" },
                { id: "b", input: "Apply at https://jobs.example.com or www.example.com, 9876543210" },
                { id: "c", input: "Infosys is hiring" },
                { id: "d", input: "Infosys again, +91 9999999999", publicInput: false },
                { id: "e", input: "Fresher chalega, ₹25k/month, React" },
            ],
            ["Infosys"]
        );
        expect(found.map((f) => `${f.id}:${f.kind}`).sort()).toEqual(["a:email", "a:phone_in", "b:digits10", "b:url", "b:www", "c:private_name"].sort());
    });
});
