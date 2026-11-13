/*
  The model's answer, verbatim. The span the scorer parsed (`extractedText`) is highlighted inside it;
  when nothing could be extracted, the whole output is shown plain and labelled so.
 */
export function RawOutput({ raw, extracted }: { raw: string | null; extracted: string | null }) {
  if (raw == null) return <p className="text-xs text-muted-foreground">No output (the call failed).</p>;
  const at = extracted ? raw.lastIndexOf(extracted) : -1;
  return (
    <div className="space-y-1">
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-mono text-xs text-foreground" data-testid="raw-output">
        {at >= 0 ? (
          <>
            {raw.slice(0, at)}
            <mark className="rounded-sm bg-emerald-500/20 text-foreground" data-testid="extracted-span">{raw.slice(at, at + extracted!.length)}</mark>
            {raw.slice(at + extracted!.length)}
          </>
        ) : raw}
      </pre>
      <p className="text-[11px] text-muted-foreground">{at >= 0 ? "Highlighted: the span the scorer parsed." : extracted ? "Extracted text (not found verbatim):" : "Nothing could be extracted from this output."}</p>
      {at < 0 && extracted && <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-xs">{extracted}</pre>}
    </div>
  );
}
