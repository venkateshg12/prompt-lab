"use client";

import { useState } from "react";
import { FieldDiffRow } from "./FieldDiffRow";
import { RepeatTabs } from "./RepeatTabs";
import { RawOutput } from "@/components/errors/RawOutput";
import type { CompareResponse, CompareSide } from "@/api/results";

const valueOf = (side: CompareSide, repeat: number, key: string) => {
  const r = side.results.find((x) => x.repeatIndex === repeat);
  return { value: r?.fieldDetails?.[key]?.predicted, score: r?.fieldScores?.find((f) => f.key === key) };
};

export function CompareView({ data, fields }: { data: CompareResponse; fields: string[] }) {
  const repeats = Math.max(data.a.results.length, data.b.results.length);
  const [repeat, setRepeat] = useState(0);
  const ra = data.a.results.find((x) => x.repeatIndex === repeat);
  const rb = data.b.results.find((x) => x.repeatIndex === repeat);
  // Fields whose value changes across repeats on either side: the consistency failures.
  const inconsistent = fields.filter((k) => [data.a, data.b].some((s) => new Set(s.results.map((r) => JSON.stringify(r.fieldDetails?.[k]?.predicted))).size > 1));
  return (
    <div className="space-y-4" data-testid="compare-view">
      <RepeatTabs count={repeats} value={repeat} onChange={setRepeat} />
      {inconsistent.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="inconsistent-fields">Changes between repeats: {inconsistent.join(", ")}</p>}
      <table className="w-full text-left">
        <thead className="text-xs text-muted-foreground">
          <tr><th className="pr-3 font-normal">field</th><th className="pr-3 font-normal">expected</th><th className="pr-3 font-normal" data-testid="side-a">A · {data.a.promptVersion} · {data.a.modelLabel} ({ra?.overallScore?.toFixed(3) ?? ra?.status ?? "—"})</th><th className="font-normal" data-testid="side-b">B · {data.b.promptVersion} · {data.b.modelLabel} ({rb?.overallScore?.toFixed(3) ?? rb?.status ?? "—"})</th></tr>
        </thead>
        <tbody>
          {fields.map((k) => {
            const a = valueOf(data.a, repeat, k);
            const b = valueOf(data.b, repeat, k);
            return <FieldDiffRow key={k} k={k} expected={data.example.expected[k]} a={a.value} b={b.value} sa={a.score} sb={b.score} />;
          })}
        </tbody>
      </table>
      <div className="grid gap-4 md:grid-cols-2">
        <div><p className="mb-1 text-xs text-muted-foreground">A raw output</p><RawOutput raw={ra?.rawOutput ?? null} extracted={ra?.extractedText ?? null} /></div>
        <div><p className="mb-1 text-xs text-muted-foreground">B raw output</p><RawOutput raw={rb?.rawOutput ?? null} extracted={rb?.extractedText ?? null} /></div>
      </div>
    </div>
  );
}
