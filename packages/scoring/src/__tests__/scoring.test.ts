import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTaskSchema, type Money, type Period } from "@repo/types";
import { extractCandidate, parseObject } from "../extract";
import { normalizeSkill, normalizeText } from "../normalize";
import { normalizeCurrency, scoreMoney, yearly } from "../money";
import { scoreField, setScores } from "../fields";
import { scoreAnswer, scoreOutput } from "../score";
import { canonicalAnswer } from "../canonical";

const task = createTaskSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8")));
const rule = (key: string) => task.fields.find((f) => f.key === key)!;
const INR = (min: number | null, max: number | null, period: Period): Money => ({ min, max, currency: "INR", period });

const expected = {
    title: "Frontend Developer Intern", company: "Acme Labs", location: "Bengaluru", remote: "hybrid", employment_type: "internship",
    experience_years_min: 0, skills: ["react", "typescript", "css"], stipend_or_salary: INR(25000, 30000, "month"),
};
const out = (over: Record<string, unknown> = {}) => JSON.stringify({ ...expected, ...over });
const score = (rawText: string, technique: "zero_shot" | "cot" = "zero_shot") => scoreOutput({ rawText, technique, fields: task.fields, expected });

describe("extractCandidate / parseObject (no repair)", () => {
    it("strips a ```json fence", () => expect(parseObject(extractCandidate('```json\n{"a":1}\n```', "zero_shot"))).toEqual({ a: 1 }));
    it("strips a bare ``` fence", () => expect(parseObject(extractCandidate('```\n{"a":1}\n```', "structured"))).toEqual({ a: 1 }));
    it("does not remove prose around an object", () => expect(parseObject(extractCandidate('Here you go: {"a":1}', "zero_shot"))).toBeNull());
    it("does not fix a trailing comma", () => expect(parseObject(extractCandidate('{"a":1,}', "zero_shot"))).toBeNull());
    it("an array is not an object", () => expect(parseObject(extractCandidate('[{"a":1}]', "zero_shot"))).toBeNull());
    it("a scalar is not an object", () => expect(parseObject(extractCandidate("42", "zero_shot"))).toBeNull());
    it("null candidate parses to null", () => expect(parseObject(null)).toBeNull());
    it("CoT uses the LAST <json> block", () => {
        const raw = 'draft <json>{"a":1}</json> wait, correction <json>\n{"a":2}\n</json>';
        expect(parseObject(extractCandidate(raw, "cot"))).toEqual({ a: 2 });
    });
    it("CoT with a fenced block inside the tags", () => expect(parseObject(extractCandidate('<json>```json\n{"a":3}\n```</json>', "cot"))).toEqual({ a: 3 }));
    it("CoT without a block has no candidate", () => expect(extractCandidate('{"a":1}', "cot")).toBeNull());
});

describe("normalize", () => {
    it("text: case, punctuation, NFKC and spaces", () => {
        expect(normalizeText("Acme Labs.")).toBe("acme labs");
        expect(normalizeText("  ＡＣＭＥ   Labs ")).toBe("acme labs");
    });
    it("text: C++ collapses (fine for titles, both sides get it)", () => expect(normalizeText("C++ Developer")).toBe("c developer"));
    it("skill: keeps c++/node.js, trims trailing punctuation, maps synonyms", () => {
        const syn = { js: "javascript" };
        expect(normalizeSkill("C++", syn)).toBe("c++");
        expect(normalizeSkill(" Node.js ", syn)).toBe("node.js");
        expect(normalizeSkill("JS;", syn)).toBe("javascript");
    });
});

