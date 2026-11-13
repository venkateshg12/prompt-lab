"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ResultsTable } from "@/components/results/ResultsTable";
import { ResultCard } from "@/components/errors/ResultCard";
import type { DemoResponse } from "@/api/demo";
import type { FieldRule } from "@repo/types";
import type { ResultItem } from "@/api/results";

/* The visitor's sample, scored like a real run, shown read-only. Download JSON is built in the browser: nothing goes back to the server. */
export function DemoResults({ data, fields }: { data: DemoResponse; fields: FieldRule[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const row = {
    variantId: "demo", promptVersion: data.promptVersion, technique: data.technique, modelKey: data.modelKey, modelLabel: data.modelLabel,
    structured: "supported" as const, structuredProbedAt: null, summary: data.summary,
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `prompt-lab-demo-${data.promptVersion}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const items: ResultItem[] = data.results.map((r, i) => ({
    id: `${r.exampleRef}-${i}`, variantId: "demo", promptVersion: data.promptVersion, modelKey: data.modelKey, exampleRef: r.exampleRef, tags: r.tags,
    input: r.input, expected: r.expected, repeat: 0, status: r.status, rawOutput: r.rawOutput ?? null, extractedText: r.extractedText ?? null,
    parsedJson: r.parsedJson ?? null, validJson: r.validJson ?? null, schemaValid: r.schemaValid ?? null, exactMatch: r.exactMatch ?? null,
    overallScore: r.overallScore ?? null, fieldScores: r.fieldScores ?? null, fieldDetails: r.fieldDetails ?? null, latencyMs: r.latencyMs ?? null,
    costUsdMicros: r.costUsdMicros ?? null, inputTokens: r.inputTokens ?? null, outputTokens: r.outputTokens ?? null, finishReason: r.finishReason ?? null,
    attempts: r.attempts ?? 1, error: r.error ?? null,
  }));
  return (
    <section className="space-y-4" data-testid="demo-results">
      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
        This is a {data.results.length}-example sample on your key, not the published result.
      </p>
      <ResultsTable basePath="/demo" rows={[row]} fields={fields} linkFields={false} />
      <Button size="sm" variant="outline" className="cursor-pointer" onClick={download} data-testid="demo-download">Download JSON</Button>
      <div className="space-y-3">
        {items.map((r) => (
          <ResultCard key={r.id} r={r} active={false} expanded={open.has(r.id)}
            onToggle={() => setOpen((s) => { const n = new Set(s); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} />
        ))}
      </div>
    </section>
  );
}
