import API from "@/lib/api";
import type { SuccessResponse } from "@/types";

export interface ExampleItem {
  id: string; ref: string; split: "dev" | "test"; tags: string[]; unsplit: boolean; input: string; expected: Record<string, unknown> | null;
  expectedHidden: boolean; publicInput: boolean; secondLabel: Record<string, unknown> | null; notes: string | null; revision: number;
}
export interface ExampleFilters { split?: "dev" | "test"; tag?: string; q?: string }
export interface ImportReport {
  dryRun: boolean; valid: number; new: number; changed: number; unchanged: number;
  invalid: { line: number; ref?: string; issues: string[] }[];
}
export interface Agreement {
  examples: number;
  fields: { key: string; agree: number; total: number; rate: number | null; disagreements: string[] }[];
}

export const listExamples = async (orgId: string, taskId: string, f: ExampleFilters & { cursor?: string; limit?: number }) => {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ limit: 50, ...f })) if (v !== undefined && v !== "") params.set(k, String(v));
  return (await API.get<SuccessResponse<ExampleItem[]>>(`/orgs/${orgId}/tasks/${taskId}/examples?${params}`)).data;
};
export const updateExample = async (orgId: string, taskId: string, id: string, body: Partial<Pick<ExampleItem, "input" | "expected" | "split" | "tags" | "notes" | "publicInput">>) =>
  (await API.patch<SuccessResponse<ExampleItem>>(`/orgs/${orgId}/tasks/${taskId}/examples/${id}`, body)).data;
export const importExamples = async (orgId: string, taskId: string, body: { format: "jsonl" | "csv"; content: string; dryRun: boolean }) =>
  (await API.post<SuccessResponse<ImportReport>>(`/orgs/${orgId}/tasks/${taskId}/examples/import`, body)).data;
export const autoSplit = async (orgId: string, taskId: string) =>
  (await API.post<SuccessResponse<{ assigned: number; dev: number; test: number }>>(`/orgs/${orgId}/tasks/${taskId}/examples/split`, {})).data;
export const setSecondLabel = async (orgId: string, taskId: string, id: string, label: unknown) =>
  (await API.put<SuccessResponse<ExampleItem>>(`/orgs/${orgId}/tasks/${taskId}/examples/${id}/second-label`, { label })).data;
export const getAgreement = async (orgId: string, taskId: string) =>
  (await API.get<SuccessResponse<Agreement>>(`/orgs/${orgId}/tasks/${taskId}/examples/agreement`)).data;
