"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResultCard } from "./ResultCard";
import { useKeyboardNav } from "@/hooks/useKeyboardNav";
import type { ResultItem } from "@/api/results";

type Props = { items: ResultItem[]; field?: string; hasMore: boolean; loadingMore: boolean; loadMore: () => void; onCompare?: (r: ResultItem) => void };

export function ErrorList({ items, field, hasMore, loadingMore, loadMore, onCompare }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [help, setHelp] = useState(false);
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const toggle = useCallback((id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const handlers = useMemo(() => ({
    open: (i: number) => { const r = items[i]; if (r) toggle(r.id); },
    compare: (i: number) => { const r = items[i]; if (r && onCompare) onCompare(r); },
    help: () => setHelp((h) => !h),
  }), [items, toggle, onCompare]);
  const [index, setIndex] = useKeyboardNav(items.length, handlers);
  useEffect(() => { refs.current[index]?.scrollIntoView?.({ block: "nearest" }); }, [index]);

  if (items.length === 0) return <p className="text-sm text-muted-foreground" data-testid="no-results">Nothing matches these filters.</p>;
  return (
    <div className="space-y-3" data-testid="error-list" data-active-index={index}>
      <p className="text-[11px] text-muted-foreground">Keys: j / k move · o raw output{onCompare ? " · c compare" : ""} · ? help</p>
      {help && (
        <div role="dialog" aria-label="Keyboard shortcuts" className="rounded-md border border-border bg-card p-3 text-xs" data-testid="shortcuts">
          <b>j</b> next · <b>k</b> previous · <b>o</b> expand raw output · <b>c</b> compare with another variant · <b>?</b> close
        </div>
      )}
      {items.map((r, i) => (
        <div key={r.id} onClick={() => setIndex(i)}>
          <ResultCard ref={(el) => { refs.current[i] = el; }} r={r} field={field} active={i === index} expanded={expanded.has(r.id)} onToggle={() => toggle(r.id)} onCompare={onCompare ? () => onCompare(r) : undefined} />
        </div>
      ))}
      {hasMore && <Button variant="outline" size="sm" className="cursor-pointer" onClick={loadMore} disabled={loadingMore} data-testid="load-more">{loadingMore ? "Loading…" : "Load more"}</Button>}
    </div>
  );
}
