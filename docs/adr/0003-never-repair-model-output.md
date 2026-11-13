# 0003: Never repair model output before scoring

**Status:** accepted

## Context

Models wrap JSON in prose ("Sure! Here's the JSON:"), cut it off at the token limit, or add a trailing
comma. A product (PaperTrail) repairs these so a user gets a result. Prompt Lab is an instrument: its
valid-JSON column is the measurement.

## Decision

The scorer removes a Markdown code fence (presentation) and, for chain-of-thought, takes the last
`<json>…</json>` block. Nothing else: no closing braces, no stripping prose, no second call. The raw
output is stored byte for byte and shown next to the parsed one. Retries happen only for transport
errors (408/429/5xx/timeouts), never because the answer was malformed.

## Alternatives

- **Repair, then score**: friendlier numbers, but a model that needs repair would look as good as one
  that doesn't, and valid-JSON % would stop meaning anything.
- **Retry on invalid JSON**: hides the failure rate and costs more.

## Consequences

A model that's slightly sloppy about JSON looks worse here than it would inside a product that repairs.
That's the point, and the error browser shows the raw text so a reader can judge.

## How we'd know we were wrong

If readers consistently needed "accuracy if the JSON had been fixed" to choose a model; then it would be
added as a separate, labelled column, never by changing the scored value. A test (Phase 28) fails if the
extractor ever "closes the brace".
