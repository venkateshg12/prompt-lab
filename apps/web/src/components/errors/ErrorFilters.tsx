"use client";

import type { Facets, SummaryVariant } from "@/api/results";

type Filters = { variant?: string; field?: string; reason?: string; tag?: string; failedOnly: boolean };

/* All filter state lives in the URL; this only renders it and calls `set`. Chips carry the facet counts. */
export function ErrorFilters({ f, set, variants, fields, facets }: { f: Filters; set: (k: string, v: string) => void; variants: SummaryVariant[]; fields: string[]; facets?: Facets }) {
  const chip = (on: boolean) => `cursor-pointer rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Variant" value={f.variant ?? ""} onChange={(e) => set("variant", e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" data-testid="filter-variant">
          <option value="">all variants</option>
          {variants.map((v) => <option key={v.variantId} value={v.variantId}>{v.promptVersion} · {v.modelLabel}</option>)}
        </select>
        <select aria-label="Field" value={f.field ?? ""} onChange={(e) => set("field", e.target.value)} className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" data-testid="filter-field">
          <option value="">any field</option>
          {fields.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input type="checkbox" checked={f.failedOnly} onChange={(e) => set("failedOnly", e.target.checked ? "true" : "")} data-testid="filter-failed-only" /> failed only
        </label>
        <input aria-label="Search tag" placeholder="tag" defaultValue={f.tag ?? ""} className="h-8 w-32 rounded-md border border-border bg-background px-2 text-sm" data-testid="filter-tag-input"
          onKeyDown={(e) => { if (e.key === "Enter") set("tag", (e.target as HTMLInputElement).value.trim()); }} />
      </div>
      {facets && facets.reasons.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="reason-chips">
          <span className="text-xs text-muted-foreground">Reasons:</span>
          {facets.reasons.map((r) => (
            <button key={r.reason} type="button" className={chip(f.reason === r.reason)} onClick={() => set("reason", f.reason === r.reason ? "" : r.reason)} data-testid={`reason-chip-${r.reason}`} data-count={r.n}>
              {r.reason} {r.n}
            </button>
          ))}
        </div>
      )}
      {facets && facets.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="tag-chips">
          <span className="text-xs text-muted-foreground">Tags:</span>
          {facets.tags.map((t) => (
            <button key={t.tag} type="button" className={chip(f.tag === t.tag)} onClick={() => set("tag", f.tag === t.tag ? "" : t.tag)} data-testid={`tag-chip-${t.tag}`}>
              {t.tag} {t.n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
