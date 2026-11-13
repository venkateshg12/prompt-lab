# 0002: One BullMQ job per cell, with a deterministic id

**Status:** accepted

## Context

A run is prompt versions × models × examples × repeats: thousands of model calls. Calls fail, workers
restart, providers rate-limit. Progress must survive a crash without counting a cell twice.

## Decision

Each cell is its own job, id `cell-<runId>-<sha1(variant|example|repeat)>` (dashes only: BullMQ rejects
`:`). Adding the same cell twice is a no-op while the job exists; `persistCell` inserts the result and
moves the run's counters in one transaction, and a duplicate hits the unique index (P2002) and counts
nothing. A sweeper re-adds cells missing after a crash.

## Alternatives

- **A loop in one job**: simpler, but one failed call or a restart loses or repeats the whole run, and it
  can't spread across workers.
- **One job per variant**: fewer jobs, but retries and progress are coarse.

## Consequences

More jobs in Redis (bounded by the 5,000-cell cap per run); per-model concurrency comes from leases and
an RPM budget instead of the worker's own concurrency.

## How we'd know we were wrong

If Redis memory or queue overhead dominated run time, or if the integration test that enqueues every
cell twice and processes one cell twice outside BullMQ ever counted a cell twice.
