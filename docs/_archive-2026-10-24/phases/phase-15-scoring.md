# Phase 15 — The scoring library

## 1. Goal

Implement [../reference/scoring-rules.md](../reference/scoring-rules.md) as a **pure** TypeScript
library (`@repo/scoring`). One call:

```ts
scoreOutput({ rawText, technique, fields, expected }) → {
  extractedText, validJson, schemaValid, parsed,
  fieldScores: { key, score, reason, expected, predicted, normExpected, normPredicted }[],
  overallScore, exactMatch, canonicalAnswer
}
```

It's used by the worker (every cell), the CLI, re-scoring and the web's error browser. It never
repairs anything, never calls a model, and has no I/O. It's the most important code in the project,
so it gets the most tests.

## 2. What I will understand after this phase

1. Why a benchmark's scorer must be pure, deterministic and written before the runs.
2. Text normalisation that's fair without being forgiving.
3. Set F1 (precision, recall) and why skills use it instead of exact match.
4. Money normalisation: periods, currencies, tolerance, and null as an answer.
5. Why every field score carries a **reason**: that's what makes the error browser useful.

## 3. Prerequisites

Phase 14 done.

## 4. Files

```
packages/scoring/src/
├── extract.ts            NEW   (fences, CoT <json> blocks)
├── normalize.ts          NEW   (text, skill)
├── fields.ts             NEW   (one scorer per rule kind)
├── money.ts              NEW   (period conversion, tolerance)
├── score.ts              NEW   (scoreOutput: the pipeline)
├── canonical.ts          NEW   (normalised answer for consistency)
├── index.ts              ADAPT
└── __tests__/*.test.ts   NEW   (cases below)
```

## 5. Concepts

**Fair, not forgiving.** Normalisation removes differences that don't change meaning: case, outer
whitespace, punctuation (`"Acme Labs."` = `"acme labs"`), repeated spaces, Unicode forms (NFKC). It does
**not** do fuzzy matching. `"Frontend Developer Intern"` ≠ `"Frontend Intern"`. Fuzzy text matching
would hide exactly the mistakes you're trying to find. Skills are the exception, because a set has
partial credit built in: F1.

**F1 for sets.** Expected `{react, typescript, css}`, predicted `{react, javascript, css, communication}`:
- precision = 2/4 (two of the predicted are right);
- recall = 2/3 (two of the expected were found);
- F1 = 2PR/(P+R) = 0.571.

It penalises both padding ("communication" isn't a technical skill) and missing items. Synonyms
(`js → javascript`) apply to both sides **before** comparing, so the model isn't punished for
spelling a skill differently. They come from the task's rules, so the synonym table is part of the
experiment and is versioned.

**Money as one answer.** Salary is the hardest field and the most useful. The rule:
1. both `null` → 1 (correctly said "not stated");
2. exactly one `null` → 0 (invented or missed);
3. currencies differ → 0;
4. otherwise convert both to **per-year** in that currency: hour × 2080, day × 260, week × 52,
   month × 12, year × 1;
5. compare `min` with `min` and `max` with `max`: both null is OK, one null is wrong, otherwise
   |pred − exp| ≤ tolerance × exp.

Both bounds must pass for a score of 1. **No partial credit**: "₹15k–25k/month" read as
"₹15k–25k/year" is a wrong answer, however close some arithmetic says it is.

**Strict types.** The model must return the shape it was asked for: `"25000"` (string) for a number
is **wrong_type** → 0, even if the value is right. That is part of "following the output contract",
and it's why valid-JSON % and schema-valid % are reported separately from accuracy.

**Missing keys** score 0 (`reason: "missing"`), even if the expected value is `null`: the model
didn't follow the schema. That's a documented choice in `scoring-rules.md`. Change it there first if
you disagree, and never silently.

**Reasons.** Each field score carries
`reason ∈ { match, mismatch, missing, wrong_type, null_expected, null_predicted, currency_mismatch, out_of_tolerance, partial }`.
The error browser (Phase 20) groups mistakes by reason, and Phase 24's error analysis starts there.

## 6. Steps

### 6.1 `extract.ts`

```ts
const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

/** The text the scorer will try to parse. No repair: if it isn't JSON, it isn't JSON. */
export const extractCandidate = (rawText: string, technique: Technique): string | null => {
    const text = rawText.trim();
    if (technique === "cot") {
        const blocks = [...text.matchAll(/<json>\s*([\s\S]*?)\s*<\/json>/gi)];
        if (blocks.length === 0) return null;
        return stripFence(blocks[blocks.length - 1]![1]!);          // the LAST block is the final answer
    }
    return stripFence(text);
};

const stripFence = (text: string) => {
    const match = text.trim().match(FENCE);
    return match ? match[1]! : text.trim();
};

export const parseObject = (candidate: string | null): { ok: true; value: Record<string, unknown> } | { ok: false } => {
    if (candidate === null) return { ok: false };
    try {
        const value = JSON.parse(candidate);
        return value && typeof value === "object" && !Array.isArray(value) ? { ok: true, value } : { ok: false };
    } catch {
        return { ok: false };
    }
};
```

Stripping a code fence isn't repair: the spec says "strip code fences first", because a fence is
presentation, not content. Anything beyond that (trailing commas, closing brackets, picking an object
out of prose) **is** repair, and isn't done. Write that sentence in the README.

### 6.2 `normalize.ts`

```ts
export const normalizeText = (value: string) =>
    value.normalize("NFKC").toLowerCase()
        .replace(/[\p{P}\p{S}]+/gu, " ")      // punctuation and symbols → space
        .replace(/\s+/g, " ").trim();

export const normalizeSkill = (value: string, synonyms: Record<string, string>) => {
    const base = value.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
    return synonyms[base] ?? base;
};
```

> `normalizeText` turns `"C++ Developer"` into `"c developer"`. That's fine for comparing titles (both
> sides get the same treatment), but **not** for skills: hence the gentler `normalizeSkill`, which keeps
> `c++`, `c#`, `node.js`.

