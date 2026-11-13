"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { CompareView } from "@/components/compare/CompareView";
import { useCompare } from "@/hooks/results/useCompare";
import { useRunSummary } from "@/hooks/results/useRunSummary";
import { useRun } from "@/hooks/runs/useRun";
import { useTask } from "@/hooks/tasks/useTasks";

/* ?example=<ref>&a=<variantId>&b=<variantId>: one example, two variants, field by field, every repeat. */
function Compare({ runId }: { runId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const q = { example: params.get("example") || undefined, a: params.get("a") || undefined, b: params.get("b") || undefined };
  const run = useRun(runId);
  const summary = useRunSummary(runId);
  const task = useTask(run.data?.data.taskId ?? "");
  const cmp = useCompare(runId, q);
  const variants = summary.data?.data.variants ?? [];
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };
  const pick = (key: "a" | "b") => (
    <select aria-label={`Variant ${key.toUpperCase()}`} value={q[key] ?? ""} onChange={(e) => set(key, e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" data-testid={`compare-${key}`}>
      <option value="">variant {key.toUpperCase()}…</option>
      {variants.map((v) => <option key={v.variantId} value={v.variantId}>{v.promptVersion} · {v.modelLabel}</option>)}
    </select>
  );
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs text-muted-foreground"><Link href="/runs" className="hover:underline">Runs</Link> · <Link href={`/runs/${runId}`} className="hover:underline">Run {runId.slice(0, 8)}</Link></p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Side-by-side</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label="Example" placeholder="example ref (jp_017)" defaultValue={q.example ?? ""} className="h-9 w-48 rounded-md border border-border bg-background px-2 text-sm" data-testid="compare-example"
          onKeyDown={(e) => { if (e.key === "Enter") set("example", (e.target as HTMLInputElement).value.trim()); }} onBlur={(e) => set("example", e.target.value.trim())} />
        {pick("a")} {pick("b")}
      </div>
      {!q.example || !q.a || !q.b ? <p className="text-sm text-muted-foreground">Pick an example and two variants.</p>
        : cmp.isLoading ? <Skeleton className="h-40" />
        : cmp.isError || !cmp.data ? <p className="text-sm text-destructive" data-testid="compare-missing">That example or variant isn&apos;t in this run.</p>
        : (
          <>
            <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-xs text-foreground/90">{cmp.data.data.example.input.slice(0, 1200)}</p>
            <CompareView key={`${q.example}-${q.a}-${q.b}`} data={cmp.data.data} fields={(task.data?.data.task.fields ?? []).map((f) => f.key)} />
          </>
        )}
    </div>
  );
}

export default function ComparePage() {
  const { runId } = useParams<{ runId: string }>();
  return <Suspense fallback={<Skeleton className="h-48" />}><Compare runId={runId} /></Suspense>;
}