describe("money", () => {
    it.each([
        ["3–5 LPA as monthly", INR(25000, 41667, "month"), INR(300000, 500000, "year"), 1, "match"],
        ["3–5 LPA unconverted", INR(3, 5, "year"), INR(300000, 500000, "year"), 0, "out_of_tolerance"],
        ["monthly read as yearly", INR(15000, 25000, "year"), INR(15000, 25000, "month"), 0, "out_of_tolerance"],
        ["within 5 %", INR(26000, null, "month"), INR(25000, null, "month"), 1, "match"],
        ["outside 5 %", INR(27000, null, "month"), INR(25000, null, "month"), 0, "out_of_tolerance"],
        ["invented for 'competitive'", INR(500000, null, "year"), null, 0, "null_expected"],
        ["missed", null, INR(20000, null, "month"), 0, "null_predicted"],
        ["both null", null, null, 1, "match"],
        ["₹ vs INR", { ...INR(20000, null, "month"), currency: "₹" }, INR(20000, null, "month"), 1, "match"],
        ["$50/hr", { min: 104000, max: null, currency: "USD", period: "year" }, { min: 50, max: null, currency: "USD", period: "hour" }, 1, "match"],
        ["currency differs", { ...INR(50, null, "hour"), currency: "USD" }, INR(50, null, "hour"), 0, "currency_mismatch"],
        ["min ok, max missing", INR(25000, null, "month"), INR(25000, 30000, "month"), 0, "out_of_tolerance"],
        ["expected min is 0", INR(0, 100, "year"), INR(0, 100, "year"), 1, "match"],
        ["expected min 0, got 1", INR(1, 100, "year"), INR(0, 100, "year"), 0, "out_of_tolerance"],
    ])("%s", (_, pred, exp, scoreWanted, reason) => expect(scoreMoney(pred as Money | null, exp as Money | null, 0.05)).toEqual({ score: scoreWanted, reason }));

    it("normalises currency symbols and unknown codes", () => {
        expect(["₹", "Rs.", "rs", "INR"].map(normalizeCurrency)).toEqual(["INR", "INR", "INR", "INR"]);
        expect(["$", "US$", "€", "£", "chf"].map(normalizeCurrency)).toEqual(["USD", "USD", "EUR", "GBP", "CHF"]);
    });
    it("yearly: null stays null, periods multiply", () => {
        expect(yearly(null, "month")).toBeNull();
        expect([1, 1, 1, 1, 1].map((v, i) => yearly(v, (["hour", "day", "week", "month", "year"] as Period[])[i]!))).toEqual([2080, 260, 52, 12, 1]);
    });
});

describe("set F1", () => {
    it("expected {react,typescript,css} vs predicted {react,javascript,css,communication}", () => {
        const { precision, recall, f1 } = setScores(new Set(["react", "javascript", "css", "communication"]), new Set(["react", "typescript", "css"]));
        expect(precision).toBeCloseTo(0.5);
        expect(recall).toBeCloseTo(2 / 3);
        expect(f1).toBeCloseTo(0.5714, 3);
    });
    it("both empty = 1; nothing predicted = 0; nothing expected but predicted = 0; disjoint = 0", () => {
        expect(setScores(new Set(), new Set())).toEqual({ precision: 1, recall: 1, f1: 1 });
        expect(setScores(new Set(), new Set(["a"]))).toEqual({ precision: 0, recall: 0, f1: 0 });
        expect(setScores(new Set(["a"]), new Set())).toEqual({ precision: 0, recall: 0, f1: 0 });
        expect(setScores(new Set(["a"]), new Set(["b"])).f1).toBe(0);
    });
});

