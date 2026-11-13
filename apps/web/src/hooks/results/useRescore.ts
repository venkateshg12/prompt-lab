import { useMutation } from "@tanstack/react-query";
import { rescoreRun } from "@/api/results";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

/** Enqueues a re-score. The worker's `rescored` SSE message (useRunEvents) reloads the summary and the feed. */
export const useRescore = (runId: string) => {
  const { org } = useCurrentOrg();
  return useMutation({ mutationFn: () => rescoreRun(org!.id, runId) });
};
