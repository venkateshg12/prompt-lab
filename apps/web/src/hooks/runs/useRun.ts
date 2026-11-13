import { useQuery } from "@tanstack/react-query";
import { getRun } from "@/api/run";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

/**
 * One run. While the SSE stream is healthy nothing polls: the stream patches this entry. Only when the
 * stream has been down for 10 s (`fallback`) does it poll, every 3 s, until the run is over.
 */
export const useRun = (runId: string, opts: { fallback?: boolean } = {}) => {
  const { org } = useCurrentOrg();
  return useQuery({
    queryKey: ["run", org?.id, runId],
    queryFn: () => getRun(org!.id, runId),
    enabled: Boolean(org?.id),
    refetchInterval: (q) => {
      const status = q.state.data?.data.status;
      return opts.fallback && (status === "queued" || status === "running") ? 3000 : false;
    },
  });
};
