import type { RunEstimate } from "@/api/run";
import { usd } from "@/lib/format";

/** Spent this month / this run's upper-bound estimate / what is left. Start is blocked by the launcher when the run does not fit. */
export function BudgetBar({ estimate }: { estimate: RunEstimate | undefined }) {
  if (!estimate) return null;
  const { limit, spent, remaining } = estimate.budget;
  const pct = (n: number) => (limit > 0 ? Math.min(100, (n / limit) * 100) : 100);
  return (
    <div className="space-y-1" data-testid="budget-bar">
      <div className="flex h-2 overflow-hidden rounded bg-muted" role="img" aria-label="Monthly budget">
        <div className="bg-primary/70" style={{ width: `${pct(spent)}%` }} />
        <div className={estimate.withinBudget ? "bg-primary/30" : "bg-destructive/70"} style={{ width: `${Math.min(pct(estimate.estimatedCostUsdMicros), 100 - pct(spent))}%` }} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {usd(spent)} spent this month · this run up to {usd(estimate.estimatedCostUsdMicros)} · <span data-testid="budget-remaining">{usd(Math.max(0, remaining))} left</span> of {usd(limit)}
      </p>
      {!estimate.withinBudget && (
        <p className="text-xs text-destructive" data-testid="over-budget">Estimate exceeds the {usd(Math.max(0, remaining))} left this month.</p>
      )}
    </div>
  );
}
