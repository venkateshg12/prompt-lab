# 0001: PostgreSQL 17 + Prisma, not SQLite or MongoDB

**Status:** accepted (3 Nov 2026)

## Context

The spec suggested SQLite for a single-user tool; an earlier plan used MongoDB. The runner's correctness
rests on the database: one result per cell even when a job runs twice, a run that can't reference a
deleted example, tenant scoping on every query, and keyset pagination ordered by score.

## Decision

PostgreSQL 17 with Prisma 7.10.1, for development, tests and production alike. The `results` unique index
on `(run_id, variant_id, example_id, repeat_index)` is the second lock behind BullMQ's job ids; foreign
keys stop orphaned rows; integration tests run the committed migrations with `prisma migrate deploy` on a
Testcontainers Postgres 17.

## Alternatives

- **SQLite**: no second process to run, but a different engine in tests and production, weak concurrent
  writes from several workers, and Neon/Render hosting would mean switching engines at deploy time.
- **MongoDB** (the archived plan): flexible documents, but the cell-uniqueness and relational guarantees
  would live in application code instead of the schema.

## Consequences

- Every schema change is a migration; Prisma can't express some index details (`NULLS FIRST`), so those
  are hand-written migrations checked with `prisma migrate diff` (Phase 21).
- Raw SQL bypasses the tenant extension, so it must filter on `org_id` itself (enforced by review and
  the tenancy integration suite).

## How we'd know we were wrong

If the database became the bottleneck of a benchmark (cells waiting on writes rather than on model
calls), or if migrations blocked iteration more than they protected it.
