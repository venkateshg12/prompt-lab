"use client";

import { useMemo } from "react";
import Link from "next/link";
import { createColumnHelper, createSortedRowModel, rowSortingFeature, tableFeatures, useTable } from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCell, type Best } from "./MetricCell";
import type { Interval, SummaryVariant } from "@/api/results";
import type { JudgeStats } from "@/api/judge";
import type { FieldRule } from "@repo/types";

// Nulls ("n/a") always sort last, whichever way the column is sorted.
const num = (a: unknown, b: unknown) => (a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : (a as number) - (b as number));
const features = tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns: {} });
type Row = Omit<SummaryVariant, "price">;
const col = createColumnHelper<typeof features, Row>();

type Dir = "high" | "low";
/* The best row per column. With intervals, the best is "unclear" when its interval overlaps the runner-up's. */
const bestOf = (rows: Row[], get: (r: Row) => Interval | number | null | undefined, dir: Dir): Map<string, Best> => {
  const vals = rows.map((r) => ({ id: r.variantId, v: get(r) })).filter((x) => x.v != null) as { id: string; v: Interval | number }[];
  const out = new Map<string, Best>();
  if (vals.length < 2) return out;
  const value = (x: Interval | number) => (typeof x === "number" ? x : x.value);
  vals.sort((a, b) => (dir === "high" ? value(b.v) - value(a.v) : value(a.v) - value(b.v)));
  const [first, second] = vals as [{ id: string; v: Interval | number }, { id: string; v: Interval | number }];
  if (value(first.v) === value(second.v)) return out; // a tie is nobody's win
  const overlap = typeof first.v !== "number" && typeof second.v !== "number" && (dir === "high" ? second.v.ci[1] >= first.v.ci[0] : second.v.ci[0] <= first.v.ci[1]);
  out.set(first.id, overlap ? "best-unclear" : "best");
  return out;
};

const naReason = (r: Row) =>
  r.technique === "structured" && r.structured !== "supported" ? `n/a: ${r.modelLabel} has no verified structured output (${r.structured})` : r.summary.scored === 0 ? "n/a: no scored results" : undefined;

