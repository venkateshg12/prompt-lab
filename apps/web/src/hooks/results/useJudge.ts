import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listJudged, setHuman, startJudge } from "@/api/judge";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

export const useJudged = (runId: string, unlabelledOnly: boolean, enabled: boolean) => {
  const { org } = useCurrentOrg();
  return useQuery({ queryKey: ["judge", org?.id, runId, unlabelledOnly], queryFn: () => listJudged(org!.id, runId, unlabelledOnly), enabled: Boolean(org?.id) && enabled });
};

export const useJudgeActions = (runId: string) => {
  const { org } = useCurrentOrg();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["judge", org?.id, runId] });
    void qc.invalidateQueries({ queryKey: ["run-summary", org?.id, runId] });
  };
  return {
    start: useMutation({ mutationFn: (body: { modelKey: string; question?: string }) => startJudge(org!.id, runId, body), onSuccess: refresh }),
    label: useMutation({ mutationFn: (v: { resultId: string; pass: boolean }) => setHuman(org!.id, runId, v.resultId, v.pass), onSuccess: refresh }),
  };
};
