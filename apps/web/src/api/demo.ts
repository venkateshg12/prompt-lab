import { API_URL } from "@/constants/env";
import { demoVisitorId } from "@/lib/providerKey";
import type { FieldDetail, FieldScore, VariantSummary } from "@/api/results";

export interface DemoOptions {
  variants: { promptVersion: string; technique: string; modelKey: string; modelLabel: string; provider: string }[];
  examples: { ref: string; preview: string; tags: string[] }[];
}
export interface DemoResult {
  exampleRef: string; input: string; expected: Record<string, unknown>; tags: string[];
  status: "scored" | "error" | "skipped"; rawOutput?: string; extractedText?: string | null; parsedJson?: Record<string, unknown> | null;
  validJson?: boolean; schemaValid?: boolean; exactMatch?: boolean; overallScore?: number; fieldScores?: FieldScore[]; fieldDetails?: Record<string, FieldDetail>;
  inputTokens?: number; outputTokens?: number; costUsdMicros?: number; latencyMs?: number; finishReason?: string; attempts?: number; error?: string; outcome?: string;
}
export interface DemoResponse { promptVersion: string; modelKey: string; modelLabel: string; technique: string; summary: VariantSummary; results: DemoResult[] }

export class DemoError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

/* Plain fetch, no credentials: the demo is anonymous, and the key travels in one header of one request. */
export const runDemo = async (body: { slug: string; promptVersion: string; modelKey: string; exampleRefs: string[] }, key: string): Promise<DemoResponse> => {
  const res = await fetch(`${API_URL}/demo/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Provider-Key": key, "X-Lab-Visitor": demoVisitorId() },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { data?: DemoResponse; errors?: { message: string; code?: string }[] } | null;
  if (!res.ok || !json?.data) throw new DemoError(res.status, json?.errors?.[0]?.message ?? "The demo couldn't run.", json?.errors?.[0]?.code);
  return json.data;
};

export const getDemoOptions = async (slug: string): Promise<DemoOptions> => {
  const res = await fetch(`${API_URL}/demo/runs/${encodeURIComponent(slug)}/options`);
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { data: DemoOptions }).data;
};
