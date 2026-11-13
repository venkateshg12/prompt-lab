"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRescore } from "@/hooks/results/useRescore";
import { getErrorMessage } from "@/lib/errorMessage";

/* The stored scores were computed with older rules or labels. Re-scoring reuses the stored raw outputs: no model call. */
export function StaleBanner({ runId, stale, canRescore }: { runId: string; stale: { rules: boolean; labels: boolean }; canRescore: boolean }) {
  const rescore = useRescore(runId);
  const [msg, setMsg] = useState<string | null>(null);
  if (!stale.rules && !stale.labels) return null;
  const what = [stale.rules && "the task's rules", stale.labels && "labels"].filter(Boolean).join(" and ");
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200" data-testid="stale-banner">
      <span>Stale: {what} changed after this run was scored. Re-scoring uses the stored outputs, with no model calls.</span>
      {canRescore && (
        <Button size="sm" variant="outline" className="cursor-pointer" disabled={rescore.isPending || rescore.isSuccess} data-testid="rescore"
          onClick={() => rescore.mutate(undefined, { onSuccess: () => setMsg("Re-scoring…"), onError: (e) => setMsg(getErrorMessage(e, "Re-score failed")) })}>
          Re-score
        </Button>
      )}
      {msg && <span className="text-xs" data-testid="rescore-msg">{msg}</span>}
    </div>
  );
}
