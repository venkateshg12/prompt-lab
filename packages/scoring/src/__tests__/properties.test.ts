import { readFileSync } from "node:fs";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createTaskSchema, type Money } from "@repo/types";
import { cohensKappa, normalizeSkill, normalizeText, paretoFront, scoreMoney, scoreOutput, setScores } from "../index";

/*
  Invariants that hold for EVERY input (Phase 28). A table test checks the cases someone thought of;
  fast-check searches for the one nobody did. A counterexample becomes a named case in scoring.test.ts.
 */
const task = createTaskSchema.parse(JSON.parse(readFileSync(path.resolve(__dirname, "../../../../cases/job-postings/task.json"), "utf8")));
const PERIODS = { year: 1, month: 12, week: 52, day: 260, hour: 2080 } as const;
const money = fc.record({
    min: fc.integer({ min: 1, max: 5_000_000 }),
    max: fc.integer({ min: 1, max: 5_000_000 }),
    currency: fc.constantFrom("INR", "USD"),
    period: fc.constantFrom(...(Object.keys(PERIODS) as (keyof typeof PERIODS)[])),
});

describe("scoring invariants", () => {
    it("text normalisation is idempotent", () =>
        fc.assert(fc.property(fc.string(), (s) => normalizeText(normalizeText(s)) === normalizeText(s))));

    it("skill normalisation is idempotent", () =>
        fc.assert(fc.property(fc.string(), (s) => normalizeSkill(normalizeSkill(s, {}), {}) === normalizeSkill(s, {}))));

    it("set F1 is in [0, 1], symmetric, and 1 on identical sets", () =>
        fc.assert(
            fc.property(fc.uniqueArray(fc.string()), fc.uniqueArray(fc.string()), (a, b) => {
                const ab = setScores(new Set(a), new Set(b)).f1;
                expect(ab).toBeGreaterThanOrEqual(0);
                expect(ab).toBeLessThanOrEqual(1);
                expect(ab).toBeCloseTo(setScores(new Set(b), new Set(a)).f1, 10);
                expect(setScores(new Set(a), new Set(a)).f1).toBe(1);
            })
        ));

    it("the same salary written in any period scores 1 against its yearly form", () =>
        fc.assert(
            fc.property(fc.integer({ min: 1, max: 50_000 }), fc.constantFrom(...(Object.keys(PERIODS) as (keyof typeof PERIODS)[])), (amount, period) => {
                const per: Money = { min: amount, max: amount, currency: "INR", period };
                const year: Money = { min: amount * PERIODS[period], max: amount * PERIODS[period], currency: "INR", period: "year" };
                expect(scoreMoney(per, year, 0.05).score).toBe(1);
                expect(scoreMoney(year, per, 0.05).score).toBe(1);
            })
        ));

    it("money scoring is symmetric and only ever 0 or 1 (never partial)", () =>
        fc.assert(
            fc.property(fc.option(money, { nil: null }), fc.option(money, { nil: null }), (a, b) => {
                const s = scoreMoney(a as Money | null, b as Money | null, 0.05).score;
                expect([0, 1]).toContain(s);
                expect(scoreMoney(b as Money | null, a as Money | null, 0.05).score).toBe(s);
            })
        ));

    it("overall is deterministic, in [0, 1], and invalid JSON is never repaired into a score", () =>
        fc.assert(
            fc.property(fc.string(), fc.record({ stipend_or_salary: fc.option(money, { nil: null }) }), (raw, partial) => {
                const expected = { title: "x", company: null, location: null, remote: "unknown", employment_type: "unknown", experience_years_min: null, skills: [], ...partial };
                const a = scoreOutput({ rawText: raw, technique: "zero_shot", fields: task.fields, expected });
                expect(scoreOutput({ rawText: raw, technique: "zero_shot", fields: task.fields, expected })).toEqual(a);
                expect(a.overallScore).toBeGreaterThanOrEqual(0);
                expect(a.overallScore).toBeLessThanOrEqual(1);
                if (!a.validJson) expect(a.exactMatch).toBe(false);
            })
        ));

    it("kappa is at most 1 and agreement is in [0, 1]", () =>
        fc.assert(
            fc.property(fc.array(fc.record({ human: fc.boolean(), judge: fc.boolean() }), { minLength: 1 }), (pairs) => {
                const r = cohensKappa(pairs);
                expect(r.agreement!).toBeGreaterThanOrEqual(0);
                expect(r.agreement!).toBeLessThanOrEqual(1);
                if (r.kappa !== null) expect(r.kappa).toBeLessThanOrEqual(1 + 1e-12);
            })
        ));

    it("no point off the Pareto front beats a front point on both cost and accuracy", () =>
        fc.assert(
            fc.property(fc.array(fc.record({ cost: fc.double({ min: 0, max: 100, noNaN: true }), accuracy: fc.double({ min: 0, max: 1, noNaN: true }) })), (pts) => {
                const front = paretoFront(pts);
                for (const f of front) for (const p of pts) expect(p.cost < f.cost && p.accuracy > f.accuracy).toBe(false);
            })
        ));
});
