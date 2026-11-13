"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useModels } from "@/hooks/models/useModels";
import { useJudgeActions, useJudged } from "@/hooks/results/useJudge";
import { getErrorMessage } from "@/lib/errorMessage";
import type { JudgeStats } from "@/api/judge";

const pct = (x: number | null) => (x == null ? "n/a" : `${(x * 100).toFixed(1)} %`);

/** "not validated: agreement X, κ Y, n Z", generated from the data. Kappa null = every label identical. */
export const validationNote = (v: { n: number; agreement: number | null; kappa: number | null }) =>
  `agreement ${pct(v.agreement)}, κ ${v.kappa == null ? "undefined (no variation)" : v.kappa.toFixed(2)}, n ${v.n}`;

/*
  The judge, kept honest: a binary question asked of a different model family, stored apart, and shown
  without a warning only once ≥ 30 human labels give agreement ≥ 0.85 and κ ≥ 0.6.
 */
export function JudgePanel({ runId, stats, canStart, canLabel }: { runId: string; stats: JudgeStats; canStart: boolean; canLabel: boolean }) {
  const models = useModels();
  const [model, setModel] = useState("");
  const [unlabelledOnly, setUnlabelledOnly] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const list = useJudged(runId, unlabelledOnly, Boolean(stats));
  const { start, label } = useJudgeActions(runId);
  const v = stats?.validation;
  return (
    <section className="space-y-3 rounded-md border border-border bg-card p-4" data-testid="judge-panel">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium text-foreground">LLM judge <span className="text-xs font-normal text-muted-foreground">(binary, stored apart, never part of Overall)</span></h2>
        {canStart && (
          <span className="ml-auto flex items-center gap-2">
            <select aria-label="Judge model" value={model} onChange={(e) => setModel(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-sm" data-testid="judge-model">
              <option value="">judge model…</option>
              {(models.data?.data ?? []).filter((m) => m.active).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <Button size="sm" variant="outline" className="cursor-pointer" disabled={!model || start.isPending} data-testid="judge-start"
              onClick={() => start.mutate({ modelKey: model }, { onSuccess: (r) => setMsg(`Judging ${r.data.enqueued} results…`), onError: (e) => setMsg(getErrorMessage(e, "Couldn't start the judge")) })}>
              Judge this run
            </Button>
          </span>
        )}
      </div>
      {msg && <p className="text-xs text-muted-foreground" data-testid="judge-msg">{msg}</p>}
      {stats && v && (
        <>
          <p className="text-xs text-muted-foreground">Judge {stats.model}{stats.sameFamily ? " (same family as a judged model: allowed explicitly)" : ""}: “{stats.question}”</p>
          <div className={`rounded-md px-3 py-2 text-sm ${v.validated ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-200"}`} data-testid="judge-validation" data-validated={v.validated}>
            {v.validated ? "Validated" : "Not validated"}: {validationNote(v)}{v.validated ? "" : " (needs n ≥ 30, agreement ≥ 85 %, κ ≥ 0.6)"}
          </div>
          {canLabel && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={unlabelledOnly} onChange={(e) => setUnlabelledOnly(e.target.checked)} /> only results without my label
              </label>
              <ul className="max-h-96 space-y-2 overflow-auto" data-testid="judge-list">
                {(list.data?.data ?? []).map((r) => (
                  <li key={r.resultId} className="rounded-md border border-border p-2 text-xs" data-testid="judge-item" data-result-id={r.resultId}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{r.exampleRef}</span>
                      <span className="text-muted-foreground">{r.variant}</span>
                      <span className="ml-auto">judge: <b>{r.judge.status === "ok" ? (r.judge.pass ? "pass" : "fail") : "error"}</b></span>
                      <Button size="sm" variant={r.judge.human?.pass === true ? "default" : "outline"} className="h-6 cursor-pointer px-2" onClick={() => label.mutate({ resultId: r.resultId, pass: true })} data-testid="human-pass">✓</Button>
                      <Button size="sm" variant={r.judge.human?.pass === false ? "default" : "outline"} className="h-6 cursor-pointer px-2" onClick={() => label.mutate({ resultId: r.resultId, pass: false })} data-testid="human-fail">✗</Button>
                    </div>
                    <p className="mt-1 text-muted-foreground">title: expected {JSON.stringify(r.expected?.title)} · extracted {JSON.stringify(r.parsedJson?.title)}</p>
                    {r.judge.reason && <p className="text-muted-foreground">“{r.judge.reason}”</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
