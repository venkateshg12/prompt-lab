import { useInfiniteQuery } from "@tanstack/react-query";
import { listRuns } from "@/api/run";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

/** A cursor list of runs: the whole workspace, or one task's. Active runs refresh slowly so a list left open still moves. */
export const useRuns = (taskId?: string) => {
  const { org } = useCurrentOrg();
  return useInfiniteQuery({
    queryKey: ["runs", org?.id, taskId ?? "all"],
    queryFn: ({ pageParam }) => listRuns(org!.id, { taskId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.meta?.hasMore ? ((last.meta.nextCursor as string | null) ?? undefined) : undefined),
    enabled: Boolean(org?.id),
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.data.some((r) => r.status === "queued" || r.status === "running")) ? 5000 : false),
  });
};
