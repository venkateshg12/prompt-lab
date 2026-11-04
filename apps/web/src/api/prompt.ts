import API from "@/lib/api";
import type { SuccessResponse } from "@/types";
import type { NewVersionBody, PromptBody, Technique } from "@repo/types";

export interface PromptItem {
  id: string; key: string; version: number; versionId: string; technique: Technique; system: string; template: string;
  fewShotExampleIds: string[]; notes: string | null; frozen: boolean; frozenAt: string | null;
  history?: { id: string; version: number; versionId: string; frozenAt: string | null }[];
}
export interface PromptPreview {
  system: string; messages: { role: "user" | "assistant"; content: string }[];
  structured?: { name: string; schema: Record<string, unknown> }; maxTokens: number; fewShotStyle: string;
}

export const listPrompts = async (orgId: string, taskId: string) =>
  (await API.get<SuccessResponse<PromptItem[]>>(`/orgs/${orgId}/tasks/${taskId}/prompts`)).data;
export const createPrompt = async (orgId: string, taskId: string, body: PromptBody) =>
  (await API.post<SuccessResponse<PromptItem>>(`/orgs/${orgId}/tasks/${taskId}/prompts`, body)).data;
export const updatePrompt = async (orgId: string, taskId: string, id: string, body: NewVersionBody) =>
  (await API.patch<SuccessResponse<PromptItem>>(`/orgs/${orgId}/tasks/${taskId}/prompts/${id}`, body)).data;
export const newPromptVersion = async (orgId: string, taskId: string, id: string, body: NewVersionBody) =>
  (await API.post<SuccessResponse<PromptItem>>(`/orgs/${orgId}/tasks/${taskId}/prompts/${id}/versions`, body)).data;
export const previewPrompt = async (orgId: string, taskId: string, id: string, exampleId: string) =>
  (await API.get<SuccessResponse<PromptPreview>>(`/orgs/${orgId}/tasks/${taskId}/prompts/${id}/preview?exampleId=${exampleId}`)).data;
