# 0006: The Playbook reads exports through a tested contract

**Status:** accepted

## Context

The Prompt Engineering Playbook publishes lessons whose numbers come from Prompt Lab runs. It is a
static site and its importer is already built.

## Decision

Prompt Lab exports `results.jsonl` (one line per cell) and case lines in exactly the shape of the
Playbook's `promptLabResultLineSchema` / `promptLabCaseLineSchema`. The Playbook (the reader) owns the
contract; Prompt Lab keeps a byte-identical copy and tests every export against it, a drift test compares
the copy with the Playbook's source, and the Playbook's real importer is run in `--dry-run` on real
exports. `cases/HANDOFF.md` is generated from the database with the exact importer flags.

## Alternatives

- **The Playbook reads Prompt Lab's database**: couples deploys and credentials, and the site could no
  longer build statically.
- **A shared npm package for the schemas**: couples two repos' release cycles for two schemas.

## Consequences

Prompt Lab may add fields (the Playbook's Zod objects strip unknown keys) but never remove, rename or
retype one the schema names.

## How we'd know we were wrong

If the copy and the source drifted without the drift test noticing, or if a lesson's numbers couldn't be
reproduced from its export file.
