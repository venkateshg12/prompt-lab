import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { autoSplit, getAgreement, importExamples, listExamples, setSecondLabel, updateExample, type ExampleFilters, type ExampleItem } from "@/api/example";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

export const useExamples = (taskId: string, filters: ExampleFilters) => {
  const { org } = useCurrentOrg();
  return useInfiniteQuery({
    queryKey: ["examples", org?.id, taskId, filters],
    queryFn: ({ pageParam }) => listExamples(org!.id, taskId, { ...filters, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.meta?.hasMore ? ((last.meta.nextCursor as string | null) ?? undefined) : undefined),
    enabled: Boolean(org?.id),
  });
};

const useInvalidate = () => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ["examples"] });
    void qc.invalidateQueries({ queryKey: ["agreement"] });
    void qc.invalidateQueries({ queryKey: ["tasks"] });
  };
};

export const useUpdateExample = (taskId: string) => {
  const { org } = useCurrentOrg();
  const done = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof updateExample>[3] }) => updateExample(org!.id, taskId, id, body),
    onSuccess: done,
  });
};

export const useImportExamples = (taskId: string) => {
  const { org } = useCurrentOrg();
  const done = useInvalidate();
  return useMutation({
    mutationFn: (body: Parameters<typeof importExamples>[2]) => importExamples(org!.id, taskId, body),
    onSuccess: (res) => { if (!res.data.dryRun) done(); },
  });
};

export const useAutoSplit = (taskId: string) => {
  const { org } = useCurrentOrg();
  const done = useInvalidate();
  return useMutation({ mutationFn: () => autoSplit(org!.id, taskId), onSuccess: done });
};

export const useSecondLabel = (taskId: string) => {
  const { org } = useCurrentOrg();
  const done = useInvalidate();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: unknown }) => setSecondLabel(org!.id, taskId, id, label),
    onSuccess: done,
  });
};

export const useAgreement = (taskId: string, enabled = true) => {
  const { org } = useCurrentOrg();
  return useQuery({ queryKey: ["agreement", org?.id, taskId], queryFn: () => getAgreement(org!.id, taskId), enabled: Boolean(org?.id) && enabled });
};

export type { ExampleItem };
