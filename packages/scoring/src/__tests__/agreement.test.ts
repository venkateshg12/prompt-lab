import { describe, expect, it } from "vitest";
import { cohensKappa, judgeValidated, paretoFront } from "../agreement";

const pairs = (spec: [boolean, boolean, number][]) => spec.flatMap(([human, judge, n]) => Array.from({ length: n }, () => ({ human, judge })));

describe("cohensKappa", () => {
    it("is 1 for perfect agreement with variation", () => {
        expect(cohensKappa(pairs([[true, true, 20], [false, false, 10]]))).toEqual({ n: 30, agreement: 1, kappa: 1 });
    });
    it("is 0 at chance level, even with high agreement", () => {
        // human 90 % yes, judge always yes: agreement 0.9, kappa 0.
        const r = cohensKappa(pairs([[true, true, 27], [false, true, 3]]));
        expect(r.agreement).toBeCloseTo(0.9, 10);
        expect(r.kappa).toBeCloseTo(0, 10);
    });
    it("matches a hand computation", () => {
        // po = 0.8; h = 0.6, j = 0.6 → pe = 0.36 + 0.16 = 0.52 → κ = 0.28 / 0.48
        const r = cohensKappa(pairs([[true, true, 5], [false, false, 3], [true, false, 1], [false, true, 1]]));
        expect(r.agreement).toBeCloseTo(0.8, 10);
        expect(r.kappa).toBeCloseTo(0.28 / 0.48, 10);
    });
    it("is null when every label is the same, and for no labels", () => {
        expect(cohensKappa(pairs([[true, true, 30]])).kappa).toBeNull();
        expect(cohensKappa([])).toEqual({ n: 0, agreement: null, kappa: null });
    });
    it("validates only with n ≥ 30, agreement ≥ 0.85 and κ ≥ 0.6", () => {
        expect(judgeValidated({ n: 30, agreement: 0.9, kappa: 0.7 })).toBe(true);
        expect(judgeValidated({ n: 29, agreement: 1, kappa: 1 })).toBe(false);
        expect(judgeValidated({ n: 30, agreement: 0.84, kappa: 0.7 })).toBe(false);
        expect(judgeValidated({ n: 30, agreement: 0.9, kappa: 0.59 })).toBe(false);
        expect(judgeValidated({ n: 30, agreement: 0.9, kappa: null })).toBe(false);
        expect(judgeValidated({ n: 30, agreement: null, kappa: 0.9 })).toBe(false);
    });
});

describe("paretoFront", () => {
    it("matches the hand answer on six points", () => {
        const pts = [
            { id: "a", cost: 1, accuracy: 0.6 },
            { id: "b", cost: 2, accuracy: 0.55 }, // dominated by a
            { id: "c", cost: 2, accuracy: 0.7 },
            { id: "d", cost: 5, accuracy: 0.7 }, // same accuracy, dearer: dominated
            { id: "e", cost: 8, accuracy: 0.82 },
            { id: "f", cost: 1, accuracy: 0.5 }, // same cost as a, worse
        ];
        expect(paretoFront(pts).map((p) => p.id)).toEqual(["a", "c", "e"]);
        expect(paretoFront([])).toEqual([]);
    });
});