describe("scoreField", () => {
    const skills = rule("skills");
    it("skills with synonyms: ['JS','React.js','communication'] vs ['javascript','react'] → P 2/3, R 1, F1 0.8, partial", () => {
        const [s, d] = scoreField(skills, { skills: ["JS", "React.js", "communication"] }, { skills: ["javascript", "react"] });
        expect(s.score).toBeCloseTo(0.8);
        expect(s.reason).toBe("partial");
        expect(d.precision).toBeCloseTo(2 / 3);
        expect(d.recall).toBe(1);
    });
    it("skills both empty = 1 match; predicted empty vs ['react'] = 0 mismatch", () => {
        expect(scoreField(skills, { skills: [] }, { skills: [] })[0]).toMatchObject({ score: 1, reason: "match" });
        const [s, d] = scoreField(skills, { skills: [] }, { skills: ["react"] });
        expect(s).toMatchObject({ score: 0, reason: "mismatch" });
        expect(d).toMatchObject({ precision: 0, recall: 0 });
    });
    it("wrong type: '2' for an integer, 'WFH' for the remote enum, null for a non-null set", () => {
        expect(scoreField(rule("experience_years_min"), { experience_years_min: "2" }, { experience_years_min: 2 })[0]).toMatchObject({ score: 0, reason: "wrong_type" });
        expect(scoreField(rule("remote"), { remote: "WFH" }, { remote: "remote" })[0]).toMatchObject({ score: 0, reason: "wrong_type" });
        expect(scoreField(skills, { skills: null }, { skills: [] })[0].reason).toBe("wrong_type");
    });
    it("missing key is 0 even when the label is null; no parsed object is 'missing' too", () => {
        expect(scoreField(rule("company"), { title: "x" }, { company: null })[0]).toMatchObject({ score: 0, reason: "missing" });
        expect(scoreField(rule("company"), null, { company: "A" })[0].reason).toBe("missing");
    });
    it("text: null handling", () => {
        const t = rule("company");
        expect(scoreField(t, { company: null }, { company: null })[0]).toMatchObject({ score: 1, reason: "match" });
        expect(scoreField(t, { company: "Invented" }, { company: null })[0].reason).toBe("null_expected");
        expect(scoreField(t, { company: null }, { company: "Acme" })[0].reason).toBe("null_predicted");
    });
    it("text: normalised match, fuzzy mismatch", () => {
        expect(scoreField(rule("company"), { company: "acme labs" }, { company: "Acme Labs." })[0]).toMatchObject({ score: 1, reason: "match" });
        const [s, d] = scoreField(rule("title"), { title: "Frontend Intern" }, { title: "Frontend Developer Intern" });
        expect(s).toMatchObject({ score: 0, reason: "mismatch" });
        expect(d).toMatchObject({ normPredicted: "frontend intern", normExpected: "frontend developer intern" });
    });
    it("enum exact", () => {
        expect(scoreField(rule("remote"), { remote: "hybrid" }, { remote: "hybrid" })[0].score).toBe(1);
        expect(scoreField(rule("remote"), { remote: "onsite" }, { remote: "hybrid" })[0]).toMatchObject({ score: 0, reason: "mismatch" });
    });
    it("integer: exact, null must equal null, optional absolute tolerance", () => {
        const years = rule("experience_years_min");
        expect(scoreField(years, { experience_years_min: 2 }, { experience_years_min: 2 })[0].score).toBe(1);
        expect(scoreField(years, { experience_years_min: 3 }, { experience_years_min: 2 })[0].reason).toBe("mismatch");
        expect(scoreField(years, { experience_years_min: null }, { experience_years_min: null })[0].score).toBe(1);
        expect(scoreField(years, { experience_years_min: 2 }, { experience_years_min: null })[0].reason).toBe("null_expected");
        const lenient = { ...years, tolerance: 1 } as typeof years;
        expect(scoreField(lenient, { experience_years_min: 3 }, { experience_years_min: 2 })[0].score).toBe(1);
        expect(scoreField(lenient, { experience_years_min: 4 }, { experience_years_min: 2 })[0].score).toBe(0);
    });
    it("boolean: exact, null only equals null", () => {
        const b = { kind: "boolean", key: "yes", nullable: true } as const;
        expect(scoreField(b, { yes: true }, { yes: true })[0].score).toBe(1);
        expect(scoreField(b, { yes: false }, { yes: true })[0].reason).toBe("mismatch");
        expect(scoreField(b, { yes: null }, { yes: null })[0].score).toBe(1);
        expect(scoreField(b, { yes: true }, { yes: null })[0].reason).toBe("null_expected");
    });
    it("a label missing the key is treated as null (text) / an empty set (skills)", () => {
        expect(scoreField(rule("company"), { company: null }, {})[0]).toMatchObject({ score: 1 });
        expect(scoreField(rule("skills"), { skills: [] }, {})[0]).toMatchObject({ score: 1, reason: "match" });
    });
});

