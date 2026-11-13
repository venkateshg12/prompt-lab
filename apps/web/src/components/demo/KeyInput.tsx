"use client";

import { forwardRef } from "react";
import { Input } from "@/components/ui/input";

const PLACEHOLDER: Record<string, string> = { nvidia: "nvapi-…", openai: "sk-…", anthropic: "sk-ant-…", gemini: "AIza…" };

/* A password field for the visitor's own key, the provider it is for, and the promise about it. */
export const KeyInput = forwardRef<HTMLInputElement, { provider?: string; value: string; onChange: (v: string) => void; remember: boolean; onRemember: (v: boolean) => void }>(
  function KeyInput({ provider, value, onChange, remember, onRemember }, ref) {
    return (
      <div className="space-y-2">
        <label className="block text-sm font-medium text-foreground" htmlFor="provider-key">Your {provider ?? "provider"} API key</label>
        <Input id="provider-key" ref={ref} type="password" autoComplete="off" spellCheck={false} placeholder={PLACEHOLDER[provider ?? ""] ?? "your key"}
          value={value} onChange={(e) => onChange(e.target.value)} data-testid="key-input" />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={remember} onChange={(e) => onRemember(e.target.checked)} data-testid="remember-key" /> remember for this tab
        </label>
        <p className="text-xs text-muted-foreground">
          Your key is sent with this request only, used for at most 10 calls, and never stored or logged.{" "}
          <a className="underline" href="https://github.com/search?q=demo.service.ts+prompt-lab&type=code" target="_blank" rel="noreferrer">Read the code</a>.
        </p>
      </div>
    );
  }
);
