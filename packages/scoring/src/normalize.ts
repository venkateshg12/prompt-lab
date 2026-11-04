/*
  Fair, not forgiving: Unicode form (NFKC), case, punctuation and repeated whitespace don't change
  meaning, so they are removed. No fuzzy matching: "Frontend Developer Intern" ≠ "Frontend Intern".
 */
export const normalizeText = (v: string): string =>
    v.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();

/** Gentler than normalizeText: keeps c++, c#, node.js intact. Synonyms are applied after normalising. */
export const normalizeSkill = (v: string, synonyms: Record<string, string>): string => {
    const base = v.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
    return synonyms[base] ?? base;
};
