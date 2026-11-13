"use client";

/* Every repeat is visible, so a field that changes between repeats (consistency) can be seen, not just counted. */
export function RepeatTabs({ count, value, onChange }: { count: number; value: number; onChange: (i: number) => void }) {
  if (count <= 1) return null;
  return (
    <div className="flex gap-1" role="tablist" data-testid="repeat-tabs">
      {Array.from({ length: count }, (_, i) => (
        <button key={i} role="tab" aria-selected={i === value} type="button" onClick={() => onChange(i)} data-testid={`repeat-tab-${i}`}
          className={`cursor-pointer rounded-md px-2.5 py-1 text-xs ${i === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
          repeat {i + 1}
        </button>
      ))}
    </div>
  );
}