/* `basePath` is /runs/<id> in the workspace and /r/<slug> on a published page; field cells link to its /errors. */
export function ResultsTable({ basePath, rows, fields, tag, linkFields = true, judge = null }: { basePath: string; rows: Row[]; fields: FieldRule[]; tag?: string; linkFields?: boolean; judge?: JudgeStats }) {
  const columns = useMemo(() => {
    const metric = (id: string, header: string, get: (r: Row) => Interval | null | undefined, opts: { link?: string } = {}) => {
      const best = bestOf(rows, get, "high");
      return col.accessor((r) => get(r)?.value ?? null, {
        id,
        header,
        sortFn: (a, b, c) => num(a.getValue(c), b.getValue(c)),
        sortUndefined: "last",
        cell: (i) => {
          const r = i.row.original;
          const cell = <MetricCell m={get(r)} n={r.summary.scored} best={best.get(r.variantId) ?? null} naReason={naReason(r)} testId={`cell-${id}-${r.variantId}`} />;
          if (!opts.link || !get(r)) return cell;
          const q = new URLSearchParams({ variant: r.variantId, field: opts.link, failedOnly: "true", ...(tag ? { tag } : {}) });
          return <Link href={`${basePath}/errors?${q}`} className="underline-offset-2 hover:underline" data-testid={`field-link-${opts.link}-${r.variantId}`}>{cell}</Link>;
        },
      });
    };
    const plain = (id: string, header: string, get: (r: Row) => number | null, fmt: (x: number) => string, dir?: Dir) => {
      const best = dir ? bestOf(rows, get, dir) : new Map<string, Best>();
      return col.accessor((r) => get(r), {
        id,
        header,
        sortFn: (a, b, c) => num(a.getValue(c), b.getValue(c)),
        cell: (i) => {
          const v = get(i.row.original);
          const b = best.get(i.row.original.variantId);
          return <span className={`tabular-nums ${b ? "font-semibold text-foreground" : "text-muted-foreground"}`} data-testid={`cell-${id}-${i.row.original.variantId}`}>{v == null ? "n/a" : fmt(v)}</span>;
        },
      });
    };
    return col.columns([
      col.accessor("promptVersion", {
        header: "Prompt",
        cell: (i) => (
          <span className="whitespace-nowrap">
            <span className="font-mono text-xs text-foreground">{i.getValue()}</span>{" "}
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{i.row.original.technique}</span>
          </span>
        ),
      }),
      col.accessor("modelLabel", { header: "Model", cell: (i) => <span className="whitespace-nowrap text-foreground" title={i.row.original.modelKey}>{i.getValue()}</span> }),
      metric("overall", "Overall", (r) => r.summary.metrics.overall),
      ...fields.map((f) => metric(`field_${f.key}`, f.key, (r) => r.summary.metrics[f.key], linkFields ? { link: f.key } : {})),
      metric("valid_json", "Valid JSON", (r) => r.summary.metrics.valid_json),
      metric("schema_valid", "Schema", (r) => r.summary.metrics.schema_valid),
      metric("exact_match", "Exact", (r) => r.summary.metrics.exact_match),
      // Consistency needs repeats: with one, it is n/a, never 100 %.
      metric("consistency", "Consistency", (r) => (r.summary.repeats >= 2 ? r.summary.metrics.consistency : null)),
      plain("cost100", "$/100", (r) => r.summary.costUsdPer100, (x) => `$${x.toFixed(4)}`, "low"),
      plain("p50", "p50", (r) => r.summary.p50Ms, (x) => `${Math.round(x)} ms`, "low"),
      plain("p95", "p95", (r) => r.summary.p95Ms, (x) => `${Math.round(x)} ms`, "low"),
      // The judge's pass rate is its own column, apart from the scores; dimmed with its numbers until validated.
      ...(judge ? [col.accessor((r) => { const s = judge.byVariant[r.variantId]; return s && s.judged ? s.passed / s.judged : null; }, {
        id: "judge",
        header: "Judge",
        sortFn: (a, b, c) => num(a.getValue(c), b.getValue(c)),
        cell: (i) => {
          const s = judge.byVariant[i.row.original.variantId];
          const v = judge.validation;
          if (!s || !s.judged) return <span className="text-xs text-muted-foreground">n/a</span>;
          const note = v.validated ? `judge pass rate, n=${s.judged}` : `not validated: agreement ${v.agreement == null ? "n/a" : (v.agreement * 100).toFixed(1) + " %"}, κ ${v.kappa == null ? "undefined" : v.kappa.toFixed(2)}, n ${v.n}`;
          return <span className={`tabular-nums ${v.validated ? "text-foreground" : "text-muted-foreground italic"}`} title={note} data-testid={`cell-judge-${i.row.original.variantId}`}>{((s.passed / s.judged) * 100).toFixed(1)} %{v.validated ? "" : " *"}</span>;
        },
      })] : []),
      plain("n", "n", (r) => r.summary.n, String),
      plain("errors", "errors", (r) => r.summary.errors, String),
      plain("skipped", "skipped", (r) => r.summary.skipped, String),
    ]);
  }, [rows, fields, basePath, tag, linkFields, judge]);

  const table = useTable({ features, columns, data: rows });
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table data-testid="results-table">
        <TableHeader>
          {table.getHeaderGroups().map((g) => (
            <TableRow key={g.id}>
              {g.headers.map((h) => (
                <TableHead key={h.id} className="whitespace-nowrap">
                  {h.isPlaceholder ? null : (
                    <button type="button" className="cursor-pointer select-none" onClick={h.column.getToggleSortingHandler()} data-testid={`sort-${h.column.id}`}>
                      <table.FlexRender header={h} />
                      {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                    </button>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((r) => (
            <TableRow key={r.id} data-testid={`result-row-${r.original.variantId}`}>
              {r.getAllCells().map((c) => <TableCell key={c.id}><table.FlexRender cell={c} /></TableCell>)}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        Rates over scored results; errors and skips are counted apart, never as zeros. Hover a rate for its 95 % interval and n.
        Bold = best in column; dimmed bold = best, but its interval overlaps the runner-up&apos;s.
      </p>
    </div>
  );
}
