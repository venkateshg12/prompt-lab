import type { RunEstimate } from "@/api/run";

/** "2 prompts × 2 models × 30 examples × 1 repeat = 120 calls (30 skipped: …)". The count is the server's, not recomputed here. */
export function GridSummary({ prompts, models, repeats, estimate }: { prompts: number; models: number; repeats: number; estimate: RunEstimate | undefined }) {
  if (!estimate) return <p className="text-sm text-muted-foreground" data-testid="grid-summary">Pick at least one prompt and one model.</p>;
  const skippedVariants = estimate.variants.filter((v) => v.skippedCells > 0).map((v) => `${v.promptVersion} × ${v.modelKey}`);
  return (
    <div className="space-y-1" data-testid="grid-summary">
      <p className="text-sm text-foreground">
        {prompts} prompt{prompts === 1 ? "" : "s"} × {models} model{models === 1 ? "" : "s"} × {estimate.examples} examples × {repeats} repeat{repeats === 1 ? "" : "s"} ={" "}
        <strong data-testid="grid-calls">{estimate.totalCells} calls</strong>
      </p>
      {estimate.skippedCells > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="grid-skipped">
          {estimate.skippedCells} skipped: structured-output prompt on a model without structured mode ({skippedVariants.join(", ")}). Skipped cells cost nothing and stay out of the scores.
        </p>
      )}
    </div>
  );
}
