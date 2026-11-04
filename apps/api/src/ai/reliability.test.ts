import { describe, it, expect } from "vitest";
import { isRetryable, withRetry } from "./reliability";
import { ProviderTimeout } from "./errors";

describe("ai/reliability", () => {
  it("correctly identifies retryable errors", () => {
    expect(isRetryable(new ProviderTimeout("nvidia", 1000))).toBe(true);
    expect(isRetryable({ status: 429 })).toBe(true);
    expect(isRetryable({ status: 503 })).toBe(true);
    expect(isRetryable({ status: 500 })).toBe(true);
    expect(isRetryable({ code: "ECONNRESET" })).toBe(true);

    // Non-retryable
    expect(isRetryable({ status: 400 })).toBe(false);
    expect(isRetryable({ status: 401 })).toBe(false);
    expect(isRetryable({ status: 403 })).toBe(false);
    expect(isRetryable({ status: 404 })).toBe(false);
    expect(isRetryable({ status: 422 })).toBe(false);
  });

  it("retries 429 then succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) {
          throw Object.assign(new Error("Rate limited"), { status: 429 });
        }
        return "success";
      },
      {
        attempts: 3,
        timeoutMs: 1000,
        model: "test-model",
      }
    );

    expect(result).toBe("success");
    expect(calls).toBe(3);
  });

  it("never retries 400 bad request and fails immediately on first attempt", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw Object.assign(new Error("Bad request"), { status: 400 });
        },
        {
          attempts: 3,
          timeoutMs: 1000,
          model: "test-model",
        }
      )
    ).rejects.toThrow("Bad request");

    expect(calls).toBe(1);
  });

  it("converts aborted timeout into ProviderTimeout error", async () => {
    await expect(
      withRetry(
        async (signal) => {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              reject(new Error("Aborted by timeout"));
            });
          });
        },
        {
          attempts: 1,
          timeoutMs: 20,
          model: "timeout-model",
        }
      )
    ).rejects.toThrow(ProviderTimeout);
  });
});
