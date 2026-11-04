import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPrompt, listPrompts, newPromptVersion, previewPrompt, updatePrompt } from "@/api/prompt";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";
import type { NewVersionBody, PromptBody } from "@repo/types";

export const usePrompts = (taskId: string) => {
  const { org } = useCurrentOrg();
  return useQuery({ queryKey: ["prompts", org?.id, taskId], queryFn: () => listPrompts(org!.id, taskId), enabled: Boolean(org?.id) });
};

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["prompts"] });
    void qc.invalidateQueries({ queryKey: ["prompt-preview"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };
};

export const useCreatePrompt = (taskId: string) => {
  const { org } = useCurrentOrg();
  const done = useInvalidate();
  return useMutation({ mutationFn: (body: PromptBody) => createPrompt(org!.id, taskId, body), onSuccess: done });
};

export const useUpdatePrompt = (taskId: string) => {
  const { org } = useCurrentOrg();
  const done = useInvalidate();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: NewVersionBody }) => updatePrompt(org!.id, taskId, id, body), onSuccess: done });
};

export const useNewPromptVersion = (taskId: string) => {
  const { org } = useCurrentOrg();
  const done = useInvalidate();
  return useMutation({ mutationFn: ({ id, body }: { id: string; body: NewVersionBody }) => newPromptVersion(org!.id, taskId, id, body), onSuccess: done });
};

/** The server's renderer, not a client copy: the preview can't drift from what the model receives. */
export const usePromptPreview = (taskId: string, promptId: string | undefined, exampleId: string | undefined) => {
  const { org } = useCurrentOrg();
  return useQuery({
    queryKey: ["prompt-preview", org?.id, taskId, promptId, exampleId],
    queryFn: () => previewPrompt(org!.id, taskId, promptId!, exampleId!),
    enabled: Boolean(org?.id && promptId && exampleId),
  });
};
