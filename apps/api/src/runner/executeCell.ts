import { scoreOutput } from "@repo/scoring";
import type { FieldRule } from "@repo/types";
import type { ModelConfig } from "../config/models.config";
import type { CompleteResult, Provider } from "../ai/types";
import type { complete as completeFn } from "../ai/complete";
import type { Price } from "../utils/cost";
import { userTurnFor, type VariantSnapshot } from "./snapshot";

export type CellContext = {
    model: ModelConfig;
    modelStructured: "supported" | "unsupported" | "untested";
    price: Price; // from Run.pricesSnapshot, never the live registry
    snapshot: VariantSnapshot;
    fields: FieldRule[];
    input: string;
    expected: Record<string, unknown>;
};

/** What a cell produced; persistCell turns it into a Result row. */
export type CellOutcome = {
    status: "scored" | "error" | "skipped";
    rawOutput?: string;
    extractedText?: string | null;
    parsedJson?: Record<string, unknown> | null;
    validJson?: boolean;
    schemaValid?: boolean;
    fieldScores?: { key: string; score: number; reason: string }[];
    fieldDetails?: Record<string, unknown>;
    overallScore?: number;
    exactMatch?: boolean;
    finishReason?: CompleteResult["finishReason"];
    inputTokens?: number;
    outputTokens?: number;
    costUsdMicros?: number;
    latencyMs?: number;
    attempts?: number;
    error?: string;
};

export type CompleteFn = typeof completeFn;

/*
  The shared core: the worker, the CLI and the tests all call this. Render the final user turn from the
  run's snapshot, call the model, score the raw text. The text is never repaired.
 */
export const executeCell = async (
    cell: CellContext,
    deps: { complete: CompleteFn; apiKey?: string; signal?: AbortSignal; adapter?: Provider }
): Promise<CellOutcome> => {
    const snap = cell.snapshot;
    // A structured prompt on a model whose schema mode is unsupported is "n/a", never a fake number.
    if (snap.technique === "structured" && cell.modelStructured === "unsupported" && cell.model.provider !== "fake") {
        return { status: "skipped", error: "structured_unsupported" };
    }
    const call = await deps.complete(
        cell.model,
        cell.price,
        {
            system: snap.system,
            messages: [...snap.priorTurns, { role: "user", content: userTurnFor(snap, cell.input) }],
            structured: snap.structured,
            temperature: snap.temperature,
            maxTokens: snap.maxTokens,
        },
        { apiKey: deps.apiKey, signal: deps.signal, adapter: deps.adapter }
    );
    const s = scoreOutput({ rawText: call.text, technique: snap.technique, fields: cell.fields, expected: cell.expected });
    return {
        status: "scored",
        rawOutput: call.text,
        extractedText: s.extractedText,
        parsedJson: s.parsed,
        validJson: s.validJson,
        schemaValid: s.schemaValid,
        fieldScores: s.fieldScores,
        fieldDetails: s.fieldDetails,
        overallScore: s.overallScore,
        exactMatch: s.exactMatch,
        finishReason: call.finishReason,
        inputTokens: call.usage.inputTokens,
        outputTokens: call.usage.outputTokens,
        costUsdMicros: call.costUsdMicros, // complete() priced it with the run's snapshot
        latencyMs: call.latencyMs,
        attempts: call.attempts,
    };
};
