import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { estimateRun, type RunBody } from "@/api/run";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

/** The server's estimate (it has the rendered prompts and the examples), debounced 300 ms on every selection change. */
export const useEstimateRun = (body: RunBody | null) => {
  const { org } = useCurrentOrg();
  const key = body ? JSON.stringify({ ...body, notes: undefined }) : null;
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(key), 300);
    return () => clearTimeout(t);
  }, [key]);
  const query = useQuery({
    queryKey: ["runs", org?.id, "estimate", debounced],
    queryFn: () => estimateRun(org!.id, JSON.parse(debounced!) as RunBody),
    enabled: Boolean(org?.id && debounced),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
  return { ...query, settled: debounced === key };
};
