import { MODELS } from "../config/models.config";

// Per attempt. LLM calls take 5–60 s; 45 s cuts off the pathological tail.
export const LLM_TIMEOUT_MS = 45_000;
// Attempts per call, including the first (transient failures only).
export const LLM_ATTEMPTS = 3;
// Cap for one backoff wait.
export const MAX_BACKOFF_MS = 8_000;

// Per-model concurrency and RPM budgets, built from the registry seed.
export const MODEL_LIMITS: Record<string, { concurrency: number; rpm: number }> = Object.fromEntries(
    MODELS.map((m) => [m.key, m.limits])
);

export const DEFAULT_MODEL_LIMIT = { concurrency: 4, rpm: 40 };
export const LEASE_TTL_MS = 90_000;
export const LEASE_WAIT_MS = 10_000;
export const BREAKER = { failureThreshold: 5, resetTimeoutMs: 30_000 };
