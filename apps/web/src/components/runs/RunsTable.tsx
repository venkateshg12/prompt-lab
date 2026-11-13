"use client";

import Link from "next/link";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RunStatusBadge } from "@/components/runs/RunStatusBadge";
import { shortDate, usd } from "@/lib/format";
import type { RunListItem } from "@/api/run";

// TanStack Table v9: features and columns at module scope. The server pages (cursor), so no client row models.
const features = tableFeatures({});
const col = createColumnHelper<typeof features, RunListItem>();

const columns = col.columns([
  col.accessor("status", { header: "Status", cell: (i) => <RunStatusBadge status={i.getValue()} /> }),
  col.accessor("task", { header: "Task", cell: (i) => <span className="text-foreground">{i.getValue().name}</span> }),
  col.display({
    id: "grid",
    header: "Grid",
    cell: (i) => {
      const g = i.row.original.grid;
      return <span className="whitespace-nowrap text-xs text-muted-foreground" data-testid="run-grid">{g.prompts} × {g.models} × {g.examples} × {g.repeats} = {i.row.original.totalCells}</span>;
    },
  }),
  col.accessor("split", {
    header: "Split",
    cell: (i) => (
      <span className="inline-flex items-center gap-1">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${i.getValue() === "dev" ? "bg-blue-500/10 text-blue-600" : "bg-purple-500/10 text-purple-600"}`}>{i.getValue()}</span>
        {i.row.original.testReused && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid="reused-badge">test reused</span>}
      </span>
    ),
  }),
  col.display({
    id: "progress",
    header: "Progress",
    cell: (i) => {
      const r = i.row.original;
      const pct = r.totalCells > 0 ? Math.round((r.doneCells / r.totalCells) * 100) : 0;
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-20 overflow-hidden rounded bg-muted"><div className="h-full bg-primary/70" style={{ width: `${pct}%` }} /></div>
          <span className="text-xs tabular-nums text-muted-foreground" data-testid="run-pct">{pct}%</span>
        </div>
      );
    },
  }),
  col.accessor("costUsdMicros", { header: "Cost", cell: (i) => <span className="tabular-nums text-muted-foreground">{usd(i.getValue())}</span> }),
  col.accessor("createdAt", { header: "Created", cell: (i) => <span className="text-xs text-muted-foreground">{shortDate(i.getValue())}</span> }),
]);

export function RunsTable({ rows }: { rows: RunListItem[] }) {
  const table = useTable({ features, columns, data: rows });
  return (
    <Table data-testid="runs-table">
      <TableHeader>
        {table.getHeaderGroups().map((g) => (
          <TableRow key={g.id}>
            {g.headers.map((h) => <TableHead key={h.id}>{h.isPlaceholder ? null : <table.FlexRender header={h} />}</TableHead>)}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((r) => (
          <TableRow key={r.id} data-testid={`run-row-${r.original.id}`}>
            {r.getAllCells().map((c, idx) => (
              <TableCell key={c.id}>
                {/* Every row links to its run; the link wraps the first cell so the whole row is one keyboard stop. */}
                {idx === 0 ? <Link href={`/runs/${r.original.id}`} className="underline-offset-2 hover:underline" data-testid="run-link"><table.FlexRender cell={c} /></Link> : <table.FlexRender cell={c} />}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
