import Link from "next/link";
import type { RunDetail } from "@/api/run";
import type { SummaryVariant } from "@/api/results";

/* What the numbers are about: task + version, split, repeats, prompts (frozen text), models with dated prices, notes. */
export function RunMeta({ run, variants }: { run: RunDetail; variants: SummaryVariant[] }) {
  const prompts = [...new Set(variants.map((v) => v.promptVersion))];
  const models = [...new Map(variants.map((v) => [v.modelKey, v])).values()];
  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-4 text-sm" data-testid="run-meta">
      <p className="text-muted-foreground">
        Task <span className="text-foreground">{run.task.name}</span> v{run.taskVersion} · split <span className="text-foreground">{run.split}</span> · {run.repeats} repeat{run.repeats === 1 ? "" : "s"}
      </p>
      <p className="text-muted-foreground">
        Prompts:{" "}
        {prompts.map((p, i) => (
          <span key={p}>{i > 0 && ", "}<Link href={`/tasks/${run.taskId}?tab=prompts&prompt=${encodeURIComponent(p)}`} className="font-mono text-xs text-foreground hover:underline">{p}</Link></span>
        ))}
      </p>
      <p className="text-muted-foreground">
        Models:{" "}
        {models.map((m, i) => (
          <span key={m.modelKey}>{i > 0 && "; "}<span className="text-foreground">{m.modelLabel}</span>{m.price?.priceCheckedOn ? ` (prices checked ${m.price.priceCheckedOn.slice(0, 10)})` : ""}</span>
        ))}
      </p>
      {run.testReused && <p className="text-amber-700 dark:text-amber-300" data-testid="meta-test-reused">This test-split run reused the test set: its numbers are not a clean final result.</p>}
      {run.notes && <pre className="whitespace-pre-wrap font-sans text-xs text-muted-foreground" data-testid="run-notes">{run.notes}</pre>}
    </div>
  );
}