### 6.3 `money.ts`

```ts
export const PER_YEAR: Record<Period, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };

const bound = (pred: number | null, exp: number | null, tol: number): boolean => {
    if (pred === null && exp === null) return true;
    if (pred === null || exp === null) return false;
    if (exp === 0) return pred === 0;
    return Math.abs(pred - exp) <= tol * exp;
};

export const scoreMoney = (pred: Money | null, exp: Money | null, tol: number): { score: 0 | 1; reason: Reason } => {
    if (pred === null && exp === null) return { score: 1, reason: "match" };
    if (exp === null) return { score: 0, reason: "null_expected" };      // the model invented a salary
    if (pred === null) return { score: 0, reason: "null_predicted" };
    if (pred.currency.toUpperCase() !== exp.currency.toUpperCase()) return { score: 0, reason: "currency_mismatch" };
    const yearly = (v: number | null, p: Period) => (v === null ? null : v * PER_YEAR[p]);
    const ok = bound(yearly(pred.min, pred.period), yearly(exp.min, exp.period), tol)
            && bound(yearly(pred.max, pred.period), yearly(exp.max, exp.period), tol);
    return ok ? { score: 1, reason: "match" } : { score: 0, reason: "out_of_tolerance" };
};
```

### 6.4 `fields.ts`

```ts
export type FieldScore = {
    key: string; score: number; reason: Reason;
    expected: unknown; predicted: unknown; normExpected?: unknown; normPredicted?: unknown;
};

export const scoreField = (rule: FieldRule, parsed: Record<string, unknown> | null, expected: Record<string, unknown>): FieldScore => {
    const exp = expected[rule.key];
    if (!parsed || !(rule.key in parsed)) return { key: rule.key, score: 0, reason: "missing", expected: exp, predicted: undefined };
    const pred = parsed[rule.key];
    const typed = valueSchemaFor(rule).safeParse(pred);                  // from @repo/types (export it)
    if (!typed.success) return { key: rule.key, score: 0, reason: "wrong_type", expected: exp, predicted: pred };

    switch (rule.kind) {
        case "text": {
            if (exp === null || pred === null) return nullCase(rule.key, exp, pred);
            const [a, b] = [normalizeText(pred as string), normalizeText(exp as string)];
            return { key: rule.key, score: a === b ? 1 : 0, reason: a === b ? "match" : "mismatch", expected: exp, predicted: pred, normExpected: b, normPredicted: a };
        }
        case "enum":
        case "integer":
            return { key: rule.key, score: pred === exp ? 1 : 0, reason: pred === exp ? "match" : "mismatch", expected: exp, predicted: pred };
        case "set_f1": {
            const P = new Set((pred as string[]).map((s) => normalizeSkill(s, rule.synonyms)).filter(Boolean));
            const E = new Set((exp as string[]).map((s) => normalizeSkill(s, rule.synonyms)).filter(Boolean));
            const score = f1(P, E);
            return { key: rule.key, score, reason: score === 1 ? "match" : score === 0 ? "mismatch" : "partial",
                     expected: exp, predicted: pred, normExpected: [...E].sort(), normPredicted: [...P].sort() };
        }
        case "money": {
            const { score, reason } = scoreMoney(pred as Money | null, exp as Money | null, rule.tolerance);
            return { key: rule.key, score, reason, expected: exp, predicted: pred };
        }
    }
};

export const f1 = (P: Set<string>, E: Set<string>) => {
    if (P.size === 0 && E.size === 0) return 1;
    if (P.size === 0 || E.size === 0) return 0;
    const hit = [...P].filter((x) => E.has(x)).length;
    if (hit === 0) return 0;
    const precision = hit / P.size, recall = hit / E.size;
    return (2 * precision * recall) / (precision + recall);
};

const nullCase = (key: string, exp: unknown, pred: unknown): FieldScore =>
    exp === null && pred === null ? { key, score: 1, reason: "match", expected: exp, predicted: pred }
    : { key, score: 0, reason: exp === null ? "null_expected" : "null_predicted", expected: exp, predicted: pred };
```

