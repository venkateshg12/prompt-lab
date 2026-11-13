import Link from "next/link";
import { ResultsTable } from "@/components/results/ResultsTable";
import type { PublicRun } from "@/api/publish";

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/* A published run: read-only. Metadata, caveats, the table, prompt text, and a way into the mistakes. Nothing that spends money. */
export function PublishedRunView({ run }: { run: PublicRun }) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-10 sm:px-6 lg:px-8" data-testid="published-run">
      <div className="space-y-1">
        <Link href="/r" className="text-xs text-muted-foreground hover:underline">Prompt<span className="text-primary">Lab</span> · published results</Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground" data-testid="published-title">{run.title}</h1>
        <p className="text-sm text-muted-foreground">
          Task <span className="text-foreground">{run.task.name}</span> v{run.run.taskVersion} · {run.run.split} split · {run.run.repeats} repeat{run.run.repeats === 1 ? "" : "s"} · {run.run.totalCells} cells · published {date(run.publishedAt)}
        </p>
      </div>
      {run.caveats.length > 0 && (
        <ul className="list-disc space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 py-3 pl-8 pr-4 text-sm text-amber-800 dark:text-amber-200" data-testid="caveats">
          {run.caveats.map((c) => <li key={c}>{c}</li>)}
        </ul>
      )}
      <ResultsTable basePath={`/r/${run.slug}`} rows={run.variants} fields={run.task.fields} />
      <div className="flex flex-wrap gap-4 text-sm">
        <Link href={`/r/${run.slug}/errors?failedOnly=true`} className="text-primary hover:underline" data-testid="public-errors-link">Browse the mistakes</Link>
      </div>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Models</h2>
        <ul className="text-sm text-muted-foreground">
          {run.models.map((m) => (
            <li key={m.key}>
              <span className="text-foreground">{m.label}</span> <span className="font-mono text-xs">{m.key}</span>
              {m.price && ` · $${(m.price.inputUsdMicrosPerMTok / 1e6).toFixed(3)} in / $${(m.price.outputUsdMicrosPerMTok / 1e6).toFixed(3)} out per 1M tokens, checked ${m.price.priceCheckedOn}`}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Prompts</h2>
        {run.prompts.map((p) => (
          <details key={p.ref} className="rounded-md border border-border bg-card p-3" data-testid={`prompt-${p.ref}`}>
            <summary className="cursor-pointer font-mono text-sm">{p.ref} <span className="text-xs text-muted-foreground">({p.technique})</span></summary>
            <p className="mt-2 text-xs text-muted-foreground">System</p>
            <pre className="whitespace-pre-wrap font-mono text-xs">{p.system}</pre>
            <p className="mt-2 text-xs text-muted-foreground">Template</p>
            <pre className="whitespace-pre-wrap font-mono text-xs">{p.template}</pre>
          </details>
        ))}
      </section>
      {run.run.notes && (
        <section className="space-y-1">
          <h2 className="text-lg font-semibold">Notes</h2>
          <pre className="whitespace-pre-wrap text-sm text-muted-foreground" data-testid="public-notes">{run.run.notes}</pre>
        </section>
      )}
      <details className="rounded-md border border-border p-3 text-sm">
        <summary className="cursor-pointer">This table as Markdown</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre font-mono text-xs" data-testid="public-markdown">{run.markdown}</pre>
      </details>
    </main>
  );
}
