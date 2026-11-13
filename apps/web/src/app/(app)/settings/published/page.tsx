"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgPublished } from "@/hooks/results/usePublish";

/* The workspace's public links. Unpublishing is on each run's page (Publish dialog). */
export default function PublishedSettingsPage() {
  const { data, isLoading } = useOrgPublished();
  const rows = data?.data ?? [];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Published runs</h1>
      {isLoading ? <Skeleton className="h-24" /> : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="no-org-published">No published runs. Publish a finished run from its page.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border" data-testid="org-published">
          {rows.map((r) => (
            <li key={r.slug} className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <Link href={`/r/${r.slug}`} className="font-mono text-primary hover:underline">/r/{r.slug}</Link>
              <span className="text-foreground">{r.options?.title ?? `${r.taskName}: ${r.split} run`}</span>
              <span className="text-xs text-muted-foreground">{new Date(r.publishedAt).toLocaleDateString()}</span>
              <Link href={`/runs/${r.runId}`} className="ml-auto text-xs text-muted-foreground hover:underline">open run</Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
