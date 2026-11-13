"use client";

import { useMemo } from "react";
import { CartesianGrid, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { paretoFront } from "@repo/scoring";
import type { SummaryVariant } from "@/api/results";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)"];
const SHAPES = { zero_shot: "circle", few_shot: "square", cot: "triangle", structured: "diamond", custom: "star" } as const;
type Point = { id: string; label: string; model: string; technique: string; cost: number; accuracy: number; p95: number | null; valid: number | null; n: number };

/*
  Cost vs accuracy from the stored summaries only (the same numbers as the table). One point per prompt ×
  model: colour = model (≤ 3, the validated palette), shape = technique. The Pareto front is the line.
  Rows that scored nothing (skipped structured cells) aren't plotted and are listed under the chart.
 */
export function CostAccuracyChart({ rows }: { rows: Omit<SummaryVariant, "price">[] }) {
  const models = useMemo(() => [...new Set(rows.map((r) => r.modelLabel))], [rows]);
  const points: Point[] = rows
    .filter((r) => r.summary.metrics.overall && r.summary.costUsdPer100 != null)
    .map((r) => ({
      id: r.variantId, label: r.promptVersion, model: r.modelLabel, technique: r.technique,
      cost: Math.max(r.summary.costUsdPer100!, 1e-6), accuracy: r.summary.metrics.overall!.value,
      p95: r.summary.p95Ms, valid: r.summary.metrics.valid_json?.value ?? null, n: r.summary.n,
    }));
  const skipped = rows.filter((r) => !r.summary.metrics.overall);
  const front = paretoFront(points);
  const costs = points.map((p) => p.cost);
  const log = costs.length > 1 && Math.max(...costs) / Math.min(...costs) > 10;
  if (models.length > 3) return <p className="text-xs text-muted-foreground">More than three models: compare them in the table (the chart keeps one colour per model, at most three).</p>;
  if (points.length === 0) return null;
  return (
    <figure className="space-y-2 rounded-md border border-border bg-card p-4" data-testid="cost-accuracy-chart">
      <figcaption className="text-sm font-medium text-foreground">Cost vs accuracy <span className="text-xs font-normal text-muted-foreground">(line: the Pareto front, nothing is both cheaper and more accurate)</span></figcaption>
      <div className="h-72 w-full">
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 10, right: 24, bottom: 28, left: 8 }}>
            <CartesianGrid stroke="var(--border)" strokeOpacity={0.6} />
            <XAxis type="number" dataKey="cost" name="$ per 100 inputs" scale={log ? "log" : "auto"}
              domain={log ? [Math.min(...costs) / 1.5, Math.max(...costs) * 1.5] : ["auto", "auto"]}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(v: number) => (v === 0 ? "$0" : `$${v.toPrecision(2)}`)}
              label={{ value: `$ per 100 inputs${log ? " (log)" : ""}`, position: "insideBottom", offset: -16, fill: "var(--muted-foreground)", fontSize: 11 }} />
            <YAxis type="number" dataKey="accuracy" name="Overall" domain={[0, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)} %`}
              tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
              label={{ value: "Overall", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 11 }} />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as Point | undefined) : undefined;
              if (!p) return null;
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow">
                  <p className="font-mono">{p.label}</p>
                  <p className="text-muted-foreground">{p.model} · {p.technique}</p>
                  <p>Overall {(p.accuracy * 100).toFixed(1)} % · n {p.n}</p>
                  <p>${p.cost.toFixed(4)} / 100 · p95 {p.p95 == null ? "n/a" : `${Math.round(p.p95)} ms`} · valid JSON {p.valid == null ? "n/a" : `${(p.valid * 100).toFixed(1)} %`}</p>
                </div>
              );
            }} />
            <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 11 }} formatter={(v) => <span style={{ color: "var(--muted-foreground)" }}>{v}</span>} />
            {models.map((m, i) => (
              <Scatter key={m} name={m} isAnimationActive={false} data={points.filter((p) => p.model === m)} fill={SERIES[i]} stroke="var(--background)" strokeWidth={2}
                shape={(props: unknown) => {
                  const { cx, cy, payload } = props as { cx: number; cy: number; payload: Point };
                  const kind = SHAPES[payload.technique as keyof typeof SHAPES] ?? "circle";
                  const c = SERIES[i];
                  if (kind === "square") return <rect x={cx - 5} y={cy - 5} width={10} height={10} rx={2} fill={c} stroke="var(--background)" strokeWidth={2} />;
                  if (kind === "triangle") return <path d={`M${cx},${cy - 6} L${cx + 6},${cy + 5} L${cx - 6},${cy + 5} Z`} fill={c} stroke="var(--background)" strokeWidth={2} />;
                  if (kind === "diamond") return <path d={`M${cx},${cy - 6} L${cx + 6},${cy} L${cx},${cy + 6} L${cx - 6},${cy} Z`} fill={c} stroke="var(--background)" strokeWidth={2} />;
                  return <circle cx={cx} cy={cy} r={5} fill={c} stroke="var(--background)" strokeWidth={2} />;
                }} />
            ))}
            <Scatter name="Pareto front" isAnimationActive={false} data={front} line={{ stroke: "var(--muted-foreground)", strokeWidth: 2 }} lineType="joint" shape={() => <g />} legendType="line" fill="var(--muted-foreground)" />
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-muted-foreground" data-testid="pareto-front">Front: {front.map((p) => `${p.label} · ${p.model}`).join(" → ")}</p>
      {skipped.length > 0 && <p className="text-xs text-muted-foreground" data-testid="chart-skipped">Not plotted (nothing scored): {skipped.map((r) => `${r.promptVersion} · ${r.modelLabel}`).join(", ")}</p>}
      <p className="text-[11px] text-muted-foreground">Shapes: ● zero-shot · ■ few-shot · ▲ chain-of-thought · ◆ structured. Exact numbers are in the table below.</p>
    </figure>
  );
}
