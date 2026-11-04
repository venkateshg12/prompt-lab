/*
  JSON with object keys sorted at every level. PostgreSQL `jsonb` does not preserve key order, so a
  value read back from the database stringifies differently from the one that was written; comparing
  or hashing JSON must always go through this.
 */
const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([k, v]) => [k, canonical(v)])
        );
    }
    return value;
};

export const stableStringify = (value: unknown): string => JSON.stringify(canonical(value));

export const sameJson = (a: unknown, b: unknown): boolean => stableStringify(a) === stableStringify(b);
