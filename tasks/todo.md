# Prompt Lab — todo

The phase checklist lives in [../docs/phases/README.md](../docs/phases/README.md). Use this file for the
**current phase**: copy its Definition of done here, tick as you go, then add a review.

## Current phase

- All phases' code built (13 Nov 2026). Remaining work is the owner's: see tracker.md "Next steps" and memory.md "Needs the owner".

## Review

13 Nov 2026, one session: Phase 20 committed; 21–23 built + verified end to end (results/error browser/compare/re-score; exports + Playbook contract + published pages; BYOK demo with log + Redis leak checks); 24–27 code (dataset tools, Playbook variant prompts, reasoning-mini, notebook checker, validated judge + charts, contract/drift tests, hand-off); 28 property + Testcontainers integration + golden path (found 2 real bugs: private-input leak on public pages, 200-empty list routes); 29 Docker images, compose app profile, CI + bench workflows, DEPLOY.md; 30 README generator + check, ADRs, limits, data handling, interview notes. Deviations recorded in memory.md, patterns in lessons.md.

## Planning log

- 2026-11-03: plan rebuilt on PostgreSQL 17 + Prisma 7.10.1 at PaperTrail depth (31 phases, 00–30). The MongoDB plan of 2026-10-24 is archived in `docs/_archive-2026-10-24/`.
- 2026-11-05: Phase 20 resumed; API half already in the working tree, web half to build.
- 2026-11-13: owner asked to complete every remaining phase's code + E2E. Order: 21 → 22 → 23 → 24–27 (code) → 28 → 29 → 30.
