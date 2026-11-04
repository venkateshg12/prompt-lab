import { answerSchemaFor, type FieldRule, type Technique } from "@repo/types";
import { extractCandidate, parseObject } from "./extract";
import { scoreField, type FieldDetail, type FieldScore } from "./fields";

export type ScoreInput = {
    rawText: string;
    technique: Technique;
    fields: FieldRule[];
    expected: Record<string, unknown>;
};

export type ScoreResult = {
    extractedText: string | null;
    parsed: Record<string, unknown> | null;
    validJson: boolean;
    schemaValid: boolean;
    fieldScores: FieldScore[];
    fieldDetails: Record<string, FieldDetail>;
    overallScore: number;
    exactMatch: boolean;
};

/** Score an answer OBJECT against a label with the task's rules (also used for second-label agreement). */
export const scoreAnswer = (fields: FieldRule[], answer: Record<string, unknown> | null, expected: Record<string, unknown>) => {
    const pairs = fields.map((rule) => scoreField(rule, answer, expected));
    const fieldScores = pairs.map(([s]) => s);
    return {
        fieldScores,
        fieldDetails: Object.fromEntries(pairs.map(([s, d]) => [s.key, d])) as Record<string, FieldDetail>,
        overallScore: fieldScores.reduce((sum, f) => sum + f.score, 0) / fieldScores.length,
        exactMatch: fieldScores.every((f) => f.score === 1),
    };
};

/*
  The whole pipeline of scoring-rules.md §1 for one raw model output: extract, parse, schema, fields,
  overall, exact match. Pure: no repair, no model call, no I/O, no clock, no randomness. Field scores
  are computed even when the schema check fails (an extra key fails the schema but changes no score).
 */
export const scoreOutput = ({ rawText, technique, fields, expected }: ScoreInput): ScoreResult => {
    const extractedText = extractCandidate(rawText, technique);
    const parsed = parseObject(extractedText);
    const schemaValid = parsed !== null && answerSchemaFor(fields).safeParse(parsed).success;
    return { extractedText, parsed, validJson: parsed !== null, schemaValid, ...scoreAnswer(fields, parsed, expected) };
};
