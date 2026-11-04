/*
  Replaces anything shaped like a credential before text is logged or returned. Provider error bodies
  can echo the request, and a visitor's key must never surface anywhere.
 */
const SECRET_PATTERNS = [/nvapi-[A-Za-z0-9_-]{20,}/g, /sk-[A-Za-z0-9_-]{20,}/g, /Bearer\s+\S+/gi];

export const scrubSecrets = (text: string): string =>
    SECRET_PATTERNS.reduce((out, pattern) => out.replace(pattern, "[redacted]"), text);
