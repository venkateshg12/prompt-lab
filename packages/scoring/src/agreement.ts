/*
  Judge validation and the cost/accuracy front (Phase 26). Pure.

  Cohen's kappa κ = (pₒ − pₑ) / (1 − pₑ), pₑ = p_human_yes·p_judge_yes + p_human_no·p_judge_no. Agreement
  alone flatters a judge that says "pass" to everything when most results pass; kappa removes the chance
  part. When every label is the same, pₑ = 1 and kappa is undefined: null, shown as "no variation", never 1.
 */
export const cohensKappa = (pairs: { human: boolean; judge: boolean }[]) => {
    const n = pairs.length;
    if (n === 0) return { n, agreement: null, kappa: null };
    const po = pairs.filter((p) => p.human === p.judge).length / n;
    const h = pairs.filter((p) => p.human).length / n;
    const j = pairs.filter((p) => p.judge).length / n;
    const pe = h * j + (1 - h) * (1 - j);
    return { n, agreement: po, kappa: pe === 1 ? null : (po - pe) / (1 - pe) };
};

/** The rule decided before any number was seen: shown without a warning only with n ≥ 30, agreement ≥ 0.85 and κ ≥ 0.6. */
export const JUDGE_RULE = { minN: 30, minAgreement: 0.85, minKappa: 0.6 } as const;
export const judgeValidated = (v: { n: number; agreement: number | null; kappa: number | null }) =>
    v.n >= JUDGE_RULE.minN && (v.agreement ?? 0) >= JUDGE_RULE.minAgreement && v.kappa !== null && v.kappa >= JUDGE_RULE.minKappa;

/** Points no other point beats on both cost (lower) and accuracy (higher), cheapest first. */
export const paretoFront = <T extends { cost: number; accuracy: number }>(points: T[]): T[] => {
    const sorted = [...points].sort((a, b) => a.cost - b.cost || b.accuracy - a.accuracy);
    const front: T[] = [];
    let best = -Infinity;
    for (const p of sorted) {
        if (p.accuracy > best) {
            front.push(p);
            best = p.accuracy;
        }
    }
    return front;
};
