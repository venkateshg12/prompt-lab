import API from "@/lib/api";
import type { SuccessResponse } from "@/types";
import type { JudgeStats } from "@/api/judge";

export type Interval = { value: number; ci: [number, number] };
export type Reason = "match" | "mismatch" | "partial" | "missing" | "wrong_type" | "null_expected" | "null_predicted" | "currency_mismatch" | "out_of_tolerance";

export interface VariantSummary {
  n: number; repeats: number; scored: number; errors: number; skipped: number; errorRate: number;
  metrics: Record<string, Interval | null>;
  repeatSpread: { min: number; max: number } | null;
  costUsdPer100: number | null; p50Ms: number | null; p95Ms: number | null;
}

export interface SummaryVariant {
  variantId: string; promptVersion: string; technique: string; modelKey: string; modelLabel: string;
  structured: "supported" | "unsupported" | "untested"; structuredProbedAt: string | null;
  price: { inputUsdMicrosPerMTok?: number; outputUsdMicrosPerMTok?: number; priceCheckedOn?: string } | null;
  summary: VariantSummary;
}

export interface RunSummary {
  run: { id: string; taskId: string; taskVersion: number; split: "dev" | "test"; repeats: number; status: string; testReused: boolean; notes: string | null; createdAt: string; finishedAt: string | null };
  tag: string | null;
  tags: string[];
  stale: { rules: boolean; labels: boolean };
  judge: JudgeStats;
  variants: SummaryVariant[];
}

export type FieldScore = { key: string; score: number; reason: Reason };
export type FieldDetail = { expected: unknown; predicted: unknown; normExpected?: unknown; normPredicted?: unknown; precision?: number; recall?: number };

export interface ResultItem {
  id: string; variantId: string; promptVersion: string; modelKey: string; exampleRef: string; tags: string[];
  input: string | null; inputHidden?: boolean; expected: Record<string, unknown> | null; repeat: number; status: "scored" | "error" | "skipped";
  rawOutput: string | null; extractedText: string | null; parsedJson: Record<string, unknown> | null;
  validJson: boolean | null; schemaValid: boolean | null; exactMatch: boolean | null; overallScore: number | null;
  fieldScores: FieldScore[] | null; fieldDetails: Record<string, FieldDetail> | null;
  latencyMs: number | null; costUsdMicros: number | null; inputTokens: number | null; outputTokens: number | null;
  finishReason: string | null; attempts: number; error: string | null;
}

export type Facets = { reasons: { reason: string; n: number }[]; tags: { tag: string; n: number }[] };
export type ResultsMeta = { hasMore: boolean; nextCursor: string | null; facets?: Facets };
export type ResultsFilters = { variant?: string; field?: string; reason?: string; tag?: string; failedOnly?: boolean };

export interface CompareSide {
  variantId: string; promptVersion: string; modelKey: string; modelLabel: string;
  results: (Pick<ResultItem, "id" | "status" | "rawOutput" | "extractedText" | "parsedJson" | "validJson" | "schemaValid" | "overallScore" | "fieldScores" | "fieldDetails" | "error"> & { repeatIndex: number })[];
}
export interface CompareResponse { example: { id: string; ref: string; input: string; expected: Record<string, unknown>; tags: string[] }; a: CompareSide; b: CompareSide }

export const getRunSummary = async (orgId: string, runId: string, tag?: string) =>
  (await API.get<SuccessResponse<RunSummary>>(`/orgs/${orgId}/runs/${runId}/summary`, { params: tag ? { tag } : {} })).data;

export const listResults = async (orgId: string, runId: string, f: ResultsFilters, cursor?: string) =>
  (await API.get<SuccessResponse<ResultItem[]> & { meta: ResultsMeta }>(`/orgs/${orgId}/runs/${runId}/results`, {
    params: { limit: 20, ...f, failedOnly: f.failedOnly ? "true" : undefined, cursor },
  })).data;

export const compareResults = async (orgId: string, runId: string, q: { example: string; a: string; b: string }) =>
  (await API.get<SuccessResponse<CompareResponse>>(`/orgs/${orgId}/runs/${runId}/compare`, { params: q })).data;

export const rescoreRun = async (orgId: string, runId: string) =>
  (await API.post<SuccessResponse<{ enqueued: boolean; jobId: string }>>(`/orgs/${orgId}/runs/${runId}/rescore`)).data;
