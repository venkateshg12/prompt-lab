# Phase 16 — The scoring library

## 1. Goal

Implement [../reference/scoring-rules.md](../reference/scoring-rules.md) as a **pure** TypeScript
library, `@repo/scoring`, with one entry point:

```ts
scoreOutput({ rawText, technique, fields, expected }) → {
  extractedText, validJson, schemaValid, parsed,
  fieldScores:  { key, score, reason }[],                       // exported to the Playbook as-is ({key, score} are binding)
  fieldDetails: Record<key, { expected, predicted, normExpected?, normPredicted?, precision?, recall? }>,
  overallScore, exactMatch
}
```

The worker (every cell), the CLI, re-scoring (Phase 18) and the web's re-score preview all call it. It
never repairs output, never calls a model, and has no I/O, clock or randomness. It's the most important
code in the project, so it gets the most tests.

## 2. What I will understand after this phase

1. Why a benchmark's scorer must be pure, deterministic and written before any run.
2. Text normalisation that's fair without being forgiving.
3. Set F1, and why precision and recall are stored next to it (the Playbook's Lesson 7 needs both).
4. Money normalisation: periods, currencies, the 5 % tolerance, and `null` as an answer.
5. Why every field score carries a **reason**: the error browser groups mistakes by it.
6. Where "stripping a code fence" ends and "repairing output" begins.

## 3. Prerequisites

- Phase 15 done (`packages/scoring` has `renderPrompt.ts`, `providerSchema.ts`).
- Phase 11's `@repo/types/fieldRules.ts` exports `FieldRule`, `Money`, `Period`, `answerSchemaFor`,
  `valueSchemaFor` (strict Zod per field kind).

## 4. Files

```
packages/scoring/
├── package.json                 ADAPT (Phase 00 skeleton: + "test": "vitest run", deps zod, @repo/types)
├── vitest.config.mts            NEW   (coverage: v8, thresholds { branches: 100 } on src/)
└── src/
    ├── extract.ts               NEW   (code fence; CoT <json> blocks)
    ├── normalize.ts             NEW   (text, skill)
    ├── money.ts                 NEW   (currency symbols, period → per year, tolerance)
    ├── fields.ts                NEW   (one scorer per rule kind; f1 with precision/recall)
    ├── score.ts                 NEW   (scoreOutput: the pipeline)
    ├── canonical.ts             NEW   (normalised answer, for consistency in Phase 18)
    ├── index.ts                 NEW   (public exports)
    └── __tests__/{extract,normalize,money,fields,score,canonical}.test.ts   NEW
```

No PaperTrail file is copied: `@pt-api/evals/metrics.ts` scores invoices with token Jaccard and
line-item matching. Read it for its *shape* (normalise, then compare per field, with a reason), not
its rules, which differ.

## 5. Concepts

**Fair, not forgiving.** Normalisation removes differences that don't change meaning: Unicode form
(NFKC), case, outer whitespace, punctuation and repeated spaces (`"Acme Labs."` = `"acme labs"`). It
does **not** do fuzzy matching: `"Frontend Developer Intern"` ≠ `"Frontend Intern"`. Fuzzy matching
would hide exactly the mistakes you're measuring. Skills are the exception, because a set has partial
credit built in: F1.

**Set F1, with its parts.** Expected `{react, typescript, css}`, predicted `{react, javascript, css,
communication}`: precision = 2/4, recall = 2/3, F1 = 2PR/(P+R) = 0.571. F1 punishes both padding and
omissions. The score stored is F1. **Precision and recall go into `fieldDetails.skills`**, because a
prompt that "looks thorough" can raise recall while precision falls faster, and F1 alone hides why.
Synonyms (`js → javascript`) apply to both sides **before** comparing. They come from the task's rule,
so the synonym table is part of the experiment and is versioned with the task.

**Money as one answer.** Salary is the hardest field and the most useful:
1. both `null` → 1 ("not stated" is a correct answer);
2. exactly one `null` → 0 (`null_expected` = the model **invented** a salary; `null_predicted` = it missed one);
3. currencies differ after normalising symbols (`₹`, `Rs`, `Rs.`, `INR` → `INR`; `$`, `US$`, `USD` → `USD`) → 0;
4. convert both sides to **per year**: hour × 2080, day × 260, week × 52, month × 12, year × 1;
5. `min` vs `min` and `max` vs `max`: both null passes, one null fails, else |pred − exp| ≤ 5 % × exp.

Both bounds must pass: **no partial credit**. "₹15k–25k/month" read as "per year" is wrong, however
close some arithmetic makes it look. **LPA** is handled by labelling, not by the scorer: "3–5 LPA" is
labelled `{ min: 300000, max: 500000, currency: "INR", period: "year" }`, and a model answering
`{ min: 25000, max: 41667, period: "month" }` normalises to the same yearly range and scores 1.

**Strict types.** `"25000"` (a string) for a number is `wrong_type` → 0, even when the value is
right. Following the output contract is part of the task, which is why valid-JSON %, schema-valid %
and accuracy are reported separately.

**Missing keys** score 0 (`reason: "missing"`) even when the expected value is `null`: the model
didn't follow the schema. That's written in `scoring-rules.md`. Change it there first if you disagree,
never silently in code.

**Reasons.** `match | mismatch | partial | missing | wrong_type | null_expected | null_predicted |
currency_mismatch | out_of_tolerance`. Phase 21's error browser groups by reason, and Phase 25's error
analysis ("LPA not converted" = `out_of_tolerance` on salary) starts there.

**A fence is presentation; anything else is repair.** The spec says "strip code fences first". So
`extract.ts` removes a ```` ```json ```` wrapper, and for CoT it takes the last `<json>` block. It never
removes prose around an object, closes brackets or deletes trailing commas. Write that sentence in
the README.

## 6. Steps

### 6.1 `extract.ts`

```ts
import type { Technique } from "@repo/types";

const FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;
const stripFence = (text: string) => {
    const m = text.trim().match(FENCE);
    return m ? m[1]! : text.trim();
};

/** The text the scorer will try to parse. No repair: if it isn't JSON, it isn't JSON. */
export const extractCandidate = (rawText: string, technique: Technique): string | null => {
    if (technique === "cot") {
        const blocks = [...rawText.matchAll(/<json>\s*([\s\S]*?)\s*<\/json>/gi)];
        return blocks.length === 0 ? null : stripFence(blocks[blocks.length - 1]![1]!);   // the LAST block
    }
    return stripFence(rawText);
};

export const parseObject = (candidate: string | null): Record<string, unknown> | null => {
    if (candidate === null) return null;
    try {
        const v = JSON.parse(candidate);
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch {
        return null;
    }
};
```

### 6.2 `normalize.ts`

```ts
export const normalizeText = (v: string) =>
    v.normalize("NFKC").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();

/** Gentler than normalizeText: keeps c++, c#, node.js intact. */
export const normalizeSkill = (v: string, synonyms: Record<string, string>) => {
    const base = v.normalize("NFKC").toLowerCase().trim().replace(/\s+/g, " ").replace(/[.,;:]+$/, "");
    return synonyms[base] ?? base;
};
```

`normalizeText("C++ Developer")` is `"c developer"`. That's fine for titles (both sides get it) and
wrong for skills, hence two functions.

### 6.3 `money.ts`

```ts
import type { Money, Period } from "@repo/types";

export const PER_YEAR: Record<Period, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };
const CURRENCY: Record<string, string> = { "₹": "INR", rs: "INR", "rs.": "INR", inr: "INR", $: "USD", "us$": "USD", usd: "USD", "€": "EUR", eur: "EUR", "£": "GBP", gbp: "GBP" };
export const normalizeCurrency = (c: string) => CURRENCY[c.trim().toLowerCase()] ?? c.trim().toUpperCase();

const within = (pred: number | null, exp: number | null, tol: number) => {
    if (pred === null && exp === null) return true;
    if (pred === null || exp === null) return false;
    return exp === 0 ? pred === 0 : Math.abs(pred - exp) <= tol * Math.abs(exp);
};
export const yearly = (v: number | null, p: Period) => (v === null ? null : v * PER_YEAR[p]);

export const scoreMoney = (pred: Money | null, exp: Money | null, tol: number) => {
    if (pred === null && exp === null) return { score: 1, reason: "match" } as const;
    if (exp === null) return { score: 0, reason: "null_expected" } as const;
    if (pred === null) return { score: 0, reason: "null_predicted" } as const;
    if (normalizeCurrency(pred.currency) !== normalizeCurrency(exp.currency)) return { score: 0, reason: "currency_mismatch" } as const;
    const ok = within(yearly(pred.min, pred.period), yearly(exp.min, exp.period), tol)
            && within(yearly(pred.max, pred.period), yearly(exp.max, exp.period), tol);
    return ok ? ({ score: 1, reason: "match" } as const) : ({ score: 0, reason: "out_of_tolerance" } as const);
};
```

### 6.4 `fields.ts`

```ts
import { valueSchemaFor, type FieldRule, type Money } from "@repo/types";
import { normalizeSkill, normalizeText } from "./normalize";
import { scoreMoney } from "./money";

export type Reason = "match" | "mismatch" | "partial" | "missing" | "wrong_type" | "null_expected" | "null_predicted" | "currency_mismatch" | "out_of_tolerance";
export type FieldScore = { key: string; score: number; reason: Reason };
export type FieldDetail = { expected: unknown; predicted: unknown; normExpected?: unknown; normPredicted?: unknown; precision?: number; recall?: number };

export const setScores = (P: Set<string>, E: Set<string>) => {
    if (P.size === 0 && E.size === 0) return { precision: 1, recall: 1, f1: 1 };
    const hit = [...P].filter((x) => E.has(x)).length;
    const precision = P.size === 0 ? 0 : hit / P.size;
    const recall = E.size === 0 ? 0 : hit / E.size;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { precision, recall, f1 };
};

export const scoreField = (rule: FieldRule, parsed: Record<string, unknown> | null, expected: Record<string, unknown>): [FieldScore, FieldDetail] => {
    const exp = expected[rule.key];
    if (!parsed || !(rule.key in parsed)) return [{ key: rule.key, score: 0, reason: "missing" }, { expected: exp, predicted: undefined }];
    const pred = parsed[rule.key];
    if (!valueSchemaFor(rule).safeParse(pred).success) return [{ key: rule.key, score: 0, reason: "wrong_type" }, { expected: exp, predicted: pred }];
    const base = { expected: exp, predicted: pred };

    switch (rule.kind) {
        case "text": {
            if (exp === null || pred === null) return nullCase(rule.key, exp, pred, base);
            const [a, b] = [normalizeText(pred as string), normalizeText(exp as string)];
            return [{ key: rule.key, score: a === b ? 1 : 0, reason: a === b ? "match" : "mismatch" }, { ...base, normExpected: b, normPredicted: a }];
        }
        case "enum":
        case "integer":
            return [{ key: rule.key, score: pred === exp ? 1 : 0, reason: pred === exp ? "match" : "mismatch" }, base];
        case "set_f1": {
            const norm = (xs: unknown) => new Set(((xs as string[] | null) ?? []).map((s) => normalizeSkill(s, rule.synonyms)).filter(Boolean));
            const [P, E] = [norm(pred), norm(exp)];
            const { precision, recall, f1 } = setScores(P, E);
            const reason: Reason = f1 === 1 ? "match" : f1 === 0 ? "mismatch" : "partial";
            return [{ key: rule.key, score: f1, reason }, { ...base, normExpected: [...E].sort(), normPredicted: [...P].sort(), precision, recall }];
        }
        case "money": {
            const { score, reason } = scoreMoney(pred as Money | null, exp as Money | null, rule.tolerance ?? 0.05);
            return [{ key: rule.key, score, reason }, base];
        }
    }
};

const nullCase = (key: string, exp: unknown, pred: unknown, base: FieldDetail): [FieldScore, FieldDetail] =>
    exp === null && pred === null
        ? [{ key, score: 1, reason: "match" }, base]
        : [{ key, score: 0, reason: exp === null ? "null_expected" : "null_predicted" }, base];
```

### 6.5 `score.ts` and `canonical.ts`

```ts
/** Score one answer object against another with the task's rules (used for second-label agreement, Phase 24). */
export const scoreFields = (fields: FieldRule[], answer: Record<string, unknown> | null, expected: Record<string, unknown>) => ({
    fields: fields.map((rule) => ({ key: rule.key, ...scoreField(rule, answer, expected) })),
});

export const scoreOutput = ({ rawText, technique, fields, expected }: ScoreInput): ScoreResult => {
    const extractedText = extractCandidate(rawText, technique);
    const parsed = parseObject(extractedText);
    const schemaValid = parsed !== null && answerSchemaFor(fields).safeParse(parsed).success;
    const pairs = fields.map((rule) => scoreField(rule, parsed, expected));
    const fieldScores = pairs.map(([s]) => s);
    const overallScore = fieldScores.reduce((sum, f) => sum + f.score, 0) / fieldScores.length;
    return {
        extractedText, parsed, validJson: parsed !== null, schemaValid,
        fieldScores, fieldDetails: Object.fromEntries(pairs.map(([s, d]) => [s.key, d])),
        overallScore, exactMatch: fieldScores.every((f) => f.score === 1),
    };
};

/** Equal for two answers that would score identically on every field: consistency (Phase 18). */
export const canonicalAnswer = (fields: FieldRule[], parsed: Record<string, unknown> | null): string | null =>
    parsed === null ? null : JSON.stringify(fields.map((rule) => {
        const v = parsed[rule.key];
        if (v === undefined) return [rule.key, "__missing__"];
        if (rule.kind === "text" && typeof v === "string") return [rule.key, normalizeText(v)];
        if (rule.kind === "set_f1" && Array.isArray(v)) return [rule.key, [...new Set(v.map((s) => normalizeSkill(String(s), rule.synonyms)))].sort()];
        if (rule.kind === "money" && v && typeof v === "object") {
            const m = v as Money;
            return [rule.key, { c: normalizeCurrency(m.currency ?? ""), min: yearly(m.min, m.period), max: yearly(m.max, m.period) }];
        }
        return [rule.key, v];
    }));
```

`schemaValid` is computed on the parsed object, and field scores are computed **even when it fails**
(scoring-rules.md §1 step 5): an extra key fails the schema but doesn't change any field score.

### 6.6 Tests (table-driven, Vitest)

```ts
// __tests__/money.test.ts — one `it.each` per table; the job-postings rule as the fixture
const INR = (min: number | null, max: number | null, period: Period) => ({ min, max, currency: "INR", period });
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
])("%s", (_, pred, exp, score, reason) => expect(scoreMoney(pred, exp, 0.05)).toEqual({ score, reason }));
```

The full case list (each a row in its file):

| Case | Expected |
| --- | --- |
| ```` ```json {…} ``` ```` | parsed (fence stripped) |
| `Here you go: {…}` | `validJson: false` (no repair) |
| `{"a":1,}` (trailing comma) | `validJson: false` |
| CoT with two `<json>` blocks | the second is used |
| CoT without a block | `validJson: false`, every field `missing` |
| `[ {…} ]` (array) | `validJson: false` |
| `"Acme Labs."` vs `"acme labs"` | match |
| `"Frontend Dev Intern"` vs `"Frontend Developer Intern"` | mismatch |
| skills `["JS","React.js","communication"]` vs `["javascript","react"]` | P = 2/3, R = 1, F1 = 0.8, `partial` |
| skills both empty | 1, P = R = 1 |
| skills predicted empty, expected `["react"]` | 0, P = 0, R = 0 |
| `experience_years_min: "2"` | 0 `wrong_type` |
| `remote: "WFH"` | 0 `wrong_type` (not in the enum) |
| missing `company` | 0 `missing`; `schemaValid: false` |
| extra key `notes` | `schemaValid: false`; field scores unchanged |
| the spec's example JSON vs itself | `overallScore: 1`, `exactMatch: true` |
| two answers differing only in skill order and title case | equal `canonicalAnswer` |
| salary monthly vs the same yearly amount | equal `canonicalAnswer` |

### Hand-off: Phase 12's agreement report

Replace the stand-in `same(a, b)` in `example.service.ts` `agreement()` with
`scoreField(rule, a, b) === 1`, so the double-labelling rate uses the same normalisation, synonyms and
tolerances as scoring (resolves Phase 12's `// Phase 16:` comment). Re-run the Phase 12 Verify
agreement step: rates can only go up (e.g. `"React.js"` vs `"react"` now agree).

