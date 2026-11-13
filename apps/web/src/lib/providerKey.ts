/*
  The visitor's provider key in the browser (from the Playbook's Try-it island). In memory by default;
  sessionStorage only when "remember for this tab" is ticked; never localStorage, never a cookie.
  sessionStorage can throw (private windows, blocked storage), so every access is guarded.
 */
const STORAGE_KEY = "promptlab:provider-key";
const VISITOR_KEY = "promptlab:demo-visitor";

export const readStoredKey = (): string => {
  try {
    return sessionStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

export const writeStoredKey = (value: string | null) => {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, value);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to do: the key just isn't remembered
  }
};

/** A random per-tab id for the demo's per-visitor limit (X-Lab-Visitor). It identifies nothing, least of all the key. */
export const demoVisitorId = (): string => {
  const fresh = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    const existing = sessionStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const id = fresh();
    sessionStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return fresh();
  }
};
