"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/** Pretty-printed JSON with a copy button. Never edits or reorders what it shows. */
export function JsonView({ value, maxHeight = "20rem", testId }: { value: unknown; maxHeight?: string; testId?: string }) {
  const [copied, setCopied] = useState(false);
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <div className="relative rounded-lg border border-border bg-muted/40">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
        className="absolute right-2 top-2 rounded-md border border-border bg-card p-1 text-muted-foreground hover:text-foreground cursor-pointer"
        aria-label="Copy"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre data-testid={testId} className="overflow-auto p-3 pr-10 text-xs leading-relaxed text-foreground" style={{ maxHeight }}>{text}</pre>
    </div>
  );
}
