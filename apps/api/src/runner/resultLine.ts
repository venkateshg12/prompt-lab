import { resultLineSchema, type ResultLine } from "@repo/types";

export type ResultForExport = {
    runId: string;
    split: "dev" | "test";
    promptKey: string;
    promptVersion: number;
    modelKey: string;
    exampleRef: string;
    exampleTags: string[];
    repeatIndex: number;
    status: "scored" | "error" | "skipped";
    rawOutput?: string | null;
    validJson?: boolean | null;
    schemaValid?: boolean | null;
    exactMatch?: boolean | null;
    overallScore?: number | null;
    fieldScores?: { key: string; score: number }[] | null;
    fieldDetails?: unknown;
    inputTokens?: number | null;
    outputTokens?: number | null;
    costUsdMicros?: number | null;
    latencyMs?: number | null;
    error?: string | null;
    testReused: boolean;
    completedAt: Date;
};

/*
  A Result as one line of the Playbook's contract (playbook-contract.md §1). Keys above the "extras"
  comment are binding and are never removed or renamed. Every line is validated against the contract's
  schema before it leaves, so a break fails here, not in the Playbook's importer weeks later.
 */
export const toResultLine = (r: ResultForExport) => {
    const line = {
        runId: r.runId,
        split: r.split,
        promptVersion: `${r.promptKey}@${r.promptVersion}`,
        modelKey: r.modelKey,
        exampleId: r.exampleRef,
        repeat: r.repeatIndex,
        status: r.status,
        rawOutput: r.rawOutput ?? null,
        validJson: r.validJson ?? null,
        schemaValid: r.schemaValid ?? null,
        exactMatch: r.exactMatch ?? null,
        overallScore: r.overallScore ?? null,
        fieldScores: r.fieldScores?.map(({ key, score }) => ({ key, score })) ?? null,
        outputTokens: r.outputTokens ?? null,
        costUsdMicros: r.costUsdMicros ?? null,
        latencyMs: r.latencyMs ?? null,
        completedAt: r.completedAt.toISOString(),
        // extras the contract allows (§1)
        tags: r.exampleTags,
        fieldDetails: r.fieldDetails ?? null,
        inputTokens: r.inputTokens ?? null,
        error: r.error ?? null,
        testReused: r.testReused,
    };
    resultLineSchema.parse(line); // throws on a contract break
    return line as ResultLine & typeof line;
};
