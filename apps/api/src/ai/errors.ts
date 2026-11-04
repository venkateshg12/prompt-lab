import { scrubSecrets } from "../utils/scrubSecrets";

/** One attempt exceeded its time budget. Retryable. */
export class ProviderTimeout extends Error {
  readonly name = "ProviderTimeout";
  constructor(
    readonly model: string,
    readonly timeoutMs: number
  ) {
    super(`${model} did not answer within ${timeoutMs} ms`);
  }
}

/** Model is at concurrency limit across workers or over RPM budget. Retryable by BullMQ. */
export class ProviderBusy extends Error {
  readonly name = "ProviderBusy";
  constructor(readonly model: string) {
    super(`Model ${model} is currently busy (concurrency or rate limit reached)`);
  }
}

/** Provider skipped because its circuit breaker is OPEN or probe failed. `cause` is the last real error. */
export class ProviderSkipped extends Error {
  readonly name = "ProviderSkipped";
  constructor(
    readonly model: string,
    options?: ErrorOptions
  ) {
    super(`Model ${model} skipped due to open circuit breaker`, options);
  }
}

/** Monthly org budget or daily platform budget exceeded. Unrecoverable for the run. */
export class BudgetExceeded extends Error {
  readonly name = "BudgetExceeded";
  readonly code = "BUDGET_EXCEEDED";
  constructor(message: string) {
    super(message);
  }
}

/** Carries the HTTP status so isRetryable can read it. Body scrubbed of anything key-shaped. */
export class ProviderHttpError extends Error {
  readonly name: string = "ProviderHttpError";
  constructor(
    readonly model: string,
    readonly status: number,
    body: string
  ) {
    super(`${model} answered ${status}: ${scrubSecrets(body).slice(0, 500)}`);
  }
}
export class ProviderAuthError extends ProviderHttpError {
  readonly name = "ProviderAuthError"; // 401 / 403
}
export class ModelRetired extends ProviderHttpError {
  readonly name = "ModelRetired"; // 410
}
export class ProviderNotConfigured extends Error {
  readonly name = "ProviderNotConfigured";
  constructor(readonly model: string) {
    super(`No API key configured for ${model}`);
  }
}
/** Replay mode found no recorded answer for this call. Not retryable. */
export class ReplayMiss extends Error {
  readonly name = "ReplayMiss";
  constructor(readonly key: string) {
    super(`No recorded answer for ${key}`);
  }
}

export const httpError = (model: string, status: number, body: string) =>
  status === 410
    ? new ModelRetired(model, status, body)
    : status === 401 || status === 403
      ? new ProviderAuthError(model, status, body)
      : new ProviderHttpError(model, status, body);

/** Errors that say nothing about the provider's health: never count them against the breaker. */
export const isClientError = (e: unknown) =>
  e instanceof ProviderHttpError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
