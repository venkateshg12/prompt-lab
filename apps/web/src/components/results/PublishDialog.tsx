"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useOrgPublished, usePublishRun } from "@/hooks/results/usePublish";
import { getErrorMessage } from "@/lib/errorMessage";

/* Publish a finished run to an unguessable /r/<slug>: read-only, no owner data, hidden inputs stay hidden. */
export function PublishDialog({ runId }: { runId: string }) {
  const published = useOrgPublished();
  const current = published.data?.data.find((p) => p.runId === runId);
  const { publish, unpublish } = usePublishRun(runId);
  const [title, setTitle] = useState("");
  const [includeNotes, setIncludeNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = current && typeof window !== "undefined" ? `${window.location.origin}/r/${current.slug}` : null;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant={current ? "secondary" : "default"} className="cursor-pointer" data-testid="open-publish">{current ? "Published" : "Publish…"}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Publish this run</DialogTitle>
          <DialogDescription>Anyone with the link can read the table, the caveats and the mistakes. Your name, email and workspace are never shown; inputs you marked private stay hidden.</DialogDescription>
        </DialogHeader>
        {url ? (
          <div className="space-y-2">
            <p className="text-sm">Public link:</p>
            <div className="flex gap-2">
              <Input readOnly value={url} data-testid="published-url" />
              <Button size="sm" variant="outline" className="cursor-pointer" onClick={() => void navigator.clipboard.writeText(url)}>Copy</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="publish-title" />
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} data-testid="publish-notes" /> include the run&apos;s notes
            </label>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {current ? (
            <Button variant="destructive" className="cursor-pointer" disabled={unpublish.isPending} data-testid="unpublish"
              onClick={() => unpublish.mutate(undefined, { onError: (e) => setError(getErrorMessage(e, "Unpublish failed")) })}>Unpublish</Button>
          ) : (
            <Button className="cursor-pointer" disabled={publish.isPending} data-testid="publish"
              onClick={() => publish.mutate({ title: title.trim() || undefined, includeNotes }, { onError: (e) => setError(getErrorMessage(e, "Publish failed")) })}>Publish</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
