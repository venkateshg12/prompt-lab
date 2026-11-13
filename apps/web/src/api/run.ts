import API from "@/lib/api";
import type { SuccessResponse } from "@/types";
import type { CreateRun, RunProgress } from "@repo/types";

export type RunStatus = RunProgress["status"];

export interface RunListItem {
  id: string; taskId: string; taskVersion: number; split: "dev" | "test"; repeats: number; status: RunStatus; testReused: boolean;
  totalCells: number; doneCells: number; errorCells: number; notes: string | null; createdAt: string; finishedAt: string | null;
  task: { name: string; slug: string };
  grid: { prompts: number; models: number; examples: number; repeats: number };
  costUsdMicros: number;
}

export interface RunDetail extends Omit<RunListItem, "grid" | "task"> {
  task: { name: string; slug: string; version: number };
  costUsdMicros: number; skippedCells: number;
  variants: { id: string; versionId: string; technique: string; modelKey: string; modelLabel: string; scored: number; errors: number; skipped: number }[];
  progressByModel: { modelKey: string; modelLabel: string; total: number; done: number; errors: number; costUsdMicros: number }[];
}

export interface RunEstimate {
  totalCells: number; cells: number; skippedCells: number; examples: number;
  variants: { promptVersion: string; modelKey: string; cells: number; skippedCells: number; estimateUsdMicros: number; priceCheckedOn: string }[];
  totalUsdMicros: number; estimatedCostUsdMicros: number;
  budget: { limit: number; spent: number; remaining: number };
  withinBudget: boolean; testReused: boolean; datasetHash: string;
}

export type RunBody = Pick<CreateRun, "taskId" | "promptVersionIds" | "modelKeys" | "split" | "repeats"> & { notes?: string; confirmFinal?: boolean };

export const listRuns = async (orgId: string, params: { taskId?: string; cursor?: string }) =>
  (await API.get<SuccessResponse<RunListItem[]>>(`/orgs/${orgId}/runs`, { params: { limit: 25, ...params } })).data;
export const getRun = async (orgId: string, runId: string) => (await API.get<SuccessResponse<RunDetail>>(`/orgs/${orgId}/runs/${runId}`)).data;
export const estimateRun = async (orgId: string, body: RunBody) => (await API.post<SuccessResponse<RunEstimate>>(`/orgs/${orgId}/runs/estimate`, body)).data;
export const createRun = async (orgId: string, body: RunBody) => (await API.post<SuccessResponse<{ id: string }>>(`/orgs/${orgId}/runs`, body)).data;
export const cancelRun = async (orgId: string, runId: string) => (await API.post<SuccessResponse<{ id: string }>>(`/orgs/${orgId}/runs/${runId}/cancel`)).data;