describe("scoreOutput", () => {
    it("the spec's example against itself: overall 1, exact match, valid", () => {
        const r = score(out());
        expect(r).toMatchObject({ validJson: true, schemaValid: true, overallScore: 1, exactMatch: true });
        expect(r.fieldScores).toHaveLength(8);
        expect(r.fieldScores.every((f) => typeof f.key === "string" && f.score === 1)).toBe(true);
        expect(r.fieldDetails.skills).toMatchObject({ precision: 1, recall: 1 });
    });
    it("a fenced answer scores like a bare one", () => expect(score("```json\n" + out() + "\n```").overallScore).toBe(1));
    it("prose around the JSON is invalid: every field missing, overall 0", () => {
        const r = score(`Sure! ${out()}`);
        expect(r).toMatchObject({ validJson: false, schemaValid: false, overallScore: 0, exactMatch: false });
        expect(r.fieldScores.every((f) => f.reason === "missing")).toBe(true);
    });
    it("CoT without a <json> block is invalid; with two blocks the last wins", () => {
        expect(score(out(), "cot").validJson).toBe(false);
        expect(score(`<json>{"title":"x"}</json> final: <json>${out()}</json>`, "cot").overallScore).toBe(1);
    });
    it("a missing key scores 0 on that field and fails the schema, others unchanged", () => {
        const { company: _c, ...rest } = expected;
        const r = score(JSON.stringify(rest));
        expect(r.schemaValid).toBe(false);
        expect(r.fieldScores.find((f) => f.key === "company")).toMatchObject({ score: 0, reason: "missing" });
        expect(r.overallScore).toBeCloseTo(7 / 8);
    });
    it("an extra key fails the schema but changes no field score", () => {
        const r = score(out({ notes: "hello" }));
        expect(r.schemaValid).toBe(false);
        expect(r.validJson).toBe(true);
        expect(r.overallScore).toBe(1);
        expect(r.exactMatch).toBe(true);
    });
    it("salary invented for 'competitive' scores 0 with null_expected", () => {
        const r = scoreOutput({
            rawText: out({ stipend_or_salary: INR(500000, null, "year") }), technique: "zero_shot", fields: task.fields,
            expected: { ...expected, stipend_or_salary: null },
        });
        expect(r.fieldScores.find((f) => f.key === "stipend_or_salary")).toMatchObject({ score: 0, reason: "null_expected" });
    });
    it("scoreAnswer scores one answer object against another (agreement)", () => {
        // 'react.js' and 'reactjs' are synonyms of 'react' in the task's table: these two labels agree.
        expect(scoreAnswer(task.fields, { ...expected, skills: ["React.js", "typescript", "CSS"] }, expected).exactMatch).toBe(true);
        expect(scoreAnswer(task.fields, { ...expected, skills: ["reactjs", "typescript", "css"] }, expected).exactMatch).toBe(true);
        // a genuinely different skill set does not
        const r = scoreAnswer(task.fields, { ...expected, skills: ["vue", "typescript", "css"] }, expected);
        expect(r.exactMatch).toBe(false);
        expect(r.fieldScores.find((f) => f.key === "skills")!.score).toBeCloseTo(2 / 3);
    });
});

describe("canonicalAnswer", () => {
    it("null for an unparsed answer", () => expect(canonicalAnswer(task.fields, null)).toBeNull());
    it("equal for differences that score identically: skill order/case/synonyms, title case/punctuation", () => {
        const a = { ...expected, skills: ["CSS", "TypeScript", "ReactJS"], title: "frontend developer intern." };
        const b = { ...expected, skills: ["react", "typescript", "css"] };
        expect(canonicalAnswer(task.fields, a)).toBe(canonicalAnswer(task.fields, b));
    });
    it("equal for the same salary monthly vs yearly, different for a different amount", () => {
        const monthly = { ...expected, stipend_or_salary: INR(25000, 30000, "month") };
        const yearlyForm = { ...expected, stipend_or_salary: { min: 300000, max: 360000, currency: "₹", period: "year" } };
        expect(canonicalAnswer(task.fields, monthly)).toBe(canonicalAnswer(task.fields, yearlyForm));
        expect(canonicalAnswer(task.fields, { ...expected, stipend_or_salary: INR(30000, 30000, "month") })).not.toBe(canonicalAnswer(task.fields, monthly));
    });
    it("a missing key is distinct from null", () => {
        const { company: _c, ...rest } = expected;
        expect(canonicalAnswer(task.fields, rest)).not.toBe(canonicalAnswer(task.fields, { ...expected, company: null }));
    });
    it("tolerates a money object with no currency", () => {
        const noCurrency = { ...expected, stipend_or_salary: { min: 1, max: 2, period: "year" } };
        expect(canonicalAnswer(task.fields, noCurrency)).toContain('"c":""');
    });
    it("passes other kinds through (enum, integer)", () => {
        expect(canonicalAnswer(task.fields, { ...expected, remote: "onsite" })).not.toBe(canonicalAnswer(task.fields, expected));
    });
});
