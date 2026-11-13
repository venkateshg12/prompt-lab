import type { Interval } from "@/api/results";

export type Best = "best" | "best-unclear" | null;

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;

/*
  One rate: one decimal, the 95 % interval and n on hover. `best` is bold; `best-unclear` is the best
  value whose interval overlaps the runner-up's, so it is dimmed and says "not clearly better".
  n < 20 gets a "small sample" dot. Null is "n/a" (never 0): nothing was scored for it.
 */
export function MetricCell({ m, n, best, naReason, testId }: { m: Interval | null | undefined; n: number; best?: Best; naReason?: string; testId?: string }) {
  if (!m) return <span className="text-xs text-muted-foreground" title={naReason ?? "nothing scored"} data-testid={testId}>n/a</span>;
  const title = `${pct(m.value)} (${pct(m.ci[0]).replace(" %", "")}–${pct(m.ci[1])}, n=${n})${best === "best-unclear" ? " · not clearly better: the intervals overlap" : ""}`;
  return (
    <span
      className={`inline-flex items-center gap-1 tabular-nums ${best === "best" ? "font-semibold text-foreground" : best === "best-unclear" ? "font-semibold text-foreground/60" : "text-foreground"}`}
      title={title}
      data-testid={testId}
      data-value={m.value}
      data-best={best ?? undefined}
    >
      {pct(m.value)}
      {n < 20 && <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" title="small sample (n < 20)" data-testid="small-sample" />}
    </span>
  );
}
