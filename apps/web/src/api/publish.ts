import API from "@/lib/api";
import { API_URL } from "@/constants/env";
import type { SuccessResponse } from "@/types";
import type { FieldRule } from "@repo/types";
import type { SummaryVariant } from "@/api/results";

export type PublishOptions = { title: string | null; includeNotes: boolean };
export interface PublishedEntry { runId: string; slug: string; publishedAt: string; options: PublishOptions | null; split: "dev" | "test"; taskName: string }

/** GET /public/runs/:slug — everything a published page may show, and nothing more. */
export interface PublicRun {
  slug: string; title: string; publishedAt: string;
  run: { id: string; split: "dev" | "test"; repeats: number; status: string; testReused: boolean; taskVersion: number; totalCells: number; createdAt: string; finishedAt: string | null; notes: string | null };
  task: { name: string; slug: string; version: number; fields: FieldRule[] };
  prompts: { ref: string; technique: string; system: string; template: string }[];
  models: { key: string; label: string; provider: string; price: { inputUsdMicrosPerMTok: number; outputUsdMicrosPerMTok: number; priceCheckedOn: string; priceNote?: string | null } | null }[];
  tags: string[];
  variants: Omit<SummaryVariant, "price">[];
  caveats: string[];
  markdown: string;
}
export interface PublicRunListItem { slug: string; title: string; taskName: string; split: "dev" | "test"; publishedAt: string; best: { prompt: string; model: string; overall: number } | null }

export const exportUrl = (orgId: string, runId: string, file: "results.jsonl" | "summary.csv" | "results.csv", includeText = false) =>
  `${API_URL}/orgs/${orgId}/runs/${runId}/export/${file}${file === "results.csv" && includeText ? "?includeText=true" : ""}`;
export const getMarkdown = async (orgId: string, runId: string) => (await API.get<SuccessResponse<{ markdown: string }>>(`/orgs/${orgId}/runs/${runId}/export/markdown`)).data;
export const publishRun = async (orgId: string, runId: string, body: { title?: string; includeNotes: boolean }) =>
  (await API.post<SuccessResponse<{ slug: string; publishedAt: string; options: PublishOptions }>>(`/orgs/${orgId}/runs/${runId}/publish`, body)).data;
export const unpublishRun = async (orgId: string, runId: string) => (await API.delete<SuccessResponse<{ unpublished: boolean }>>(`/orgs/${orgId}/runs/${runId}/publish`)).data;
export const listOrgPublished = async (orgId: string) => (await API.get<SuccessResponse<PublishedEntry[]>>(`/orgs/${orgId}/runs/published`)).data;

/* Public reads use plain fetch: no cookies, no refresh interceptor. */
export const publicUrl = (path: string) => `${API_URL}/public${path}`;
