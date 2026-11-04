"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useImportExamples } from "@/hooks/examples/useExamples";
import { getErrorMessage } from "@/lib/errorMessage";
import type { ImportReport } from "@/api/example";

/*
  Paste or pick a .jsonl / .csv file (read with FileReader; only text is sent). Check → dry-run report →
  Import. Import stays disabled until the report says invalid = 0: a half-imported test set is worse than none.
 */
export function ImportDialog({ taskId }: { taskId: string }) {
  const imp = useImportExamples(taskId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<"jsonl" | "csv">("jsonl");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setReport(null); setError(null); };
  const check = () => {
    setError(null);
    imp.mutate({ format, content, dryRun: true }, { onSuccess: (r) => setReport(r.data), onError: (e) => setError(getErrorMessage(e, "Could not check the file")) });
  };
  const commit = () =>
    imp.mutate({ format, content, dryRun: false }, {
      onSuccess: () => { setOpen(false); setContent(""); reset(); },
      onError: (e) => setError(getErrorMessage(e, "Import failed")),
    });
  const canImport = Boolean(report && report.invalid.length === 0 && report.valid > 0);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild><Button variant="outline" size="sm" className="cursor-pointer" data-testid="open-import"><Upload className="h-4 w-4" /> Import</Button></DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import examples</DialogTitle>
          <DialogDescription>One case per line: {"{ id, split, tags, input, expected }"}. Rows upsert by id; nothing is written until every row is valid.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <select aria-label="Format" value={format} onChange={(e) => { setFormat(e.target.value as "jsonl" | "csv"); reset(); }} className="rounded-md border border-border bg-background px-2 py-1 text-sm">
              <option value="jsonl">JSONL</option><option value="csv">CSV</option>
            </select>
            <input ref={fileRef} type="file" accept=".jsonl,.csv,.json,.txt" data-testid="import-file" className="text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setFormat(f.name.toLowerCase().endsWith(".csv") ? "csv" : "jsonl");
                const reader = new FileReader();
                reader.onload = () => { setContent(String(reader.result ?? "")); reset(); };
                reader.readAsText(f);
              }} />
          </div>
          <Textarea aria-label="Examples file content" rows={10} className="font-mono text-xs" placeholder="Paste JSONL or CSV here" value={content} onChange={(e) => { setContent(e.target.value); reset(); }} />
          {report && (
            <div className="space-y-2 rounded-lg border border-border p-3 text-sm" data-testid="import-report">
              <p data-testid="import-counts">valid {report.valid} · invalid {report.invalid.length} · new {report.new} · changed {report.changed} · unchanged {report.unchanged}</p>
              {report.invalid.length > 0 && (
                <ul className="max-h-40 space-y-1 overflow-auto text-xs text-destructive" data-testid="import-invalid">
                  {report.invalid.map((b) => <li key={b.line}>line {b.line}{b.ref ? ` (${b.ref})` : ""}: {b.issues.join("; ")}</li>)}
                </ul>
              )}
            </div>
          )}
          {error && <p className="text-xs text-destructive" data-testid="import-error">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={!content.trim() || imp.isPending} className="cursor-pointer" data-testid="import-check" onClick={check}>Check</Button>
          <Button disabled={!canImport || imp.isPending} className="cursor-pointer" data-testid="import-commit" onClick={commit}>Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
