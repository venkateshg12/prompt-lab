"use client";

import { useState } from "react";
import { fieldRulesSchema, jsonSchemaFor, type FieldRule } from "@repo/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { JsonView } from "@/components/common/JsonView";
import { useUpdateTask } from "@/hooks/tasks/useTasks";
import { getErrorMessage } from "@/lib/errorMessage";
import type { TaskDetail } from "@/api/task";

const details = (r: FieldRule): string => {
  switch (r.kind) {
    case "enum": return r.values.join(" | ");
    case "set_f1": return `${Object.keys(r.synonyms).length} synonyms`;
    case "money": return `±${Math.round(r.tolerance * 100)}% per year`;
    case "integer": return [r.min !== undefined ? `min ${r.min}` : "", r.max !== undefined ? `max ${r.max}` : ""].filter(Boolean).join(", ") || "exact";
    default: return "exact after normalising";
  }
};

export function RulesTable({ fields }: { fields: FieldRule[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm" data-testid="rules-table">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
          <tr><th className="px-3 py-2">Field</th><th className="px-3 py-2">Kind</th><th className="px-3 py-2">Scored by</th><th className="px-3 py-2">Nullable</th></tr>
        </thead>
        <tbody>
          {fields.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className="px-3 py-2 font-mono text-xs">{r.key}</td>
              <td className="px-3 py-2">{r.kind}</td>
              <td className="px-3 py-2 text-muted-foreground">{details(r)}</td>
              <td className="px-3 py-2">{"nullable" in r ? (r.nullable ? "yes" : "no") : r.kind === "money" ? "yes" : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The editor validates live with the shared schema; saving a definition change shows the version bump first. */
export function RuleEditor({ task, canEdit }: { task: TaskDetail; canEdit: boolean }) {
  const update = useUpdateTask(task.id);
  const [editing, setEditing] = useState(false);
  const [instructions, setInstructions] = useState(task.instructions);
  const [rules, setRules] = useState(JSON.stringify(task.fields, null, 2));
  const [review, setReview] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsed = (() => {
    try {
      return fieldRulesSchema.safeParse(JSON.parse(rules));
    } catch (e) {
      return { success: false as const, error: { issues: [{ path: [] as (string | number)[], message: (e as Error).message }] } };
    }
  })();
  const rulesError = parsed.success ? null : parsed.error.issues.map((i) => `${i.path.join(".") || "rules"}: ${i.message}`).join("; ");
  const changed = instructions !== task.instructions || (parsed.success && JSON.stringify(parsed.data) !== JSON.stringify(task.fields));

  if (!editing) {
    return canEdit ? <Button variant="outline" size="sm" className="cursor-pointer" data-testid="edit-rules" onClick={() => setEditing(true)}>Edit instructions and rules</Button> : null;
  }
  return (
    <div className="space-y-3 rounded-lg border border-border p-4" data-testid="rule-editor">
      <Textarea aria-label="Instructions" rows={3} value={instructions} onChange={(e) => { setInstructions(e.target.value); setReview(false); }} />
      <Textarea aria-label="Field rules (JSON)" rows={12} className="font-mono text-xs" value={rules} onChange={(e) => { setRules(e.target.value); setReview(false); }} />
      {rulesError && <p className="text-xs text-destructive" data-testid="rules-error">{rulesError}</p>}
      {review && changed && (
        <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300" data-testid="version-notice">
          Task v{task.version} → v{task.version + 1}: runs scored with v{task.version} will show a stale banner until you re-score them.
        </p>
      )}
      {error && <p className="text-xs text-destructive" data-testid="task-error">{error}</p>}
      {notice && <p className="text-xs text-emerald-600" data-testid="task-notice">{notice}</p>}
      <div className="flex gap-2">
        {changed && !review ? (
          <Button size="sm" disabled={!parsed.success} className="cursor-pointer" data-testid="review-change" onClick={() => setReview(true)}>Review change</Button>
        ) : (
          <Button
            size="sm" disabled={!parsed.success || !changed || update.isPending} className="cursor-pointer" data-testid="save-rules"
            onClick={() => update.mutate({ instructions, fields: parsed.success ? parsed.data : undefined }, {
              onSuccess: (res) => { setError(null); setReview(false); setNotice(`Saved. Task is now v${res.data.version}${res.data.runsAffected ? `; ${res.data.runsAffected} run(s) were scored with an earlier version` : ""}.`); },
              onError: (e) => setError(getErrorMessage(e, "Could not save")),
            })}
          >
            Save{changed ? ` as v${task.version + 1}` : ""}
          </Button>
        )}
        <Button size="sm" variant="ghost" className="cursor-pointer" onClick={() => { setEditing(false); setReview(false); }}>Close</Button>
      </div>
    </div>
  );
}

export function SchemaViewer({ fields }: { fields: FieldRule[] }) {
  const schema = jsonSchemaFor(fields);
  return <JsonView value={schema} testId="json-schema" />;
}
