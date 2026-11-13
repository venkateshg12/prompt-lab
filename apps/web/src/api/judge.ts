import API from "@/lib/api";
import type { SuccessResponse } from "@/types";

export type Validation = { n: number; agreement: number | null; kappa: number | null; validated: boolean };
export type JudgeStats = { model: string; question: string; sameFamily: boolean; byVariant: Record<string, { judged: number; passed: number; errors: number }>; validation: Validation } | null;
export type StoredJudge = { model: string; status: "ok" | "judge_error"; pass: boolean | null; reason: string | null; raw: string | null; human?: { pass: boolean } };
export interface JudgedItem { resultId: string; exampleRef: string; variant: string; expected: Record<string, unknown>; parsedJson: Record<string, unknown> | null; judge: StoredJudge }

export const startJudge = async (orgId: string, runId: string, body: { modelKey: string; question?: string; limit?: number }) =>
  (await API.post<SuccessResponse<{ enqueued: number; model: string }>>(`/orgs/${orgId}/runs/${runId}/judge`, body)).data;
export const listJudged = async (orgId: string, runId: string, unlabelledOnly: boolean) =>
  (await API.get<SuccessResponse<JudgedItem[]>>(`/orgs/${orgId}/runs/${runId}/judge`, { params: { unlabelledOnly, limit: 50 } })).data;
export const setHuman = async (orgId: string, runId: string, resultId: string, pass: boolean) =>
  (await API.patch<SuccessResponse<StoredJudge>>(`/orgs/${orgId}/runs/${runId}/judge/${resultId}/human`, { pass })).data;
