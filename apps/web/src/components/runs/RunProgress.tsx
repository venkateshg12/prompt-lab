"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AlertPopup } from "@/components/ui/alert-popup";
import { RunStatusBadge } from "@/components/runs/RunStatusBadge";
import { useCancelRun } from "@/hooks/runs/useCancelRun";
import { duration, usd } from "@/lib/format";
import { getErrorMessage } from "@/lib/errorMessage";
import type { RunDetail } from "@/api/run";

const Counter = ({ label, value, testId }: { label: string; value: number; testId: string }) => (
  <div className="rounded-lg border border-border px-3 py-2">
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-lg font-semibold tabular-nums text-foreground" data-testid={testId}>{value}</p>
  </div>
);

/*
  Everything here is read from the cached run, which the SSE stream overwrites with database counters.
  doneCells counts every finished cell (scored + error + skipped), so the bar is doneCells / totalCells and
  "scored" is what is left after errors and skips. Nothing is added up client-side.
 */
export function RunProgress({ run, canCancel, live }: { run: RunDetail; canCancel: boolean; live: boolean }) {
  const cancel = useCancelRun(run.id);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = run.status === "queued" || run.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);

  const skipped = run.skippedCells ?? 0;
  const scored = Math.max(0, run.doneCells - run.errorCells - skipped);
  const pct = run.totalCells > 0 ? Math.round((run.doneCells / run.totalCells) * 100) : 0;
  const elapsed = (run.finishedAt ? new Date(run.finishedAt).getTime() : now) - new Date(run.createdAt).getTime();

  return (
    <section className="space-y-5" data-testid="run-progress">
      <div className="flex flex-wrap items-center gap-3">
        <RunStatusBadge status={run.status} />
        <span className="text-sm text-muted-foreground" data-testid="run-elapsed">{duration(elapsed)}</span>
        {active && <span className="text-[11px] text-muted-foreground" data-testid="run-transport">{live ? "live" : "polling every 3 s"}</span>}
        {run.testReused && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid="test-reused-badge">test reused</span>}
        {canCancel && active && (
          <Button size="sm" variant="outline" className="ml-auto cursor-pointer" onClick={() => setConfirming(true)} data-testid="cancel-run">Cancel run</Button>
        )}
      </div>

      <div className="space-y-1">
        <div className="h-3 overflow-hidden rounded bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={run.totalCells} aria-valuenow={run.doneCells} data-testid="run-bar">
          <div className={`h-full transition-all ${run.status === "cancelled" ? "bg-amber-500/70" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="text-xs text-muted-foreground"><span data-testid="run-done">{run.doneCells}</span> / <span data-testid="run-total">{run.totalCells}</span> cells · {pct}%</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter label="Scored" value={scored} testId="count-scored" />
        <Counter label="Errors" value={run.errorCells} testId="count-errors" />
        <Counter label="Skipped" value={skipped} testId="count-skipped" />
        <div className="rounded-lg border border-border px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cost so far</p>
          <p className="text-lg font-semibold tabular-nums text-foreground" data-testid="run-cost">{usd(run.costUsdMicros ?? 0)}</p>
        </div>
      </div>
      {run.errorCells > 0 && <p className="text-xs text-muted-foreground">Error cells are provider failures after retries. They are shown apart and kept out of the scores.</p>}

      <div className="space-y-2" data-testid="per-model">
        <h2 className="text-sm font-semibold text-foreground">By model</h2>
        {run.progressByModel.map((m) => {
          const p = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
          return (
            <div key={m.modelKey} className="space-y-1" data-testid={`model-${m.modelKey}`}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-foreground">{m.modelLabel}</span>
                <span className="tabular-nums text-muted-foreground">{m.done} / {m.total}{m.errors > 0 ? ` · ${m.errors} errors` : ""} · {usd(m.costUsdMicros)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary/70 transition-all" style={{ width: `${p}%` }} /></div>
            </div>
          );
        })}
      </div>

      {run.notes && <p className="text-xs text-muted-foreground">Notes: {run.notes}</p>}
      {error && <p className="text-xs text-destructive" data-testid="cancel-error">{error}</p>}

      <AlertPopup
        isOpen={confirming}
        type="warning"
        title="Cancel this run?"
        description="Cells already finished keep their results. The rest are skipped and cost nothing."
        actionLabel="Cancel run"
        isActionPending={cancel.isPending}
        onClose={() => setConfirming(false)}
        onAction={() => cancel.mutate(undefined, { onSuccess: () => setConfirming(false), onError: (e) => { setConfirming(false); setError(getErrorMessage(e, "Couldn't cancel the run")); } })}
      />
    </section>
  );
}
