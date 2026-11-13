import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createRun, type RunBody } from "@/api/run";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

export const useCreateRun = () => {
  const { org } = useCurrentOrg();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RunBody) => createRun(org!.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["runs"] });
      void qc.invalidateQueries({ queryKey: ["prompts"] }); // starting a run freezes the prompt versions it used
      void qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
};
