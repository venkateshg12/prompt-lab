import { useInfiniteQuery } from "@tanstack/react-query";
import { listResults, type ResultsFilters } from "@/api/results";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

/** The error browser's feed: worst first, keyset-paged by (score, id); facets come with the first page. */
export const useResults = (runId: string, filters: ResultsFilters) => {
  const { org } = useCurrentOrg();
  return useInfiniteQuery({
    queryKey: ["results", org?.id, runId, filters],
    queryFn: ({ pageParam }) => listResults(org!.id, runId, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? undefined) : undefined),
    enabled: Boolean(org?.id),
  });
};
