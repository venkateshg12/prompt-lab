"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Plus } from "lucide-react";
import { PLACEHOLDERS, TECHNIQUES, type Technique } from "@repo/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { JsonView } from "@/components/common/JsonView";
import { useCreatePrompt, useNewPromptVersion, usePromptPreview, usePrompts, useUpdatePrompt } from "@/hooks/prompts/usePrompts";
import { useExamples } from "@/hooks/examples/useExamples";
import { useCurrentOrg } from "@/hooks/org/useCurrentOrg";
import { getErrorMessage } from "@/lib/errorMessage";
import type { PromptItem } from "@/api/prompt";

const MAX_SHOTS = 5; // the API allows 8; five is plenty and keeps prompts readable

/** A frozen version is read-only. "Create @N+1" opens an editable copy; the API never returns 409 from this screen. */
function FrozenBadge({ prompt }: { prompt: PromptItem }) {
  if (!prompt.frozen) return <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" data-testid="draft-badge">draft</span>;
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300" data-testid="frozen-badge">
      <Lock className="h-3 w-3" /> frozen{prompt.frozenAt ? ` ${new Date(prompt.frozenAt).toLocaleDateString()}` : ""} · used by a run
    </span>
  );
}

function PromptEditor({ taskId, prompt, canEdit, onSaved }: { taskId: string; prompt: PromptItem | null; canEdit: boolean; onSaved: (p: PromptItem) => void }) {
  const create = useCreatePrompt(taskId);
  const update = useUpdatePrompt(taskId);
  const fork = useNewPromptVersion(taskId);
  const dev = useExamples(taskId, { split: "dev" }); // the picker queries dev only: a test example can't be chosen at all
  const devExamples = useMemo(() => dev.data?.pages.flatMap((p) => p.data) ?? [], [dev.data]);

  const [key, setKey] = useState(prompt?.key ?? "");
  const [technique, setTechnique] = useState<Technique>(prompt?.technique ?? "zero_shot");
  const [system, setSystem] = useState(prompt?.system ?? "{{instructions}}\n\nFields:\n{{fields}}\n\nReturn only a JSON object with exactly these keys. No prose, no code fences.");
  const [template, setTemplate] = useState(prompt?.template ?? 'Job posting:\n"""\n{{input}}\n"""');
  const [notes, setNotes] = useState(prompt?.notes ?? "");
  const [shots, setShots] = useState<string[]>(prompt?.fewShotExampleIds ?? []);
  const [forking, setForking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string>("");
  const systemRef = useRef<HTMLTextAreaElement>(null);
  const templateRef = useRef<HTMLTextAreaElement>(null);
  const lastFocus = useRef<"system" | "template">("template");

  useEffect(() => { if (!previewId && devExamples[0]) setPreviewId(devExamples[0].id); }, [devExamples, previewId]);
  const preview = usePromptPreview(taskId, prompt?.id, previewId || undefined);

  const readOnly = !canEdit || (Boolean(prompt?.frozen) && !forking);
  const insert = (name: string) => {
    const isSystem = lastFocus.current === "system";
    const el = isSystem ? systemRef.current : templateRef.current;
    const text = isSystem ? system : template;
    const set = isSystem ? setSystem : setTemplate;
    const at = el?.selectionStart ?? text.length;
    set(`${text.slice(0, at)}{{${name}}}${text.slice(el?.selectionEnd ?? at)}`);
  };
  const body = { technique, system, template, notes: notes || null, fewShotExampleIds: technique === "few_shot" ? shots : [] };
  const fail = (e: unknown) => setError(getErrorMessage(e, "Could not save"));

  const save = () => {
    setError(null);
    if (!prompt) return create.mutate({ key, ...body }, { onSuccess: (r) => onSaved(r.data), onError: fail });
    if (prompt.frozen) return fork.mutate({ id: prompt.id, body }, { onSuccess: (r) => { setForking(false); onSaved(r.data); }, onError: fail });
    update.mutate({ id: prompt.id, body }, { onSuccess: (r) => onSaved(r.data), onError: fail });
  };

  return (
    <div className="space-y-4" data-testid="prompt-editor">
      <div className="flex flex-wrap items-center gap-3">
        {prompt ? <h3 className="font-mono text-sm font-semibold text-foreground">{prompt.versionId}</h3> : <Input aria-label="Prompt key" placeholder="key, e.g. v2-few-shot" value={key} onChange={(e) => setKey(e.target.value)} className="h-9 w-64" data-testid="prompt-key" />}
        {prompt && <FrozenBadge prompt={prompt} />}
        <select aria-label="Technique" disabled={readOnly} value={technique} onChange={(e) => setTechnique(e.target.value as Technique)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" data-testid="technique">
          {TECHNIQUES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Placeholders">
        {PLACEHOLDERS.map((p) => (
          <button key={p} type="button" disabled={readOnly} onClick={() => insert(p)} data-testid={`chip-${p}`} className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40 cursor-pointer">{`{{${p}}}`}</button>
        ))}
      </div>
      <label className="block text-xs text-muted-foreground">System
        <Textarea ref={systemRef} aria-label="System" readOnly={readOnly} rows={6} value={system} onFocus={() => (lastFocus.current = "system")} onChange={(e) => setSystem(e.target.value)} className="mt-1 font-mono text-xs text-foreground" />
      </label>
      <label className="block text-xs text-muted-foreground">User template (must contain {"{{input}}"})
        <Textarea ref={templateRef} aria-label="Template" readOnly={readOnly} rows={5} value={template} onFocus={() => (lastFocus.current = "template")} onChange={(e) => setTemplate(e.target.value)} className="mt-1 font-mono text-xs text-foreground" />
      </label>
      <label className="block text-xs text-muted-foreground">Notes
        <Input aria-label="Notes" readOnly={readOnly} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
      </label>
      {technique === "few_shot" && (
        <fieldset className="space-y-1 rounded-lg border border-border p-3" data-testid="few-shot-picker">
          <legend className="px-1 text-xs text-muted-foreground">Few-shot examples (dev only, max {MAX_SHOTS})</legend>
          {devExamples.length === 0 && <p className="text-xs text-muted-foreground">No dev examples yet.</p>}
          {devExamples.map((ex) => (
            <label key={ex.id} className="flex items-center gap-2 text-xs">
              <input type="checkbox" disabled={readOnly || (!shots.includes(ex.id) && shots.length >= MAX_SHOTS)} checked={shots.includes(ex.id)} data-testid={`shot-${ex.ref}`}
                onChange={(e) => setShots(e.target.checked ? [...shots, ex.id] : shots.filter((s) => s !== ex.id))} />
              <span className="font-mono">{ex.ref}</span><span className="line-clamp-1 text-muted-foreground">{ex.input.slice(0, 60)}</span>
            </label>
          ))}
          <p className="text-[11px] text-muted-foreground">With <code>{"{{examples}}"}</code> in the text the examples are inline; without it each one becomes a user/assistant turn.</p>
        </fieldset>
      )}
      {error && <p className="text-xs text-destructive" data-testid="prompt-error">{error}</p>}
      {canEdit && (
        <div className="flex gap-2">
          {prompt?.frozen && !forking ? (
            <Button className="cursor-pointer" data-testid="create-next" onClick={() => setForking(true)}>Create @{prompt.version + 1}</Button>
          ) : (
            <Button className="cursor-pointer" disabled={create.isPending || update.isPending || fork.isPending || (!prompt && !key)} data-testid="save-prompt" onClick={save}>
              {!prompt ? "Create prompt" : prompt.frozen ? `Create @${prompt.version + 1}` : "Save draft"}
            </Button>
          )}
        </div>
      )}
      {prompt && (
        <section className="space-y-2 border-t border-border pt-4" data-testid="prompt-preview">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-foreground">Preview: exactly what the model receives</h4>
            <select aria-label="Preview example" value={previewId} onChange={(e) => setPreviewId(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-xs" data-testid="preview-example">
              {devExamples.map((ex) => <option key={ex.id} value={ex.id}>{ex.ref}</option>)}
            </select>
          </div>
          {!previewId ? <p className="text-xs text-muted-foreground">Add a dev example to preview.</p> : preview.isLoading ? <p className="text-xs text-muted-foreground">Rendering…</p> : preview.data ? (
            <div className="space-y-2 text-xs">
              <Turn role="system" text={preview.data.data.system} />
              {preview.data.data.messages.map((m, i) => <Turn key={i} role={m.role} text={m.content} />)}
              <p className="text-muted-foreground" data-testid="preview-meta">
                {preview.data.data.fewShotStyle} few-shot · max {preview.data.data.maxTokens} output tokens · ≈ {Math.ceil((preview.data.data.system.length + preview.data.data.messages.reduce((n, m) => n + m.content.length, 0)) / 4)} input tokens (estimate: characters ÷ 4)
              </p>
              {preview.data.data.structured && <JsonView value={preview.data.data.structured.schema} maxHeight="12rem" testId="preview-schema" />}
            </div>
          ) : <p className="text-xs text-destructive">Couldn&apos;t render the preview.</p>}
        </section>
      )}
    </div>
  );
}

const Turn = ({ role, text }: { role: string; text: string }) => (
  <div className="rounded-lg border border-border">
    <div className="border-b border-border bg-muted/50 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">{role}</div>
    <pre className="whitespace-pre-wrap p-2 font-mono text-xs text-foreground" data-testid={`turn-${role}`}>{text}</pre>
  </div>
);

export function PromptsTab({ taskId }: { taskId: string }) {
  const { data, isLoading } = usePrompts(taskId);
  const { role } = useCurrentOrg();
  const canEdit = role === "owner" || role === "admin";
  const prompts = data?.data ?? [];
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const current = selected === "new" ? null : prompts.find((p) => p.id === selected) ?? null;

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <aside className="space-y-2" data-testid="prompt-list">
        {canEdit && <Button size="sm" variant="outline" className="w-full cursor-pointer" data-testid="new-prompt" onClick={() => setSelected("new")}><Plus className="h-4 w-4" /> New prompt</Button>}
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && prompts.length === 0 && <p className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground" data-testid="prompts-empty">No prompts yet.</p>}
        {prompts.map((p) => (
          <button key={p.id} type="button" onClick={() => setSelected(p.id)} data-testid={`prompt-${p.versionId}`} className={`w-full rounded-lg border p-3 text-left cursor-pointer ${selected === p.id ? "border-primary" : "border-border hover:border-primary/40"}`}>
            <div className="flex items-center justify-between gap-2"><span className="font-mono text-sm text-foreground">{p.versionId}</span><span className="text-[11px] text-muted-foreground">{p.technique}</span></div>
            <div className="mt-1 flex items-center gap-2"><FrozenBadge prompt={p} />{(p.history?.length ?? 1) > 1 && <span className="text-[11px] text-muted-foreground">{p.history!.length} versions</span>}</div>
          </button>
        ))}
      </aside>
      <section>
        {selected === null ? <p className="text-sm text-muted-foreground">Select a prompt, or create one.</p> : <PromptEditor key={selected === "new" ? "new" : current?.id} taskId={taskId} prompt={current} canEdit={canEdit} onSaved={(p) => setSelected(p.id)} />}
      </section>
    </div>
  );
}
