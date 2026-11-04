"use client";

import { useEffect, useState } from "react";
import { answerSchemaFor, type FieldRule } from "@repo/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useSecondLabel, useUpdateExample } from "@/hooks/examples/useExamples";
import { getErrorMessage } from "@/lib/errorMessage";
import type { ExampleItem } from "@/api/example";

// An empty answer with every key present, so a labeller starts from the right shape.
const blankAnswer = (fields: FieldRule[]) => Object.fromEntries(fields.map((f) => [f.key, f.kind === "set_f1" ? [] : null]));

function validate(fields: FieldRule[], text: string): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const r = answerSchemaFor(fields).safeParse(JSON.parse(text));
    return r.success ? { ok: true, value: r.data as Record<string, unknown> } : { ok: false, message: r.error.issues.map((i) => `${i.path.join(".") || "answer"}: ${i.message}`).join("; ") };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export function ExampleSheet({ taskId, fields, example, canEdit, canSecondLabel, hasTestRun, onClose }: {
  taskId: string; fields: FieldRule[]; example: ExampleItem | null; canEdit: boolean; canSecondLabel: boolean; hasTestRun: boolean; onClose: () => void;
}) {
  const update = useUpdateExample(taskId);
  const second = useSecondLabel(taskId);
  const [input, setInput] = useState("");
  const [expected, setExpected] = useState("");
  const [tags, setTags] = useState("");
  const [split, setSplit] = useState<"dev" | "test">("dev");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!example) return;
    setInput(example.input);
    setExpected(JSON.stringify(example.expected ?? {}, null, 2));
    setTags(example.tags.join(", "));
    setSplit(example.split);
    setLabel(JSON.stringify(example.secondLabel ?? blankAnswer(fields), null, 2));
    setError(null);
  }, [example, fields]);

  if (!example) return null;
  const expectedCheck = example.expectedHidden ? null : validate(fields, expected);
  const labelCheck = validate(fields, label);

  const save = () => {
    const check = validate(fields, expected);
    if (!check.ok) return setError(check.message);
    if (example.split === "test" && split === "dev" && hasTestRun && !window.confirm("This example was in the test set. Moving it to dev after a test run is recorded, and published results will carry the “test reused” note. Continue?")) return;
    update.mutate(
      { id: example.id, body: { input, expected: check.value, split, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) } },
      { onSuccess: onClose, onError: (e) => setError(getErrorMessage(e, "Could not save")) }
    );
  };

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl" data-testid="example-sheet">
        <SheetHeader>
          <SheetTitle className="font-mono">{example.ref}</SheetTitle>
          <SheetDescription>Revision {example.revision}. Editing the label or input bumps the revision; runs scored against an older revision are flagged stale.</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-muted-foreground">Split
              <select aria-label="Split" disabled={!canEdit} value={split} onChange={(e) => setSplit(e.target.value as "dev" | "test")} className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground">
                <option value="dev">dev</option><option value="test">test</option>
              </select>
            </label>
            <label className="text-xs text-muted-foreground">Tags
              <Input aria-label="Tags" disabled={!canEdit} value={tags} onChange={(e) => setTags(e.target.value)} className="mt-1" />
            </label>
          </div>
          <label className="block text-xs text-muted-foreground">Input
            <Textarea aria-label="Input" readOnly={!canEdit} rows={7} value={input} onChange={(e) => setInput(e.target.value)} className="mt-1 text-sm text-foreground" />
          </label>
          {example.expectedHidden ? (
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground" data-testid="label-hidden">The first label is hidden until you save your own, so you aren&apos;t anchored by it.</p>
          ) : (
            <label className="block text-xs text-muted-foreground">Expected answer (validated by the task&apos;s own schema)
              <Textarea aria-label="Expected" readOnly={!canEdit} rows={12} value={expected} onChange={(e) => setExpected(e.target.value)} className="mt-1 font-mono text-xs text-foreground" />
              {expectedCheck && !expectedCheck.ok && <span className="mt-1 block text-destructive" data-testid="expected-error">{expectedCheck.message}</span>}
            </label>
          )}
          {error && <p className="text-xs text-destructive" data-testid="sheet-error">{error}</p>}
          {canEdit && (
            <Button disabled={update.isPending || Boolean(expectedCheck && !expectedCheck.ok)} onClick={save} className="cursor-pointer" data-testid="save-example">Save</Button>
          )}
          {canSecondLabel && !canEdit && (
            <div className="space-y-2 border-t border-border pt-4" data-testid="second-label">
              <h3 className="text-sm font-medium text-foreground">Your label</h3>
              <Textarea aria-label="Second label" rows={12} value={label} onChange={(e) => setLabel(e.target.value)} className="font-mono text-xs text-foreground" />
              {!labelCheck.ok && <p className="text-xs text-destructive" data-testid="label-error">{labelCheck.message}</p>}
              <Button disabled={!labelCheck.ok || second.isPending} className="cursor-pointer" data-testid="save-second-label"
                onClick={() => labelCheck.ok && second.mutate({ id: example.id, label: labelCheck.value }, { onSuccess: onClose, onError: (e) => setError(getErrorMessage(e, "Could not save your label")) })}>
                Save my label
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
