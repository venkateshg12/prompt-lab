import type { FieldRule, Money } from "@repo/types";
import { normalizeCurrency, yearly } from "./money";
import { normalizeSkill, normalizeText } from "./normalize";

/*
  Equal for two answers that would score identically on every field, so "consistency" (Phase 18) counts
  re-runs that give the same normalised answer, not byte-identical text.
 */
export const canonicalAnswer = (fields: FieldRule[], parsed: Record<string, unknown> | null): string | null =>
    parsed === null
        ? null
        : JSON.stringify(
              fields.map((rule) => {
                  const v = parsed[rule.key];
                  if (v === undefined) return [rule.key, "__missing__"];
                  if (rule.kind === "text" && typeof v === "string") return [rule.key, normalizeText(v)];
                  if (rule.kind === "set_f1" && Array.isArray(v)) {
                      return [rule.key, [...new Set(v.map((s) => normalizeSkill(String(s), rule.synonyms)))].sort()];
                  }
                  if (rule.kind === "money" && v && typeof v === "object") {
                      const m = v as Money;
                      return [rule.key, { c: normalizeCurrency(String(m.currency ?? "")), min: yearly(m.min, m.period), max: yearly(m.max, m.period) }];
                  }
                  return [rule.key, v];
              })
          );
