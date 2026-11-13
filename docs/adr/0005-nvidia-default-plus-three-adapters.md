# 0005: NVIDIA NIM by default; OpenAI, Anthropic and Gemini when keyed

**Status:** accepted

## Context

The study compares three model families. Open models on NVIDIA's hosted NIM are free to call on its
developer tier and expose an OpenAI-compatible API; closed models need paid keys.

## Decision

`complete()` returns raw text and talks to providers through small `fetch` adapters: one
OpenAI-compatible adapter for NVIDIA and OpenAI, plus Anthropic and Gemini. A provider's models are
enabled only when its key is set. Models are chosen from NVIDIA's live model list plus a structured-output
probe, never from memory: NVIDIA retired its Llama 3.x endpoints (410) on 26 Aug 2026.

## Alternatives

- **An SDK per provider or a router library**: more surface, and each would shape requests its own way;
  the adapters' wire format is tested against a local stub instead.
- **Closed models only**: higher cost, and fewer families for the same budget.

## Consequences

The cost column for NVIDIA models uses a **reference host's** price for the same open model, labelled as
such, because the free tier costs nothing; every price carries the date it was checked. Each adapter
must be re-checked against its provider's docs when it changes.

## How we'd know we were wrong

If the free tier's rate limits made full runs impractical, or if reference prices diverged so far from
real hosting costs that the cost column misled.
