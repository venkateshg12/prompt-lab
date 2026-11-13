"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorFilters } from "@/components/errors/ErrorFilters";
import { ErrorList } from "@/components/errors/ErrorList";
import { publicUrl, type PublicRun } from "@/api/publish";
import type { ResultItem, ResultsMeta, SummaryVariant } from "@/api/results";
import type { SuccessResponse } from "@/types";

/* The read-only error browser of a published run: same cards and keys, no compare, hidden inputs and their raw outputs withheld. */
const getJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
};

function PublicErrors({ slug }: { slug: string }) {
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
  const run = useQuery({ queryKey: ["public-run", slug], queryFn: () => getJson<SuccessResponse<PublicRun>>(publicUrl(`/runs/${encodeURIComponent(slug)}`)) });
  const results = useInfiniteQuery({
    queryKey: ["public-results", slug, f],
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ limit: "20" });
      for (const [k, v] of Object.entries(f)) if (v) q.set(k, String(v));
      if (pageParam) q.set("cursor", pageParam);
      return getJson<SuccessResponse<ResultItem[]> & { meta: ResultsMeta }>(publicUrl(`/runs/${encodeURIComponent(slug)}/results?${q}`));
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.meta.hasMore ? (last.meta.nextCursor ?? undefined) : undefined),
  });
  const items = useMemo(() => results.data?.pages.flatMap((p) => p.data) ?? [], [results.data]);
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    if (key === "field" || key === "variant") next.delete("reason");
    router.replace(`${pathname}?${next.toString()}`);
  };
  if (run.isError) return <p className="text-sm text-destructive" data-testid="public-missing">This page doesn&apos;t exist.</p>;
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-10 sm:px-6">
      <div>
        <Link href={`/r/${slug}`} className="text-xs text-muted-foreground hover:underline">← {run.data?.data.title ?? "Published run"}</Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Mistakes, worst first</h1>
        <p className="text-xs text-muted-foreground">Read-only. Inputs the owner marked private are hidden, and so are their raw outputs.</p>
      </div>
      <ErrorFilters f={f} set={set} variants={(run.data?.data.variants ?? []) as SummaryVariant[]} fields={(run.data?.data.task.fields ?? []).map((x) => x.key)} facets={results.data?.pages[0]?.meta.facets} />
      {results.isLoading ? <Skeleton className="h-40" /> : results.isError ? <p className="text-sm text-destructive">Couldn&apos;t load the results.</p> : (
        <ErrorList items={items} field={f.field} hasMore={Boolean(results.hasNextPage)} loadingMore={results.isFetchingNextPage} loadMore={() => void results.fetchNextPage()} />
      )}
    </main>
  );
}

export default function PublicErrorsPage() {
  const { slug } = useParams<{ slug: string }>();
  return <Suspense fallback={<Skeleton className="h-48" />}><PublicErrors slug={slug} /></Suspense>;
}
