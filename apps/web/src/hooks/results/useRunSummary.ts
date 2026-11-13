import { useQuery } from "@tanstack/react-query";
import { getRunSummary } from "@/api/results";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

/** The results table's numbers, for the whole set or one tag's subset (`tag` recomputes every metric). */
export const useRunSummary = (runId: string, tag?: string, enabled = true) => {
  const { org } = useCurrentOrg();
  return useQuery({
    queryKey: ["run-summary", org?.id, runId, tag ?? "*"],
    queryFn: () => getRunSummary(org!.id, runId, tag),
    enabled: Boolean(org?.id) && enabled,
  });
};
