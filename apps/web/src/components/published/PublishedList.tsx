import Link from "next/link";
import type { PublicRunListItem } from "@/api/publish";

export function PublishedList({ runs }: { runs: PublicRunListItem[] }) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground" data-testid="no-published">Nothing published yet.</p>;
  return (
    <ul className="divide-y divide-border rounded-md border border-border" data-testid="published-list">
      {runs.map((r) => (
        <li key={r.slug} className="p-4">
          <Link href={`/r/${r.slug}`} className="font-medium text-foreground hover:underline" data-testid={`published-${r.slug}`}>{r.title}</Link>
          <p className="text-xs text-muted-foreground">
            {r.taskName} · {r.split} split · {new Date(r.publishedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}
            {r.best && <> · best: <span className="font-mono">{r.best.prompt}</span> on {r.best.model}, {(r.best.overall * 100).toFixed(1)} %</>}
          </p>
        </li>
      ))}
    </ul>
  );
}
