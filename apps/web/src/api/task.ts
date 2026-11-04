import API from "@/lib/api";
import type { SuccessResponse } from "@/types";
import type { CreateTaskBody, FieldRule, UpdateTaskBody } from "@repo/types";

export interface TaskListItem {
  id: string; slug: string; name: string; description: string; version: number; updatedAt: string;
  fieldCount: number; devCount: number; testCount: number; promptCount: number;
  latestRun: { status: string; createdAt: string } | null;
}
export interface TaskDetail {
  id: string; slug: string; name: string; description: string; instructions: string; version: number; fields: FieldRule[];
}

export const listTasks = async (orgId: string) =>
  (await API.get<SuccessResponse<TaskListItem[]>>(`/orgs/${orgId}/tasks`)).data;
export const getTask = async (orgId: string, taskId: string) =>
  (await API.get<SuccessResponse<{ task: TaskDetail; jsonSchema: Record<string, unknown> }>>(`/orgs/${orgId}/tasks/${taskId}`)).data;
export const createTask = async (orgId: string, body: CreateTaskBody) =>
  (await API.post<SuccessResponse<{ task: TaskDetail }>>(`/orgs/${orgId}/tasks`, body)).data;
export const updateTask = async (orgId: string, taskId: string, body: UpdateTaskBody) =>
  (await API.patch<SuccessResponse<{ task: TaskDetail; versionBumped: boolean; version: number; runsAffected: number }>>(`/orgs/${orgId}/tasks/${taskId}`, body)).data;
