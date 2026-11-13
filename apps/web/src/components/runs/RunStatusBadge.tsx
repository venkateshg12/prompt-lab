import type { RunStatus } from "@/api/run";

export function RunStatusBadge({ status }: { status: RunStatus }) {
  return (
    <span data-testid="run-status" data-status={status} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
      status === "completed" ? "bg-emerald-500/10 text-emerald-600" :
      status === "running" ? "bg-blue-500/10 text-blue-600" :
      status === "queued" ? "bg-muted text-muted-foreground" :
      status === "cancelled" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" :
      "bg-destructive/10 text-destructive"}`}>
      {status}
    </span>
  );
}