## 7. Verify

```bash
pnpm --filter @repo/scoring test
# ✓ … all files pass
pnpm --filter @repo/scoring exec vitest run --coverage
# src/ … % Branch 100
grep -rnE "Date|Math\.random|fetch|process\.env|node:fs" packages/scoring/src --include=*.ts | grep -v __tests__
# (no output: the package is pure)
```

Read `scoring-rules.md` §1–§2 side by side with `score.ts` and `fields.ts`. Every rule there has a
test row here.

## 8. Definition of done

- [ ] `scoreOutput` implements `scoring-rules.md` exactly; rules doc and code agree line by line.
- [ ] Skills precision and recall are in `fieldDetails.skills` for every scored result.
- [ ] All table cases pass; 100 % branch coverage of `packages/scoring/src`.
- [ ] No I/O, clock or randomness in the package (the grep is empty).
- [ ] Commit: `feat(scoring): pure, tested scoring library`.

## 9. Interview angle

*"How do you score a list field like skills?"* Normalise, map synonyms, compare as sets: precision,
recall, F1, so padding and omissions both cost. I store precision and recall too, because one prompt
of mine raised recall and lost more precision, and F1 alone didn't show why. *"And salary?"* Both sides
to per-year in the same currency, 5 % tolerance, no partial credit, and `null` is an answer: a model
that invents a salary for "competitive" scores zero. The scorer is pure, fully tested, and never
repairs model output.
