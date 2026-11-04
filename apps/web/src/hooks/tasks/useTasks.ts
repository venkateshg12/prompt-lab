import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createTask, getTask, listTasks, updateTask } from "@/api/task";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";
import type { CreateTaskBody, UpdateTaskBody } from "@repo/types";

export const useTasks = () => {
  const { org } = useCurrentOrg();
  return useQuery({ queryKey: ["tasks", org?.id], queryFn: () => listTasks(org!.id), enabled: Boolean(org?.id) });
};

export const useTask = (taskId: string) => {
  const { org } = useCurrentOrg();
  return useQuery({ queryKey: ["task", org?.id, taskId], queryFn: () => getTask(org!.id, taskId), enabled: Boolean(org?.id) });
};

export const useCreateTask = () => {
  const { org } = useCurrentOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskBody) => createTask(org!.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
};

export const useUpdateTask = (taskId: string) => {
  const { org } = useCurrentOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTaskBody) => updateTask(org!.id, taskId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["task"] });
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
};
