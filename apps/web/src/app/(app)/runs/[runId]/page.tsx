"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { RunProgress } from "@/components/runs/RunProgress";
import { ResultsTable } from "@/components/results/ResultsTable";
import { RunMeta } from "@/components/results/RunMeta";
import { StaleBanner } from "@/components/results/StaleBanner";
import { TagFilter } from "@/components/results/TagFilter";
import { ExportMenu } from "@/components/results/ExportMenu";
import { PublishDialog } from "@/components/results/PublishDialog";
import { CostAccuracyChart } from "@/components/results/CostAccuracyChart";
import { FieldBars } from "@/components/results/FieldBars";
import { JudgePanel } from "@/components/results/JudgePanel";
import { useRun } from "@/hooks/runs/useRun";
import { useRunEvents } from "@/hooks/runs/useRunEvents";
import { useRunSummary } from "@/hooks/results/useRunSummary";
import { useTask } from "@/hooks/tasks/useTasks";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

function RunResults({ runId }: { runId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tag = params.get("tag") || undefined;
  const { org, role } = useCurrentOrg();
  const { fallback } = useRunEvents(org?.id, runId);
  const { data, isLoading, isError } = useRun(runId, { fallback });
  const run = data?.data;
  const terminal = Boolean(run && TERMINAL.has(run.status));
  const summary = useRunSummary(runId, tag, terminal);
  const task = useTask(run?.taskId ?? "");

  if (isLoading) return <Skeleton className="h-48" />;
  if (isError || !run) return <p className="text-sm text-destructive" data-testid="run-missing">This run doesn&apos;t exist, or you don&apos;t have access to it.</p>;
  const canAdmin = role === "owner" || role === "admin";
  const s = summary.data?.data;
  const fields = task.data?.data.task.fields ?? [];

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground"><Link href="/runs" className="hover:underline">Runs</Link> · <Link href={`/tasks/${run.taskId}?tab=runs`} className="hover:underline">{run.task.name}</Link> · {run.split}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Run <span className="font-mono text-base text-muted-foreground" data-testid="run-id">{run.id.slice(0, 8)}</span></h1>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="run-grid-line">
          {[...new Set(run.variants.map((v) => v.versionId))].join(", ")} on {[...new Set(run.variants.map((v) => v.modelLabel))].join(", ")} · {run.repeats} repeat{run.repeats === 1 ? "" : "s"}
        </p>
      </div>
      <RunProgress run={run} canCancel={canAdmin} live={!fallback} />
      {terminal && (
        <section className="space-y-4" data-testid="results-section">
          {s && <RunMeta run={run} variants={s.variants} />}
          {s && <StaleBanner runId={runId} stale={s.stale} canRescore={canAdmin} />}
          <div className="flex flex-wrap items-center gap-3">
            <TagFilter tags={s?.tags ?? []} value={tag} onChange={(t) => router.replace(t ? `${pathname}?tag=${encodeURIComponent(t)}` : pathname)} />
            <Link href={`/runs/${runId}/errors?failedOnly=true`} className="text-sm text-primary hover:underline" data-testid="open-errors">Error browser</Link>
            <Link href={`/runs/${runId}/compare`} className="text-sm text-primary hover:underline">Side-by-side</Link>
            {canAdmin && <span className="ml-auto"><PublishDialog runId={runId} /></span>}
          </div>
          {org && <ExportMenu orgId={org.id} runId={runId} />}
          {summary.isLoading || task.isLoading ? <Skeleton className="h-40" /> : s ? <ResultsTable basePath={`/runs/${runId}`} rows={s.variants} fields={fields} tag={tag} judge={s.judge} /> : <p className="text-sm text-destructive">Couldn&apos;t load the results.</p>}
          {s && run.status === "completed" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <CostAccuracyChart rows={s.variants} />
              <FieldBars rows={s.variants} fields={fields} />
            </div>
          )}
          {s && run.status === "completed" && <JudgePanel runId={runId} stats={s.judge} canStart={canAdmin} canLabel={canAdmin || role === "reviewer"} />}
        </section>
      )}
    </div>
  );
}

export default function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  return <Suspense fallback={<Skeleton className="h-48" />}><RunResults runId={runId} /></Suspense>;
}
