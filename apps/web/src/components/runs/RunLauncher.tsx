"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BudgetBar } from "@/components/runs/BudgetBar";
import { CostEstimate } from "@/components/runs/CostEstimate";
import { GridSummary } from "@/components/runs/GridSummary";
import { TestRunCallout } from "@/components/runs/TestRunCallout";
import { useModels } from "@/hooks/models/useModels";
import { usePrompts } from "@/hooks/prompts/usePrompts";
import { useCreateRun } from "@/hooks/runs/useCreateRun";
import { useEstimateRun } from "@/hooks/runs/useEstimateRun";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";
import { getErrorMessage } from "@/lib/errorMessage";
import { shortDate, usd } from "@/lib/format";
import type { RunBody } from "@/api/run";

const PROVIDER_KEY: Record<string, string> = { nvidia: "NVIDIA_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" };

/*
  The launcher only chooses; the SERVER prices and validates. Every selection change asks
  `POST /runs/estimate` (debounced), which uses the same planning code as the real `POST /runs`, so the
  grid size, the skipped cells, the budget verdict and the test-reuse flag shown here cannot disagree with
  what Start will do. Start is disabled with the reason; the API refuses the same cases on its own.
 */
export function RunLauncher({ taskId, open, onClose }: { taskId: string; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { org } = useCurrentOrg();
  const prompts = usePrompts(taskId);
  const models = useModels();
  const create = useCreateRun();

  const [chosenPrompts, setChosenPrompts] = useState<Record<string, string>>({}); // prompt key → chosen version id
  const [chosenModels, setChosenModels] = useState<string[]>([]);
  const [split, setSplit] = useState<"dev" | "test">("dev");
  const [repeats, setRepeats] = useState(1);
  const [notes, setNotes] = useState("");
  const [final, setFinal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const promptList = prompts.data?.data ?? [];
  const modelList = useMemo(() => models.data?.data ?? [], [models.data]);
  const byProvider = useMemo(() => {
    const groups = new Map<string, typeof modelList>();
    for (const m of modelList.filter((m) => m.active)) groups.set(m.provider, [...(groups.get(m.provider) ?? []), m]);
    return [...groups.entries()];
  }, [modelList]);

  const promptVersionIds = Object.values(chosenPrompts);
  const body: RunBody | null = promptVersionIds.length > 0 && chosenModels.length > 0
    ? { taskId, promptVersionIds, modelKeys: chosenModels, split, repeats }
    : null;
  const estimate = useEstimateRun(body);
  const est = estimate.data?.data;
  const estimateError = estimate.isError ? getErrorMessage(estimate.error, "Couldn't estimate this run") : null;

  const blocked =
    !body ? "Pick at least one prompt and one model"
    : estimateError ? estimateError
    : !est || !estimate.settled || estimate.isFetching ? "Estimating…"
    : !est.withinBudget ? `Estimate exceeds the ${usd(Math.max(0, est.budget.remaining))} left this month`
    : split === "test" && !final ? "Tick “This is a final run” to use the test set"
    : null;

  const start = () => {
    if (!body) return;
    setError(null);
    create.mutate({ ...body, notes: notes || undefined, confirmFinal: split === "test" ? final : false }, {
      onSuccess: (r) => { onClose(); router.push(`/runs/${r.data.id}`); },
      onError: (e) => setError(getErrorMessage(e, "Couldn't start the run")),
    });
  };

  const togglePrompt = (key: string, id: string, on: boolean) =>
    setChosenPrompts((cur) => { const next = { ...cur }; if (on) next[key] = id; else delete next[key]; return next; });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="run-launcher">
        <SheetHeader>
          <SheetTitle>New run</SheetTitle>
          <SheetDescription>Prompt versions × models × split × repeats. Starting a run freezes the prompt versions it uses.</SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-6">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-sm font-semibold text-foreground">Prompts</legend>
            {prompts.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {!prompts.isLoading && promptList.length === 0 && <p className="text-xs text-muted-foreground" data-testid="launcher-no-prompts">No prompts yet. Create one in the Prompts tab.</p>}
            {promptList.map((p) => {
              const versions = p.history?.length ? p.history : [{ id: p.id, version: p.version, versionId: p.versionId, frozenAt: p.frozenAt }];
              const picked = chosenPrompts[p.key];
              return (
                <div key={p.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                  <label className="flex flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" checked={picked !== undefined} onChange={(e) => togglePrompt(p.key, picked ?? p.id, e.target.checked)} data-testid={`pick-prompt-${p.key}`} />
                    <span className="font-mono text-foreground">{p.key}</span>
                    <span className="text-[11px] text-muted-foreground">{p.technique}</span>
                  </label>
                  <select aria-label={`Version of ${p.key}`} value={picked ?? p.id} disabled={versions.length < 2} onChange={(e) => picked !== undefined && togglePrompt(p.key, e.target.value, true)}
                    className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-60" data-testid={`version-${p.key}`}>
                    {versions.map((v) => <option key={v.id} value={v.id}>@{v.version}{v.frozenAt ? " (frozen)" : " (draft)"}</option>)}
                  </select>
                </div>
              );
            })}
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-semibold text-foreground">Models</legend>
            {models.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
            {byProvider.map(([provider, list]) => (
              <div key={provider} className="space-y-1.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{provider}</p>
                {list.map((m) => {
                  const disabled = !m.enabled;
                  return (
                    <label key={m.key} title={disabled ? `Add ${PROVIDER_KEY[m.provider] ?? "the provider key"} to enable` : undefined}
                      className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}>
                      <input type="checkbox" disabled={disabled} checked={chosenModels.includes(m.key)} data-testid={`pick-model-${m.key}`}
                        onChange={(e) => setChosenModels(e.target.checked ? [...chosenModels, m.key] : chosenModels.filter((k) => k !== m.key))} />
                      <span className="flex-1">
                        <span className="text-foreground">{m.label}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {usd(m.inputUsdMicrosPerMTok)} in / {usd(m.outputUsdMicrosPerMTok)} out per 1M tokens · checked {shortDate(m.priceCheckedOn)}
                          {disabled && ` · add ${PROVIDER_KEY[m.provider] ?? "the provider key"}`}
                        </span>
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${m.structured === "supported" ? "bg-emerald-500/10 text-emerald-600" : m.structured === "unsupported" ? "bg-muted text-muted-foreground" : "bg-amber-500/10 text-amber-700"}`}>
                        structured: {m.structured}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </fieldset>

          <div className="grid grid-cols-2 gap-4">
            <fieldset>
              <legend className="mb-1 text-sm font-semibold text-foreground">Split</legend>
              <div className="flex gap-4 text-sm">
                {(["dev", "test"] as const).map((s) => (
                  <label key={s} className="flex items-center gap-1.5"><input type="radio" name="split" checked={split === s} onChange={() => setSplit(s)} data-testid={`split-${s}`} /> {s}</label>
                ))}
              </div>
            </fieldset>
            <label className="text-sm font-semibold text-foreground">Repeats
              <select value={repeats} onChange={(e) => setRepeats(Number(e.target.value))} className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal" data-testid="repeats">
                {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}{n === 3 ? " (measures consistency)" : ""}</option>)}
              </select>
            </label>
          </div>
          <label className="block text-sm font-semibold text-foreground">Notes
            <Input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 font-normal" placeholder="optional" />
          </label>

          <section className="space-y-3 rounded-lg border border-border p-3" data-testid="launcher-summary">
            <GridSummary prompts={promptVersionIds.length} models={chosenModels.length} repeats={repeats} estimate={est} />
            <CostEstimate estimate={est} />
            <BudgetBar estimate={est} />
            {split === "test" && <TestRunCallout reused={est?.testReused ?? false} confirmed={final} onConfirm={setFinal} />}
          </section>

          {error && <p className="text-xs text-destructive" data-testid="launcher-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button className="cursor-pointer" disabled={blocked !== null || create.isPending || !org} onClick={start} data-testid="start-run">
              {create.isPending ? "Starting…" : "Start run"}
            </Button>
            {blocked && <p className="text-xs text-muted-foreground" data-testid="start-blocked">{blocked}</p>}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
