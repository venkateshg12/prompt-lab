"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ErrorBar, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SummaryVariant } from "@/api/results";
import type { FieldRule } from "@repo/types";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];

/*
  Per-field accuracy with its 95 % interval as an error bar (Wilson for proportions, bootstrap for skills
  F1), from the stored summaries. At most three variants at a time (one validated colour each); the top
  three by overall are preselected.
 */
export function FieldBars({ rows, fields }: { rows: Omit<SummaryVariant, "price">[]; fields: FieldRule[] }) {
  const ranked = useMemo(() => [...rows].filter((r) => r.summary.metrics.overall).sort((a, b) => b.summary.metrics.overall!.value - a.summary.metrics.overall!.value), [rows]);
  const [picked, setPicked] = useState<string[]>(() => ranked.slice(0, 3).map((r) => r.variantId));
  const shown = ranked.filter((r) => picked.includes(r.variantId));
  const data = fields.map((f) => Object.fromEntries([
    ["field", f.key],
    ...shown.flatMap((r, i) => {
      const m = r.summary.metrics[f.key];
      return m ? [[`v${i}`, m.value], [`e${i}`, [m.value - m.ci[0], m.ci[1] - m.value]]] : [];
    }),
  ]));
  if (ranked.length === 0) return null;
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 3 ? [...p, id] : p));
  return (
    <figure className="space-y-2 rounded-md border border-border bg-card p-4" data-testid="field-bars">
      <figcaption className="text-sm font-medium text-foreground">Accuracy per field <span className="text-xs font-normal text-muted-foreground">(bars: 95 % interval)</span></figcaption>
      {ranked.length > 3 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {ranked.map((r) => (
            <label key={r.variantId} className="flex items-center gap-1 text-muted-foreground">
              <input type="checkbox" checked={picked.includes(r.variantId)} onChange={() => toggle(r.variantId)} /> {r.promptVersion} · {r.modelLabel}
            </label>
          ))}
        </div>
      )}
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 8 }} barGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
            {/* Field names are long (experience_years_min): angled so they never collide. */}
            <XAxis dataKey="field" tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} interval={0} angle={-30} textAnchor="end" height={70} />
            {/* allowDataOverflow pins the scale to 0–100 %: otherwise the error bars stretch the domain and every bar looks short. */}
            <YAxis domain={[0, 1]} allowDataOverflow tickFormatter={(v: number) => `${Math.round(v * 100)} %`} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} />
            <Tooltip formatter={(v) => `${(Number(v) * 100).toFixed(1)} %`} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: "var(--muted-foreground)" }}>{v}</span>} />
            {shown.map((r, i) => (
              <Bar key={r.variantId} dataKey={`v${i}`} name={`${r.promptVersion} · ${r.modelLabel}`} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false}>
                <ErrorBar dataKey={`e${i}`} width={4} strokeWidth={1.5} stroke="var(--foreground)" />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
