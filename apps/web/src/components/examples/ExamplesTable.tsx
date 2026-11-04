"use client";

import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ExampleItem } from "@/api/example";

// TanStack Table v9: the features object and the columns live at module scope so row models aren't rebuilt
// on every render. The server filters and pages, so the table needs no client row models.
const features = tableFeatures({});
const col = createColumnHelper<typeof features, ExampleItem>();

const SplitBadge = ({ split }: { split: string }) => (
  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${split === "dev" ? "bg-blue-500/10 text-blue-600" : "bg-purple-500/10 text-purple-600"}`}>{split}</span>
);

/** `title · salary` for the job-postings shape, "N fields" for any other task, so a second task never breaks the table. */
const LabelSummary = ({ expected, hidden }: { expected: Record<string, unknown> | null; hidden: boolean }) => {
  if (hidden || !expected) return <span className="text-xs italic text-muted-foreground">hidden until you label</span>;
  const title = typeof expected.title === "string" ? expected.title : null;
  const salary = expected.stipend_or_salary as { min: number | null; max: number | null; currency: string; period: string } | null | undefined;
  if (title !== null) {
    const pay = salary === undefined ? "" : salary === null ? "no salary" : `${salary.currency} ${salary.min ?? "?"}–${salary.max ?? "?"}/${salary.period}`;
    return <span className="text-xs text-muted-foreground">{title}{pay ? ` · ${pay}` : ""}</span>;
  }
  return <span className="text-xs text-muted-foreground">{Object.keys(expected).length} fields</span>;
};

const columns = col.columns([
  col.accessor("ref", { header: "Id", cell: (i) => <span className="font-mono text-xs">{i.getValue()}</span> }),
  col.accessor("split", { header: "Split", cell: (i) => <SplitBadge split={i.getValue()} /> }),
  col.accessor("tags", {
    header: "Tags",
    cell: (i) => (
      <div className="flex flex-wrap gap-1">
        {i.getValue().map((t) => <span key={t} className="rounded border border-border px-1 text-[11px] text-muted-foreground">{t}</span>)}
        {i.row.original.unsplit && <span className="rounded border border-amber-500/40 px-1 text-[11px] text-amber-600">unsplit</span>}
      </div>
    ),
  }),
  col.accessor("input", { header: "Input", cell: (i) => <span className="line-clamp-1 max-w-[22rem] text-muted-foreground">{i.getValue().slice(0, 80)}</span> }),
  col.display({ id: "label", header: "Label", cell: (i) => <LabelSummary expected={i.row.original.expected} hidden={i.row.original.expectedHidden} /> }),
  col.accessor("revision", { header: "Rev" }),
]);

export function ExamplesTable({ rows, onOpen }: { rows: ExampleItem[]; onOpen: (id: string) => void }) {
  const table = useTable({ features, columns, data: rows });
  return (
    <Table data-testid="examples-table">
      <TableHeader>
        {table.getHeaderGroups().map((g) => (
          <TableRow key={g.id}>
            {g.headers.map((h) => <TableHead key={h.id}>{h.isPlaceholder ? null : <table.FlexRender header={h} />}</TableHead>)}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((r) => (
          <TableRow key={r.id} className="cursor-pointer" data-testid={`example-row-${r.original.ref}`} onClick={() => onOpen(r.original.id)}>
            {r.getAllCells().map((c) => <TableCell key={c.id}><table.FlexRender cell={c} /></TableCell>)}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
