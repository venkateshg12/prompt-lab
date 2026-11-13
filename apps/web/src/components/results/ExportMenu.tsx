"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { exportUrl, getMarkdown } from "@/api/publish";
import { getErrorMessage } from "@/lib/errorMessage";

/* Copy Markdown (the README table, generated), and the three downloads. Inputs and outputs are off by default in results.csv. */
export function ExportMenu({ orgId, runId }: { orgId: string; runId: string }) {
  const [includeText, setIncludeText] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const copy = async () => {
    try {
      const { data } = await getMarkdown(orgId, runId);
      await navigator.clipboard.writeText(data.markdown);
      setMsg("Markdown copied");
    } catch (e) {
      setMsg(getErrorMessage(e, "Couldn't copy the Markdown"));
    }
  };
  const link = "text-sm text-primary underline-offset-2 hover:underline";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3" data-testid="export-menu">
      <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void copy()} data-testid="copy-markdown">Copy Markdown</Button>
      <a className={link} href={exportUrl(orgId, runId, "summary.csv")} data-testid="dl-summary-csv">summary.csv</a>
      <a className={link} href={exportUrl(orgId, runId, "results.csv", includeText)} data-testid="dl-results-csv">results.csv</a>
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={includeText} onChange={(e) => setIncludeText(e.target.checked)} data-testid="include-text" /> include inputs and outputs
      </label>
      <a className={link} href={exportUrl(orgId, runId, "results.jsonl")} data-testid="dl-results-jsonl">results.jsonl</a>
      {msg && <span className="text-xs text-muted-foreground" data-testid="export-msg">{msg}</span>}
    </div>
  );
}
