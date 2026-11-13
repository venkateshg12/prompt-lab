"use client";

import { Suspense, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorFilters } from "@/components/errors/ErrorFilters";
import { ErrorList } from "@/components/errors/ErrorList";
import { useResults } from "@/hooks/results/useResults";
import { useRunSummary } from "@/hooks/results/useRunSummary";
import { useRun } from "@/hooks/runs/useRun";
import { useTask } from "@/hooks/tasks/useTasks";
import type { ResultItem } from "@/api/results";

/* ?variant=&field=&reason=&tag=&failedOnly=: every filter is in the URL, so a reload or a pasted link shows the same list. */
function ErrorBrowser({ runId }: { runId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const f = useMemo(() => ({
    variant: params.get("variant") || undefined,
    field: params.get("field") || undefined,
    reason: params.get("reason") || undefined,
    tag: params.get("tag") || undefined,
    failedOnly: params.get("failedOnly") === "true",
  }), [params]);
  const run = useRun(runId);
  const summary = useRunSummary(runId);
  const task = useTask(run.data?.data.taskId ?? "");
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useResults(runId, f);
  const items = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);
  const facets = data?.pages[0]?.meta.facets;
  const variants = useMemo(() => summary.data?.data.variants ?? [], [summary.data]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    if (key === "field" || key === "variant") next.delete("reason"); // a reason belongs to one field
    router.replace(`${pathname}?${next.toString()}`);
  };
  const onCompare = useCallback((r: ResultItem) => {
    const other = variants.find((v) => v.variantId !== r.variantId);
    const q = new URLSearchParams({ example: r.exampleRef, a: r.variantId, ...(other ? { b: other.variantId } : {}) });
    router.push(`/runs/${runId}/compare?${q}`);
  }, [variants, router, runId]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-muted-foreground"><Link href="/runs" className="hover:underline">Runs</Link> · <Link href={`/runs/${runId}`} className="hover:underline" data-testid="back-to-run">Run {runId.slice(0, 8)}</Link></p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Error browser</h1>
        <p className="text-xs text-muted-foreground">Worst first: errors, then the lowest scores.{f.field && !f.variant && " Pick a variant to see reason counts."}</p>
      </div>
      <ErrorFilters f={f} set={set} variants={variants} fields={(task.data?.data.task.fields ?? []).map((x) => x.key)} facets={facets} />
      {isLoading ? <Skeleton className="h-40" /> : isError ? <p className="text-sm text-destructive" data-testid="run-missing">This run doesn&apos;t exist, or you don&apos;t have access to it.</p> : (
        <ErrorList items={items} field={f.field} hasMore={Boolean(hasNextPage)} loadingMore={isFetchingNextPage} loadMore={() => void fetchNextPage()} onCompare={onCompare} />
      )}
    </div>
  );
}

export default function ErrorsPage() {
  const { runId } = useParams<{ runId: string }>();
  return <Suspense fallback={<Skeleton className="h-48" />}><ErrorBrowser runId={runId} /></Suspense>;
}
