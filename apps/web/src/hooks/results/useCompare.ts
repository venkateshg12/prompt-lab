import { useQuery } from "@tanstack/react-query";
import { compareResults } from "@/api/results";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

export const useCompare = (runId: string, q: { example?: string; a?: string; b?: string }) => {
  const { org } = useCurrentOrg();
  return useQuery({
    queryKey: ["compare", org?.id, runId, q],
    queryFn: () => compareResults(org!.id, runId, { example: q.example!, a: q.a!, b: q.b! }),
    enabled: Boolean(org?.id && q.example && q.a && q.b),
  });
};
