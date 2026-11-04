import { ProviderHttpError } from "../../errors";

export type Scripted = { kind: "text"; text: string } | { kind: "error"; error: Error };

/*
  Named scripts for processes a test can't reach in-process (FAKE_LLM_SCRIPT=<name>). Each item answers
  exactly one call, in order; after the script is exhausted the fake provider falls back to its default.
  Later phases add more (e.g. `judge-mixed` in Phase 26).
 */
export const FAKE_SCRIPTS: Record<string, () => Scripted[]> = {
    "rate-limited": () => [
        { kind: "error", error: new ProviderHttpError("fake:text", 429, "slow down") },
        { kind: "error", error: new ProviderHttpError("fake:text", 429, "slow down") },
        { kind: "text", text: '{"ok":true}' },
    ],
    "always-503": () => Array.from({ length: 1000 }, () => ({ kind: "error" as const, error: new ProviderHttpError("fake:text", 503, "down") })),
};
