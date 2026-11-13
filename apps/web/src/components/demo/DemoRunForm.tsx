"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { KeyInput } from "./KeyInput";
import { DemoResults } from "./DemoResults";
import { DemoError, getDemoOptions, runDemo, type DemoResponse } from "@/api/demo";
import { publicUrl, type PublicRun, type PublicRunListItem } from "@/api/publish";
import { readStoredKey, writeStoredKey } from "@/lib/providerKey";
import type { SuccessResponse } from "@/types";

const MAX = 10;
const PRESELECT = 5;
type State = { kind: "idle" } | { kind: "running" } | { kind: "done"; data: DemoResponse } | { kind: "error"; message: string } | { kind: "limited" };

/*
  Published run → prompt × model of that run → up to 10 of its public dev examples → run on YOUR key.
  The key lives in this component's state (and in sessionStorage only when "remember for this tab" is on).
 */
export function DemoRunForm({ initialSlug }: { initialSlug?: string }) {
  const runs = useQuery({
    queryKey: ["public-runs"],
    queryFn: async () => ((await (await fetch(publicUrl("/runs"))).json()) as SuccessResponse<PublicRunListItem[]>).data,
  });
  const [slug, setSlug] = useState(initialSlug ?? "");
  const activeSlug = slug || runs.data?.[0]?.slug || "";
  const options = useQuery({ queryKey: ["demo-options", activeSlug], queryFn: () => getDemoOptions(activeSlug), enabled: Boolean(activeSlug) });
  const run = useQuery({
    queryKey: ["public-run", activeSlug],
    queryFn: async () => ((await (await fetch(publicUrl(`/runs/${activeSlug}`))).json()) as SuccessResponse<PublicRun>).data,
    enabled: Boolean(activeSlug),
  });
  const [variant, setVariant] = useState("");
  const [picked, setPicked] = useState<string[] | null>(null);
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const keyRef = useRef<HTMLInputElement>(null);

  // A remembered key comes back only in this tab (sessionStorage); then "remember" shows as on.
  useEffect(() => {
    const stored = readStoredKey();
    if (stored) {
      setKey(stored);
      setRemember(true);
    }
  }, []);
  useEffect(() => writeStoredKey(remember ? key : null), [remember, key]);

  const variants = options.data?.variants ?? [];
  const chosen = variants.find((v) => `${v.promptVersion}|${v.modelKey}` === variant) ?? variants[0];
  const examples = options.data?.examples ?? [];
  const refs = picked ?? examples.slice(0, PRESELECT).map((e) => e.ref);
  const toggle = (ref: string) => setPicked(refs.includes(ref) ? refs.filter((r) => r !== ref) : refs.length < MAX ? [...refs, ref] : refs);

  const start = async () => {
    if (!chosen) return;
    setState({ kind: "running" });
    try {
      const data = await runDemo({ slug: activeSlug, promptVersion: chosen.promptVersion, modelKey: chosen.modelKey, exampleRefs: refs }, key.trim());
      setState({ kind: "done", data });
    } catch (e) {
      const err = e instanceof DemoError ? e : new DemoError(0, "The demo couldn't run.");
      if (err.status === 401) {
        // A rejected key is forgotten everywhere, and the field is ready for another one.
        setKey("");
        writeStoredKey(null);
        setRemember(false);
        keyRef.current?.focus();
      }
      setState(err.status === 429 ? { kind: "limited" } : { kind: "error", message: err.message });
    }
  };

  if (runs.isLoading) return <p className="text-sm text-muted-foreground">Loading published runs…</p>;
  if (!runs.data?.length) return <p className="text-sm text-muted-foreground" data-testid="demo-none">Nothing is published yet, so there is nothing to try.</p>;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Published run</span>
          <select value={activeSlug} onChange={(e) => { setSlug(e.target.value); setVariant(""); setPicked(null); }} className="w-full rounded-md border border-border bg-background px-2 py-1.5" data-testid="demo-run">
            {runs.data.map((r) => <option key={r.slug} value={r.slug}>{r.title}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Prompt × model</span>
          <select value={chosen ? `${chosen.promptVersion}|${chosen.modelKey}` : ""} onChange={(e) => setVariant(e.target.value)} className="w-full rounded-md border border-border bg-background px-2 py-1.5" data-testid="demo-variant">
            {variants.map((v) => <option key={`${v.promptVersion}|${v.modelKey}`} value={`${v.promptVersion}|${v.modelKey}`}>{v.promptVersion} · {v.modelLabel}</option>)}
          </select>
        </label>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Examples ({refs.length} of max {MAX}, public dev examples only)</legend>
        <div className="max-h-56 space-y-1 overflow-auto rounded-md border border-border p-2" data-testid="demo-examples">
          {examples.map((e) => (
            <label key={e.ref} className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={refs.includes(e.ref)} onChange={() => toggle(e.ref)} data-testid={`demo-ex-${e.ref}`} />
              <span><span className="font-mono">{e.ref}</span> <span className="text-muted-foreground">{e.preview}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <KeyInput ref={keyRef} provider={chosen?.provider} value={key} onChange={setKey} remember={remember} onRemember={setRemember} />
      <Button className="cursor-pointer" disabled={!key.trim() || refs.length === 0 || state.kind === "running"} onClick={() => void start()} data-testid="demo-start">
        {state.kind === "running" ? "Running…" : `Run ${refs.length} example${refs.length === 1 ? "" : "s"} on my key`}
      </Button>
      {state.kind === "limited" && <p className="text-sm text-amber-700 dark:text-amber-300" data-testid="demo-limited">Too many runs, try again in an hour.</p>}
      {state.kind === "error" && <p className="text-sm text-destructive" data-testid="demo-error">{state.message}</p>}
      {state.kind === "done" && run.data && <DemoResults data={state.data} fields={run.data.task.fields} />}
    </div>
  );
}
