import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { API_URL } from "@/constants/env";
import type { RunDetail } from "@/api/run";
import type { SuccessResponse } from "@/types";
import type { RunProgress } from "@repo/types";

const GRACE_MS = 10_000;

/*
  Live progress. Every `progress` message carries the run's counters AS THE DATABASE HAS THEM, so the
  handler overwrites the cached run with them (`setQueryData`) and never adds messages up: a dropped,
  duplicated or reordered message cannot corrupt a number, and a reconnect simply shows the latest.
  If the stream stays down for 10 s, `fallback` turns on and `useRun` polls instead.
 */
export const useRunEvents = (orgId: string | undefined, runId: string) => {
  const qc = useQueryClient();
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    if (!orgId) return;
    const key = ["run", orgId, runId];
    /*
      Re-read the run from the API, cancelling any fetch already in flight first. invalidateQueries alone
      REUSES an in-flight fetch when the query has no data yet (TanStack Query only cancels when data
      exists), so a first GET started while the run was "running" could land after the terminal message
      and leave the page stuck on "running 3/3 · live" (found by the golden-path spec on a 3-cell run).
     */
    const refetchRun = () => void qc.cancelQueries({ queryKey: key }).then(() => qc.invalidateQueries({ queryKey: key }));
    const source = new EventSource(`${API_URL}/orgs/${orgId}/runs/${runId}/events`, { withCredentials: true });
    let grace: ReturnType<typeof setTimeout> | null = null;
    source.onopen = () => {
      setFallback(false);
      if (grace) clearTimeout(grace);
      grace = null;
      refetchRun(); // whatever was missed while it was down
    };
    source.onerror = () => {
      grace ??= setTimeout(() => setFallback(true), GRACE_MS);
    };
    source.addEventListener("progress", (e) => {
      const p = JSON.parse((e as MessageEvent).data) as RunProgress;
      // Only the database counters; `skippedCells` / `costUsdMicros` are absent on an un-enriched message and then keep their last value.
      const counters = {
        status: p.status, doneCells: p.doneCells, errorCells: p.errorCells, totalCells: p.totalCells,
        ...(p.skippedCells !== undefined ? { skippedCells: p.skippedCells } : {}),
        ...(p.costUsdMicros !== undefined ? { costUsdMicros: p.costUsdMicros } : {}),
      };
      qc.setQueryData<SuccessResponse<RunDetail>>(["run", orgId, runId], (old) => (old ? { ...old, data: { ...old.data, ...counters } } : old));
      if (p.rescored) {
        // Re-scored from stored outputs: every number and every card on the page may have moved.
        void qc.invalidateQueries({ queryKey: ["run-summary", orgId, runId] });
        void qc.invalidateQueries({ queryKey: ["results", orgId, runId] });
        void qc.invalidateQueries({ queryKey: ["compare", orgId, runId] });
      }
      if (p.status !== "queued" && p.status !== "running") {
        // Over: refetch once for the per-model numbers and let Phase 21's table load its summary.
        refetchRun();
        void qc.invalidateQueries({ queryKey: ["run-summary", orgId, runId] });
        void qc.invalidateQueries({ queryKey: ["runs"] });
      }
    });
    return () => {
      source.close();
      if (grace) clearTimeout(grace);
    };
  }, [orgId, runId, qc]);
  return { fallback };
};
