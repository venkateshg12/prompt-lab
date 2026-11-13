import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listOrgPublished, publishRun, unpublishRun } from "@/api/publish";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

export const useOrgPublished = () => {
  const { org } = useCurrentOrg();
  return useQuery({ queryKey: ["published-admin", org?.id], queryFn: () => listOrgPublished(org!.id), enabled: Boolean(org?.id) });
};

export const usePublishRun = (runId: string) => {
  const { org } = useCurrentOrg();
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ["published-admin"] });
  return {
    publish: useMutation({ mutationFn: (body: { title?: string; includeNotes: boolean }) => publishRun(org!.id, runId, body), onSuccess: done }),
    unpublish: useMutation({ mutationFn: () => unpublishRun(org!.id, runId), onSuccess: done }),
  };
};
