"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ExamplesTable } from "./ExamplesTable";
import { ExampleSheet } from "./ExampleSheet";
import { ImportDialog } from "./ImportDialog";
import { AgreementPanel } from "./AgreementPanel";
import { useAutoSplit, useExamples } from "@/hooks/examples/useExamples";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";
import { getErrorMessage } from "@/lib/errorMessage";
import type { FieldRule } from "@repo/types";

/* Filters live in the URL (?tab=examples&split=dev&tag=salary_lpa&q=lpa): they survive a reload and can be pasted into notes. */
export function ExamplesTab({ taskId, fields, hasTestRun }: { taskId: string; fields: FieldRule[]; hasTestRun: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { role } = useCurrentOrg();
  const canEdit = role === "owner" || role === "admin";
  const canSecondLabel = canEdit || role === "reviewer";
  const split = params.get("split") === "dev" || params.get("split") === "test" ? (params.get("split") as "dev" | "test") : undefined;
  const tag = params.get("tag") || undefined;
  const q = params.get("q") || undefined;
  const filters = useMemo(() => ({ split, tag, q }), [split, tag, q]);
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useExamples(taskId, filters);
  const autoSplit = useAutoSplit(taskId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  };
  const unsplit = rows.filter((r) => r.unsplit).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Split filter" value={split ?? ""} onChange={(e) => setParam("split", e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" data-testid="filter-split">
          <option value="">all splits</option><option value="dev">dev</option><option value="test">test</option>
        </select>
        <Input aria-label="Tag filter" placeholder="tag" defaultValue={tag ?? ""} onBlur={(e) => setParam("tag", e.target.value.trim())} onKeyDown={(e) => { if (e.key === "Enter") setParam("tag", (e.target as HTMLInputElement).value.trim()); }} className="h-9 w-40" data-testid="filter-tag" />
        <Input aria-label="Search" placeholder="search id or text" defaultValue={q ?? ""} onKeyDown={(e) => { if (e.key === "Enter") setParam("q", (e.target as HTMLInputElement).value.trim()); }} className="h-9 w-56" data-testid="filter-q" />
        <div className="ml-auto flex gap-2">
          {canEdit && unsplit > 0 && (
            <Button size="sm" variant="outline" className="cursor-pointer" data-testid="auto-split" disabled={autoSplit.isPending}
              onClick={() => autoSplit.mutate(undefined, { onSuccess: (r) => setNotice(`Assigned ${r.data.assigned}: ${r.data.dev} dev / ${r.data.test} test`), onError: (e) => setNotice(getErrorMessage(e, "Split failed")) })}>
              Auto-split {unsplit} unsplit
            </Button>
          )}
          {canEdit && <ImportDialog taskId={taskId} />}
        </div>
      </div>
      {notice && <p className="text-xs text-muted-foreground" data-testid="split-notice">{notice}</p>}
      {isLoading ? (
        <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      ) : isError ? (
        <p className="text-sm text-destructive">Couldn&apos;t load the test set.</p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="examples-empty">
          No examples{split || tag || q ? " match these filters" : " yet"}.{canEdit && !split && !tag && !q ? " Use Import to add your labelled cases." : ""}
        </div>
      ) : (
        <ExamplesTable rows={rows} onOpen={setOpenId} />
      )}
      {hasNextPage && <Button variant="outline" size="sm" className="cursor-pointer" data-testid="load-more" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>Load more</Button>}
      <AgreementPanel taskId={taskId} />
      <ExampleSheet taskId={taskId} fields={fields} example={rows.find((r) => r.id === openId) ?? null} canEdit={canEdit} canSecondLabel={canSecondLabel} hasTestRun={hasTestRun} onClose={() => setOpenId(null)} />
    </div>
  );
}
