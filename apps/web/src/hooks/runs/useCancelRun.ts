import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelRun } from "@/api/run";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

export const useCancelRun = (runId: string) => {
  const { org } = useCurrentOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => cancelRun(org!.id, runId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["run", org?.id, runId] });
      void qc.invalidateQueries({ queryKey: ["runs"] });
    },
  });
};