(Export `valueSchemaFor` from `@repo/types/fieldRules.ts`, Phase 10.)

### 6.5 `score.ts` and `canonical.ts`

```ts
export const scoreOutput = ({ rawText, technique, fields, expected }: ScoreInput): ScoreResult => {
    const extractedText = extractCandidate(rawText, technique);
    const parsedResult = parseObject(extractedText);
    const parsed = parsedResult.ok ? parsedResult.value : null;
    const schemaValid = parsed !== null && answerSchemaFor(fields).safeParse(parsed).success;
    const fieldScores = fields.map((rule) => scoreField(rule, parsed, expected));
    const overallScore = fieldScores.reduce((sum, f) => sum + f.score, 0) / fieldScores.length;
    return {
        extractedText, validJson: parsed !== null, schemaValid, parsed, fieldScores, overallScore,
        exactMatch: fieldScores.every((f) => f.score === 1),
        canonicalAnswer: parsed ? canonicalAnswer(fields, parsed) : null,
    };
};

/** A string equal for two answers that score identically on every field — used for consistency. */
export const canonicalAnswer = (fields: FieldRule[], parsed: Record<string, unknown>) =>
    JSON.stringify(fields.map((rule) => {
        const v = parsed[rule.key];
        if (v === undefined) return [rule.key, "__missing__"];
        if (rule.kind === "text" && typeof v === "string") return [rule.key, normalizeText(v)];
        if (rule.kind === "set_f1" && Array.isArray(v)) return [rule.key, [...new Set(v.map((s) => normalizeSkill(String(s), rule.synonyms)))].sort()];
        if (rule.kind === "money" && v && typeof v === "object") {
            const m = v as Money;
            return [rule.key, { c: m.currency?.toUpperCase(), min: m.min === null ? null : m.min * PER_YEAR[m.period], max: m.max === null ? null : m.max * PER_YEAR[m.period] }];
        }
        return [rule.key, v];
    }));
```

### 6.6 Tests (Vitest, in `packages/scoring`)

| Case | Expected |
| --- | --- |
| ```` ```json {…} ``` ```` | parsed (fence stripped) |
| `Here you go: {…}` | `validJson: false` (no repair) |
| CoT with two `<json>` blocks | the second one is used |
| CoT without a block | `validJson: false` |
| `"Acme Labs."` vs `"acme labs"` | text match |
| `"Frontend Dev Intern"` vs `"Frontend Developer Intern"` | mismatch (no fuzzy) |
| skills `["JS","React.js","communication"]` vs `["javascript","react"]` (synonyms) | P = 2/3, R = 1, F1 = 0.8 |
| both skills empty | 1 |
| salary 3–5 LPA labelled `{300000,500000,INR,year}` vs predicted `{25000,41667,INR,month}` | 1 |
| the same with `{25000,41667,INR,year}` | 0 `out_of_tolerance` |
| expected null (competitive), predicted `{500000,…}` | 0 `null_expected` |
| `$50/hr` vs `{104000,…,USD,year}` | 1 |
| currency INR vs USD | 0 `currency_mismatch` |
| within 5 %: 25,000 vs 26,000/month | 1; 25,000 vs 27,000 → 0 |
| `experience_years_min: "2"` | 0 `wrong_type` |
| missing `company` key | 0 `missing`; `schemaValid: false` |
| extra key `notes` | `schemaValid: false`, but field scores unaffected |
| two answers differing only in skill order and title case | equal `canonicalAnswer` |

Aim for 100 % branch coverage of `packages/scoring` (`vitest run --coverage`). It's small and it's
the product.

## 7. Verify

```bash
pnpm --filter @repo/scoring test              # all green
pnpm --filter @repo/scoring exec vitest run --coverage   # 100 % branches
```

Then score the spec's example JSON against itself → `overallScore: 1`, `exactMatch: true`.

## 8. Definition of done

- [ ] `scoreOutput` implements `scoring-rules.md` exactly; the rules doc and the code agree (read them
      side by side).
- [ ] The table's cases pass; coverage 100 % of branches.
- [ ] No I/O, no randomness, no clock in the package (`grep -r "Date\|Math.random\|fetch" src` is empty).
- [ ] Commit: `feat(scoring): pure, tested scoring library`.

## 9. Interview angle

*"How do you score a list field like skills?"* Normalise, map synonyms, compare as sets with
precision, recall and F1, so padding and omissions both cost. *"And salary?"* Normalise both sides to
per-year in the same currency with a 5 % tolerance, and treat null as an answer: a model that invents
a salary for "competitive" scores zero. The scorer is pure and fully tested, and it never repairs model
output.
