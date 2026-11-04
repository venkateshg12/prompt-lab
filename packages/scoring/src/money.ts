import { PERIOD_TO_YEAR, type Money, type Period } from "@repo/types";

const CURRENCY: Record<string, string> = {
    "₹": "INR", rs: "INR", "rs.": "INR", inr: "INR",
    $: "USD", "us$": "USD", usd: "USD",
    "€": "EUR", eur: "EUR",
    "£": "GBP", gbp: "GBP",
};
export const normalizeCurrency = (c: string): string => CURRENCY[c.trim().toLowerCase()] ?? c.trim().toUpperCase();

export const yearly = (v: number | null, p: Period): number | null => (v === null ? null : v * PERIOD_TO_YEAR[p]);

const within = (pred: number | null, exp: number | null, tol: number): boolean => {
    if (pred === null && exp === null) return true;
    if (pred === null || exp === null) return false;
    return exp === 0 ? pred === 0 : Math.abs(pred - exp) <= tol * Math.abs(exp);
};

export type MoneyScore = { score: 0 | 1; reason: "match" | "null_expected" | "null_predicted" | "currency_mismatch" | "out_of_tolerance" };

/*
  Salary as ONE answer (scoring-rules.md §2): both null → 1; exactly one null → 0 (`null_expected` = the
  model invented a figure); a different currency → 0; otherwise both sides go to a per-year amount and
  min and max must EACH be within the tolerance. No partial credit.
 */
export const scoreMoney = (pred: Money | null, exp: Money | null, tol: number): MoneyScore => {
    if (pred === null && exp === null) return { score: 1, reason: "match" };
    if (exp === null) return { score: 0, reason: "null_expected" };
    if (pred === null) return { score: 0, reason: "null_predicted" };
    if (normalizeCurrency(pred.currency) !== normalizeCurrency(exp.currency)) return { score: 0, reason: "currency_mismatch" };
    const ok =
        within(yearly(pred.min, pred.period), yearly(exp.min, exp.period), tol) &&
        within(yearly(pred.max, pred.period), yearly(exp.max, exp.period), tol);
    return ok ? { score: 1, reason: "match" } : { score: 0, reason: "out_of_tolerance" };
};
