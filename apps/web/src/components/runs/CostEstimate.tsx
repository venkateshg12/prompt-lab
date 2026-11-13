import type { RunEstimate } from "@/api/run";
import { shortDate, usd } from "@/lib/format";

/** Always labelled an estimate, with the date of the prices behind it. The real cost is on the run page, from stored results. */
export function CostEstimate({ estimate }: { estimate: RunEstimate | undefined }) {
  if (!estimate) return null;
  const dates = [...new Set(estimate.variants.map((v) => v.priceCheckedOn))].sort();
  return (
    <div className="space-y-1" data-testid="cost-estimate">
      <p className="text-sm text-foreground">
        ≈ <strong data-testid="estimate-usd">{usd(estimate.totalUsdMicros)}</strong>{" "}
        <span className="text-muted-foreground" data-testid="estimate-dates">(estimate; prices checked {dates.map(shortDate).join(", ")})</span>
      </p>
      <p className="text-[11px] text-muted-foreground">
        Typical output ≈ 40% of the token limit (80% for chain-of-thought). Up to {usd(estimate.estimatedCostUsdMicros)} if every call used its whole limit. This is not a bill.
      </p>
    </div>
  );
}
