"use client";

/* `?tag=` recomputes every number on that subset (server-side), each with its own n. */
export function TagFilter({ tags, value, onChange }: { tags: string[]; value?: string; onChange: (tag: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted-foreground">
      Subset
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground" data-testid="tag-filter">
        <option value="">all examples</option>
        {tags.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
    </label>
  );
}
