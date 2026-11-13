# 0004: A workspace is a PaperTrail org

**Status:** accepted

## Context

It looks like a one-person tool, but a second labeller must label blind with less power than the owner,
published pages must show one run's data and nothing else, and the tenancy code already exists, tested,
in PaperTrail.

## Decision

Copy PaperTrail's orgs, memberships, roles and the Prisma tenant extension unchanged in name: every
tenant table carries `orgId` and every query is scoped by the extension. Roles: owner, admin, reviewer
(the second labeller), viewer. Published pages look a run up by slug through `runAsSystem()` (the only
cross-tenant read) and then run every other query inside that run's workspace.

## Alternatives

- **No tenancy, single user**: simplest, but the second labeller would see the labels, and a public page
  would rely on careful filtering instead of the database scope.
- **A per-row `ownerId`**: no roles, and every query would need hand-written filters.

## Consequences

Every route takes `/orgs/:orgId/…`; raw SQL must filter on `org_id` itself.

## How we'd know we were wrong

If the tenancy suite (every id route called from another workspace must answer 404, never 403 or data)
found a leak: it found five list routes answering 200 with an empty list during Phase 28, now fixed.
