# 0007: No fallback model in a benchmark

**Status:** accepted

## Context

PaperTrail falls back to a second model when the first fails, because a user wants an answer. In a
benchmark, each cell belongs to exactly one model.

## Decision

A failed call (after transport retries, or immediately for a client error) is an **error cell**: stored,
counted in the errors column, listed in the error browser, and excluded from accuracy. Never another
model's answer. A model whose circuit breaker is open is skipped as an error for that period, and a
visitor's rate-limited key (the demo) never counts against the breaker the owner's runs use.

## Alternatives

- **Fallback**: more cells "succeed", but a row labelled model A would contain model B's answers.
- **Retry until success**: unbounded cost and time, and it hides a model's real failure rate.

## Consequences

A flaky provider shows up as errors, not as lower accuracy; a row with many errors carries a visible
error count so it isn't mistaken for a clean result.

## How we'd know we were wrong

If error rates were so high that most rows were unusable; the answer then is better retry pacing or a
different provider, still never mixing models in one row.
