"use client";

import { forwardRef, useState } from "react";
import { FieldScoreRow } from "./FieldScoreRow";
import { RawOutput } from "./RawOutput";
import { usd } from "@/lib/format";
import type { ResultItem } from "@/api/results";

type Props = { r: ResultItem; active: boolean; expanded: boolean; onToggle: () => void; onCompare?: () => void; field?: string };

export const ResultCard = forwardRef<HTMLDivElement, Props>(function ResultCard({ r, active, expanded, onToggle, onCompare, field }, ref) {
  const [fullInput, setFullInput] = useState(false);
  return (
    <div ref={ref} aria-current={active ? "true" : undefined} data-testid="result-card" data-ref={r.exampleRef} data-result-id={r.id}
      className={`space-y-3 rounded-md border bg-card p-4 ${active ? "border-primary ring-1 ring-primary/40" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-sm text-foreground">{r.exampleRef}</span>
        <span className="text-muted-foreground">repeat {r.repeat + 1}</span>
        <span className="font-mono text-muted-foreground">{r.promptVersion} · {r.modelKey}</span>
        {r.tags.map((t) => <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{t}</span>)}
        <span className="ml-auto tabular-nums text-foreground" data-testid="card-score">{r.status === "error" ? "error" : r.overallScore?.toFixed(3)}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {r.input == null || r.inputHidden ? <span className="italic" data-testid="input-hidden">[input hidden]</span> : (
          <>
            <span className="whitespace-pre-wrap text-foreground/90" data-testid="card-input">{fullInput || r.input.length <= 400 ? r.input : `${r.input.slice(0, 400)}…`}</span>
            {r.input.length > 400 && <button type="button" className="ml-1 cursor-pointer underline" onClick={() => setFullInput((x) => !x)}>{fullInput ? "less" : "more"}</button>}
          </>
        )}
      </div>
      {r.status === "error" ? (
        <p className="text-sm text-destructive" data-testid="card-error">{r.error ?? "The call failed."} ({r.attempts} attempt{r.attempts === 1 ? "" : "s"})</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-3 text-xs">
            <span data-testid="card-valid-json">validJson: <b>{String(r.validJson)}</b></span>
            <span>schema: <b>{String(r.schemaValid)}</b></span>
            <span>exact: <b>{String(r.exactMatch)}</b></span>
          </div>
          {r.fieldScores && (
            <table className="w-full text-left">
              <thead className="text-[11px] text-muted-foreground"><tr><th className="pr-3 font-normal">field</th><th className="pr-3 font-normal">expected</th><th className="pr-3 font-normal">actual</th><th className="pr-3 font-normal">score</th><th className="pr-3 font-normal">reason</th><th className="font-normal">normalised</th></tr></thead>
              <tbody>{r.fieldScores.map((f) => <FieldScoreRow key={f.key} score={f} detail={r.fieldDetails?.[f.key]} highlight={f.key === field} />)}</tbody>
            </table>
          )}
        </>
      )}
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span>tokens {r.inputTokens ?? "?"} → {r.outputTokens ?? "?"}</span>
        <span>{r.latencyMs ?? "?"} ms</span>
        <span>{r.attempts} attempt{r.attempts === 1 ? "" : "s"}</span>
        <span>{r.costUsdMicros != null ? usd(r.costUsdMicros) : "—"}</span>
        <span className={r.finishReason === "length" ? "font-medium text-destructive" : ""}>finish: {r.finishReason ?? "?"}</span>
        <button type="button" className="ml-auto cursor-pointer underline" onClick={onToggle} data-testid="toggle-raw">{expanded ? "hide raw output" : "raw output (o)"}</button>
        {onCompare && <button type="button" className="cursor-pointer underline" onClick={onCompare} data-testid="compare-link">Compare with… (c)</button>}
      </div>
      {expanded && <RawOutput raw={r.rawOutput} extracted={r.extractedText} />}
    </div>
  );
});
