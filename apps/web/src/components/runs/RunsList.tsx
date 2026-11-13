"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RunLauncher } from "@/components/runs/RunLauncher";
import { RunsTable } from "@/components/runs/RunsTable";
import { useRuns } from "@/hooks/runs/useRuns";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";

/** Runs of one task (with "New run") or of the whole workspace (no taskId: runs start from a task). */
export function RunsList({ taskId }: { taskId?: string }) {
  const { role } = useCurrentOrg();
  const canStart = Boolean(taskId) && (role === "owner" || role === "admin");
  const { data, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useRuns(taskId);
  const rows = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);
  const [launching, setLaunching] = useState(false);

  return (
    <div className="space-y-4">
      {canStart && (
        <div className="flex justify-end">
          <Button size="sm" className="cursor-pointer" onClick={() => setLaunching(true)} data-testid="new-run"><Plus className="h-4 w-4" /> New run</Button>
        </div>
      )}
      {isLoading ? <Skeleton className="h-32" /> : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="runs-empty">
          {taskId ? "No runs yet. Start one to compare prompts and models." : "No runs yet. Open a task and start one from its Runs tab."}
        </p>
      ) : <RunsTable rows={rows} />}
      {hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" className="cursor-pointer" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()} data-testid="runs-more">Load more</Button>
        </div>
      )}
      {taskId && launching && <RunLauncher taskId={taskId} open onClose={() => setLaunching(false)} />}
    </div>
  );
}
