"use client";

import { useAgreement } from "@/hooks/examples/useExamples";

/*
  Per-field agreement between the first label and the second, computed on the server with the SAME field
  scorers as the benchmark (so "Acme Labs" vs "acme labs." agree, ["JS"] vs ["javascript"] agree, and a
  salary within ±5 % agrees). Disagreements are resolved by the owner, editing `expected`.
 */
export function AgreementPanel({ taskId }: { taskId: string }) {
  const { data } = useAgreement(taskId);
  const a = data?.data;
  if (!a || a.examples === 0) return null;
  const rates = a.fields.filter((f) => f.rate !== null).map((f) => f.rate as number);
  const overall = rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : null;
  return (
    <section className="space-y-2 rounded-lg border border-border p-4" data-testid="agreement-panel">
      <h3 className="text-sm font-semibold text-foreground">Label agreement <span className="font-normal text-muted-foreground">({a.examples} double-labelled)</span></h3>
      {overall !== null && <p className="text-xs text-muted-foreground" data-testid="agreement-overall">Overall {Math.round(overall * 100)}%</p>}
      <ul className="grid gap-1 text-xs sm:grid-cols-2">
        {a.fields.map((f) => (
          <li key={f.key} data-testid={`agreement-${f.key}`} className="flex justify-between gap-2">
            <span className="font-mono">{f.key}</span>
            <span className={f.disagreements.length ? "text-destructive" : "text-muted-foreground"}>
              {f.agree}/{f.total}{f.disagreements.length ? ` — differs on ${f.disagreements.join(", ")}` : ""}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
