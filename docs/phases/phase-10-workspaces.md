# Phase 10 — Workspaces, roles, invites (PaperTrail orgs)

## 1. Goal

Make **a workspace = a PaperTrail org**, enforced at every layer, and let the owner bring in a
**second labeller** (the spec's "ask a friend to double-check 20 labels"):
- `Org`, `Membership`, `Invite`, `AuditLog` tables (migration `workspaces`);
- every new account gets **its own workspace** as owner (PaperTrail's `createPersonalOrg`, restored);
- `GET /orgs`, `GET/PATCH/DELETE /orgs/:orgId`; members: list, change role, remove (last-owner guard),
  leave;
- `resolveOrg` (the caller's **live** membership, cached 60 s, **404** for non-members) and
  `requireOrgRole(permission)` (**403**);
- invitations: single-use, email-bound, 7-day, hash-only, token only in a URL **fragment** or a POST
  body;
- the Prisma **tenant extension** active for this project's tables;
- the web app: the **Workspace** switcher, `/settings/members` (members + invitations), the accept page.

## 2. What I will understand after this phase

1. The three gates on every workspace route: authentication (401), tenancy (404), permission (403), and
   why another workspace's id answers 404, not 403.
2. How the tenant extension makes a forgotten `orgId` filter impossible to ship, and where it can't help
   (raw SQL).
3. Why the role is read **live** from `memberships` (cached 60 s, invalidated on change), not from the
   access token.
4. Why a labeller (`reviewer`) can add a **second** label but never overwrite the first.
5. How "single use" holds under two concurrent accepts (a conditional delete, not read-then-write).
6. Why the invite token never appears in a path.
7. Why the code says `Org` while the UI says "workspace".

## 3. Prerequisites

- Phases 00–09 done: auth, cache, queue and email, the web foundation.
- Phase 04 left PaperTrail's `createPersonalOrg(created, tx)` call in `auth.service.ts` (and
  `ensurePersonalOrg` in `googleAuth.controller.ts`) as `// Phase 10:` comments. This phase restores
  both calls. If Phase 04 deleted them instead, add them back exactly as in `@pt-api`.

## 4. Files

```
packages/types/src/org.ts                         ADAPT  @pt-root/packages/types/src/org.ts
                                                         (no plan/settings/custom fields; Prompt Lab permission list; invite token schema)
apps/api/
├── prisma/schema.prisma                          ADAPT  @pt-api/prisma/schema.prisma
│                                                        (OrgRole, InviteRole, ActorType; Org ADAPT; Membership, Invite, AuditLog COPY)
├── prisma/migrations/<ts>_workspaces/            NEW    (generated)
└── src/
    ├── db/prisma.ts                              ADAPT  (TENANT_MODELS per data-model.md; confirm Invite + AuditLog)
    ├── constants/permissions.ts                  ADAPT  @pt-api/src/constants/permissions.ts   (table in §5)
    ├── types/org.types.ts                        ADAPT  @pt-api/src/types/org.types.ts         (no orgSettings)
    ├── middleware/resolveOrg.ts                  ADAPT  @pt-api/src/middleware/resolveOrg.ts   (path :orgId first)
    ├── middleware/requireOrgRole.ts              COPY   @pt-api/src/middleware/requireOrgRole.ts
    ├── services/org.service.ts                   ADAPT  @pt-api/src/services/org.service.ts    (DTO; budget as a number)
    ├── services/member.service.ts                COPY   @pt-api/src/services/member.service.ts
    ├── services/audit.service.ts                 COPY   @pt-api/src/services/audit.service.ts
    ├── services/invite.service.ts                ADAPT  @pt-api/src/services/invite.service.ts (role caps; fallback name)
    ├── services/deletion.service.ts              NEW    (hardDeleteOrg: one transaction)
    ├── utils/actor.ts                            ADAPT  @pt-api/src/utils/actor.ts             (no API keys: always the user)
    ├── controllers/{org,member,invite}.controller.ts  ADAPT  @pt-api/src/controllers/      (token from body only)
    ├── routes/{org,member,invite}.route.ts       ADAPT  @pt-api/src/routes/                    (/:orgId paths; no idempotency)
    ├── jobs/{producers,processors}/email.*.ts    ADAPT  (+ sendOrgInvite / ORG_INVITE, as @pt-api)
    ├── jobs/processors/purgeExpired.processor.ts ADAPT  (+ expired invites; resolves Phase 08's comment)
    ├── utils/email/emailTemplates.ts             ADAPT  (+ getOrgInviteEmail with a fragment link)
    ├── services/auth.service.ts                  ADAPT  (restore createPersonalOrg in the register transaction)
    ├── controllers/googleAuth.controller.ts      ADAPT  (restore ensurePersonalOrg)
    ├── types/express.d.ts                        ADAPT  (+ orgId, orgRole)
    ├── scripts/check-tenancy.ts                  NEW    (the Verify smoke check)
    └── app.ts                                    ADAPT  (mount /orgs and /invites; CORS allows X-Org-Id)
apps/api/test/tenancy.routes.ts                   NEW    (the id routes Phase 28's cross-tenant suite walks)
apps/web/src/
├── api/org.ts                                    ADAPT  @pt-web/src/api/org.ts           (/orgs/:orgId paths; invites in POST bodies)
├── store/org.store.ts                            COPY   @pt-web/src/store/org.store.ts
├── hooks/org/useCurrentOrg.ts                    ADAPT  @pt-web/src/hooks/org/useCurrentOrg.ts
├── lib/api.ts                                    ADAPT  (restore X-Org-Id from org.store; resolves Phase 09's comment)
├── components/layout/OrgSwitcher.tsx             ADAPT  @pt-web/src/components/layout/OrgSwitcher.tsx  (label "Workspace")
├── app/(app)/layout.tsx                          ADAPT  (render <OrgSwitcher />)
├── app/(app)/settings/members/page.tsx           ADAPT  @pt-web/src/app/(app)/settings/members/page.tsx
└── app/invites/page.tsx                          ADAPT  @pt-web/src/app/invites/[token]/page.tsx  (reads #token)
```

**Not copied:** `@pt-api/src/middleware/authorize.ts` (its extra job is API-key scopes; no API keys
here), PaperTrail's `/orgs/current` routes (every route names its workspace in the path).

## 5. Concepts

**Names.** The code says `Org`, `orgId`, `OrgRole`, `Membership`, exactly as PaperTrail, so
`member.service.ts`, `audit.service.ts` and `requireOrgRole.ts` stay COPY and the cross-tenant tests port
unchanged. Every user-facing string says **workspace**. Don't rename the code to match the UI.

**Why tenancy in a one-person tool.** Two real reasons. The second labeller needs an account with less
power than yours. And published pages (Phase 22) are looked up by slug under `runAsSystem()`; the
extension makes "a public page can only show its own workspace's results" a database rule, not a hope.

**Permissions** (`constants/permissions.ts`), from architecture.md §3:

| Permission | owner | admin | reviewer | viewer |
| --- | :-: | :-: | :-: | :-: |
| `tasks.read`, `runs.read` (tasks, examples, prompts, runs, results) | ✓ | ✓ | ✓ | ✓ |
| `examples.second_label` (write `secondLabel` only) | ✓ | ✓ | ✓ | |
| `examples.manage` (import, edit `expected`, split, tags, delete), `tasks.manage`, `prompts.manage`, `runs.start`, `runs.publish`, `members.manage`, `org.update` | ✓ | ✓ | | |
| `org.delete`, `budget.manage` | ✓ | | | |

```ts
// constants/permissions.ts — ADAPT: PaperTrail's shape and can(), Prompt Lab's vocabulary
import type { OrgRole, OrgPermission } from "@repo/types";

const READ = ["tasks.read", "runs.read"] as const;

export const PERMISSIONS = {
    owner: ["*"],
    admin: [...READ, "examples.second_label", "examples.manage", "tasks.manage", "prompts.manage",
            "runs.start", "runs.publish", "members.manage", "org.update"],
    reviewer: [...READ, "examples.second_label"],
    viewer: [...READ],
} as const satisfies Record<OrgRole, readonly string[]>;

export type Permission = OrgPermission;

export const can = (role: OrgRole | undefined, permission: Permission): boolean => {
    if (!role) return false;
    const allowed = PERMISSIONS[role] as readonly string[];
    return allowed.includes("*") || allowed.includes(permission);
};
```

**Why a labeller can't overwrite your labels.** Double-labelling measures agreement: two people label
the same 20 postings independently, and the disagreements show where the field rules are ambiguous
(Phase 12 computes it). If the second labeller could edit `expected`, the agreement number would mean
nothing. So `reviewer` writes only `Example.secondLabel`; you resolve disagreements by editing
`expected` yourself, and the audit log records it.

**Live roles.** A token is a snapshot. `resolveMembership` (COPY logic) reads the membership row, caches
the role 60 s under `cache:membership:<orgId>:<userId>`, and `revokeMembership` deletes that key on a
role change or removal, so a removed labeller is locked out on their **next** request. With the cache
down it reads Postgres every time: slower, never more permissive.

**404 for strangers.** A non-member asking for `/orgs/<someone else's id>/tasks` gets
`404 Organisation not found`, the same as for an id that doesn't exist. A 403 would confirm it exists.

**The org id in the path** (architecture.md §4). PaperTrail's `resolveOrg` reads `X-Org-Id`. The ADAPT
reads the path first and treats a disagreeing header as a client bug:

```ts
// middleware/resolveOrg.ts — ADAPT
const resolveOrg = catchError(async (req, _res, next) => {
    const fromPath = req.params.orgId;
    const fromHeader = req.get("x-org-id") || undefined;
    appAssert(!fromPath || !fromHeader || fromPath === fromHeader, BAD_REQUEST,
        "X-Org-Id does not match the workspace in the URL");
    const raw = fromPath ?? fromHeader;
    const requested = raw ? idSchema("workspace id").parse(raw) : undefined;

    const { orgId, role } = await resolveMembership(req.userId, requested);
    req.orgId = orgId;
    req.orgRole = role;
    setRequestContext({ orgId, userId: req.userId });   // the tenant extension reads this
    next();
});
```

Routers that use it are created with `Router({ mergeParams: true })`, so `:orgId` from the mount path
reaches the middleware.

**The tenant extension.** `src/db/prisma.ts` is PaperTrail's file; only `TENANT_MODELS` differs. It's
data-model.md's list: `Invite`, `AuditLog`, `Task`, `Example`, `PromptVersion`, `Run`, `RunVariant`,
`Result`. If Phase 03 already wrote the full list, there's nothing to change. Names of models that don't
exist yet are harmless in the set. A tenant model **missing** from the set is the one real way to leak,
so Phase 28's suite asserts that every Prisma model with an `orgId` field is in it.

Not tenant tables: `User`, `Session`, `VerificationLink`, `Org`, `Membership`, `Model`. They're read to
*establish* the tenant, and the copied services filter them by `userId`/`orgId` by hand.

**Invitations.** From PaperTrail's `invite.service.ts`:
- The token is 32 random bytes; only its SHA-256 is stored (`Invite.tokenHash`, unique), so a database
  leak hands out no live invitations.
- **Email-bound**: accepting compares the signed-in user's email to the invite's (normalised). The
  preview shows it masked (`ra**@example.com`).
- **Single use under concurrency**: `prisma.invite.deleteMany({ where: { id } })` must return
  `count === 1`. Two concurrent accepts both read the invite, but only one delete removes a row. Then
  `membership.upsert(… update: {})`: an invitation **adds** a membership and never changes one.
- **Newest wins**: a new invite to the same email in this workspace deletes the older pending one.

**The token stays out of paths.** PaperTrail's link is `/invites/<token>` and its API route
`GET /invites/:token`. Paths end up in access logs, proxy logs and `Referer` headers. Here, as in the
Playbook and the Enquiry plan:

```
GET  /invites#token=…              web page; a fragment is never sent to any server
POST /invites/preview { token }    → { orgName, emailMasked, role }     (public, limited)
POST /invites/accept  { token }    → { orgId, role }                    (signed in)
```

`token` is on Phase 02's redaction list, so the POST bodies never reach a log either.

**Role caps** (ADAPT in `createInvite`): owners are never invited (they're promoted); an admin can
invite only reviewers and viewers; only an owner can invite an admin.

```ts
const INVITABLE: Record<OrgRole, readonly InviteRole[]> = {
    owner: ["admin", "reviewer", "viewer"],
    admin: ["reviewer", "viewer"],
    reviewer: [],
    viewer: [],
};
appAssert(INVITABLE[ctx.role].includes(role), FORBIDDEN,
    ctx.role === "admin" ? "Only an owner can invite another admin" : "You can't invite people");
```

**Audit log.** PaperTrail's `AuditLog` has `orgId` but **no foreign key**: it outlives what it
describes. That's why `hardDeleteOrg` deletes audit rows explicitly; every other child table cascades
from `Org` (tasks → examples, prompts, runs → results). Phases 12–13 and 22 write label edits, prompt
freezes and publishes into it.

## 6. Steps

1. **Schema.** From PaperTrail copy `enum OrgRole`, `enum InviteRole`, `enum ActorType`, `model
   Membership`, `model Invite`, `model AuditLog`, and add this `Org` (data-model.md):
   ```prisma
   model Org {
     id                     String   @id @default(uuid(7)) @db.Uuid
     name                   String
     createdById            String   @map("created_by") @db.Uuid
     // Owner-key model spend per calendar month (UTC). Read by the runner (Phase 17).
     monthlyBudgetUsdMicros BigInt   @default(20000000) @map("monthly_budget_usd_micros")
     createdAt              DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
     updatedAt              DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

     createdBy   User         @relation("OrgCreatedBy", fields: [createdById], references: [id])
     memberships Membership[]
     invites     Invite[]

     @@map("orgs")
   }
   ```
   Add the back-relations to `User` (`memberships`, `orgsCreated @relation("OrgCreatedBy")`,
   `invitesSent @relation("InviteInvitedBy")`). Migrate:
   `pnpm --filter api db:migrate:dev --name workspaces` (in a script: `prisma migrate dev --name
   workspaces < /dev/null && prisma generate`; Prisma 7's `migrate dev` no longer runs `generate`).
2. **Types** (`@repo/types/org.ts`): keep `orgRoleSchema`, `inviteRoleSchema`, `memberSummarySchema`,
   `changeMemberRoleSchema`, `inviteSchema`, `pendingInviteSchema`, `invitePreviewSchema`. Replace the
   permission enum with §5's list. Add:
   ```ts
   export const updateOrgSchema = z.object({
       name: z.string().trim().min(2).max(120).optional(),
       monthlyBudgetUsd: z.number().min(0).max(1000).optional(),   // owner only (budget.manage), checked in the service
   });
   export const deleteOrgSchema = z.object({ confirmName: z.string() });
   export const inviteTokenSchema = z.object({ token: z.string().min(20).max(200) });
   ```
   Build `@repo/types` (`pnpm --filter @repo/types build`): the API consumes its `dist`.
3. **Services.**
   - `org.service.ts`: keep `membershipCacheKey`, `createPersonalOrg`, `ensurePersonalOrg`,
     `resolveMembership`, `listMyOrgs`, `updateOrg`. `toOrgDto` returns `{ id, name, createdBy,
     monthlyBudgetUsd: Number(org.monthlyBudgetUsdMicros) / 1e6, createdAt, updatedAt }`. `updateOrg`
     refuses a budget change unless `can(role, "budget.manage")`.
   - `invite.service.ts`: the role-cap assert at the top of `createInvite`; fallback org name
     `"a workspace"`; audit `diff` carries the role, not the email. `getInvitePreview` and
     `acceptInvite` stay in `runAsSystem` (the caller isn't a member yet; the token is the scope).
   - `deletion.service.ts`:
     ```ts
     export const hardDeleteOrg = async (orgId: string, actorId: string, confirmName: string) => {
         const org = await prisma.org.findUnique({ where: { id: orgId } });
         appAssert(org, NOT_FOUND, "Organisation not found");
         appAssert(confirmName.trim() === org.name, BAD_REQUEST, "Type the workspace name exactly to delete it");
         const members = await prisma.membership.findMany({ where: { orgId }, select: { userId: true } });
         await withTransaction(async (tx) => {
             await tx.auditLog.deleteMany({ where: { orgId } });   // no FK, so not cascaded
             await tx.org.delete({ where: { id: orgId } });        // cascades memberships, invites, tasks → everything
         });
         await cache.del(...members.map((m) => membershipCacheKey(orgId, m.userId)));
         // Phase 17: cancel this workspace's queued cells before deleting (a running run's jobs would 404 harmlessly, but waste calls).
         logger.info({ orgId, actorId }, "workspace deleted");
         return { deleted: true };
     };
     ```
4. **Auth.** Restore `await createPersonalOrg(created, tx)` inside the register transaction and
   `await ensurePersonalOrg(user)` in Google sign-in, exactly as `@pt-api`. Diff both files against
   PaperTrail's afterwards.
5. **Routes.**
   ```ts
   // org.route.ts
   export const orgRouter = Router();
   orgRouter.use(authenticate, protectedApiLimiter);
   orgRouter.get("/", listMyOrgsHandler);

   const one = Router({ mergeParams: true });
   one.use(resolveOrg);
   one.get("/", requireOrgRole("tasks.read"), getOrgHandler);
   one.patch("/", requireOrgRole("org.update"), updateOrgHandler);
   one.delete("/", requireOrgRole("org.delete"), deleteOrgHandler);
   one.use("/members", memberRouter);
   one.use("/invites", orgInviteRouter);
   // Phase 11: one.use("/tasks", taskRouter)   Phase 17: one.use("/runs", runRouter)
   orgRouter.use("/:orgId", one);

   // invite.route.ts
   export const orgInviteRouter = Router({ mergeParams: true });   // behind `one`: already authenticated + resolved
   orgInviteRouter.post("/", requireOrgRole("members.manage"), inviteSourceLimiter, inviteTargetLimiter, createInviteHandler);
   orgInviteRouter.get("/", requireOrgRole("members.manage"), listPendingInvitesHandler);
   orgInviteRouter.delete("/:id", requireOrgRole("members.manage"), revokeInviteHandler);

   export const publicInviteRouter = Router();                     // mounted at /invites
   publicInviteRouter.post("/preview", invitePreviewLimiter, getInvitePreviewHandler);
   publicInviteRouter.post("/accept", authenticate, protectedApiLimiter, acceptInviteHandler);
   ```
   `member.route.ts` is PaperTrail's without `idempotency`, with `tasks.read` on the list. Add
   `invitePreviewLimiter` to `config/rateLimiter.ts` (per IP, 30 / 10 min: tokens are unguessable, but
   the endpoint is unauthenticated). In `app.ts`: `app.use("/orgs", orgRouter)`,
   `app.use("/invites", publicInviteRouter)`, and add `"X-Org-Id"` to the CORS `allowedHeaders`.
6. **Email.** `getOrgInviteEmail(token, orgName, role)`: link `${CLIENT_URL}/invites#token=${token}`,
   subject `"You're invited to ${orgName} on Prompt Lab"`, plain text + HTML. Add
   `JOB_NAMES.EMAIL.ORG_INVITE`, `EmailProducer.sendOrgInvite` with `jobId: invite-<inviteId>` (dedupes
   double clicks), and the processor case. The payload carries the token because the email must; that's
   why Bull Board stays guarded (Phase 08).
7. **Purge.** In `purgeExpired.processor.ts`, replace `// Phase 10: expired invites` with
   `prisma.invite.deleteMany({ where: { expiresAt: { lt: now } } })` and return its count.
8. **`test/tenancy.routes.ts`**: the registry Phase 28 walks; later phases append their id routes.
   ```ts
   export const TENANT_ROUTES = [
       { method: "get", path: "/orgs/:orgId" },
       { method: "patch", path: "/orgs/:orgId", body: { name: "x" } },
       { method: "get", path: "/orgs/:orgId/members" },
       { method: "get", path: "/orgs/:orgId/invites" },
       { method: "post", path: "/orgs/:orgId/invites", body: { email: "x@example.com", role: "viewer" } },
   ] as const;
   ```
9. **`scripts/check-tenancy.ts`**: outside any context, `prisma.auditLog.findMany({})` must throw
   `Tenant scope missing`. Inside `runWithRequestContext({ orgId: A })`,
   `prisma.auditLog.findMany({ where: { orgId: B } })` must throw `Cross-tenant query refused`. Print
   `OK` when both throw. Close Prisma, the queue connection and the cache in `finally` (otherwise the
   script hangs; Playbook lesson).
10. **Web.**
    - Copy `org.store.ts`. In `lib/api.ts`, restore PaperTrail's two lines that send `X-Org-Id` from
      `useOrgStore.getState().selectedOrgId`.
    - `api/org.ts`: `listMyOrgs`, `getOrg`, `updateOrg`, `deleteOrg`, `listMembers`,
      `changeMemberRole`, `removeMember`, `createInvite`, `listPendingInvites`, `revokeInvite`,
      `previewInvite(token)` (POST), `acceptInvite(token)` (POST), all on `/orgs/${orgId}/…`.
    - `OrgSwitcher`: label **Workspace**. Switching calls `clearUserQueries()` so one workspace's tasks
      never flash under another's name. If `selectedOrgId` isn't in `GET /orgs` (you were removed),
      select the first workspace.
    - `settings/members`: members table (role select limited by `can()`, remove, leave; the last-owner
      409 shown inline) and an invitations panel (email + role from `INVITABLE[myRole]`, pending list
      with expiry and Revoke). The panel explains the reviewer role: "can add second labels, can't edit
      your labels or start runs".
    - `invites/page.tsx`: read the token from `location.hash`, save it to `sessionStorage` (try/catch)
      under `pending-invite`, `history.replaceState(null, "", "/invites")`, then preview. Signed in with
      the invited address → **Accept** → select the new workspace → `/tasks`. Wrong address → "This
      invitation is for ra**@example.com" + Sign out. Signed out → Sign in / Create account with
      `next=/invites` (the stored token survives verification).

## 7. Verify

```bash
pnpm --filter api db:migrate:dev --name workspaces < /dev/null       # "Your database is now in sync"
pnpm --filter api exec tsx src/scripts/check-tenancy.ts              # OK

# A new account owns a workspace straight away.
curl -s -b a.txt localhost:5000/orgs | jq '.data[0] | {name, role}'
# {"name":"Ravi's workspace","role":"owner"}
ORG_A=$(curl -s -b a.txt localhost:5000/orgs | jq -r '.data[0].id')

curl -s -o /dev/null -w '%{http_code}\n' -b b.txt localhost:5000/orgs/$ORG_A        # 404 (B isn't a member)
curl -s -o /dev/null -w '%{http_code}\n' -b a.txt localhost:5000/orgs/not-a-uuid    # 400
curl -s -b a.txt -H "x-org-id: $ORG_B" localhost:5000/orgs/$ORG_A | jq -r '.errors[0].message'
# X-Org-Id does not match the workspace in the URL

# Invite B as a reviewer (the second labeller).
curl -s -b a.txt -XPOST localhost:5000/orgs/$ORG_A/invites -H 'content-type: application/json' \
  -d '{"email":"b@example.com","role":"reviewer"}' | jq -r '.data.invite.role'        # reviewer
T=$(curl -s "localhost:5000/auth/dev/latest-link?email=b@example.com" | jq -r .email.link | sed 's/.*#token=//')
docker exec promptlab-postgres psql -U promptlab -d promptlab -tc "select token_hash from invites" | head -1   # a hash, not $T
curl -s -XPOST localhost:5000/invites/preview -H 'content-type: application/json' -d "{\"token\":\"$T\"}" | jq .data
# {"orgName":"Ravi's workspace","emailMasked":"b**@example.com","role":"reviewer"}
curl -s -b b.txt -XPOST localhost:5000/invites/accept -H 'content-type: application/json' -d "{\"token\":\"$T\"}" | jq -r .data.role
# reviewer
curl -s -b b.txt -XPOST localhost:5000/invites/accept -H 'content-type: application/json' -d "{\"token\":\"$T\"}" | jq -r '.errors[0].message'
# This invitation has expired or was already used

curl -s -o /dev/null -w '%{http_code}\n' -b b.txt -XPATCH localhost:5000/orgs/$ORG_A \
  -H 'content-type: application/json' -d '{"name":"x"}'                              # 403 (reviewer)
curl -s -o /dev/null -w '%{http_code}\n' -b b.txt -XDELETE localhost:5000/orgs/$ORG_A/members/<A's userId>   # 403
grep -c "$T" /tmp/api.log                                                            # 0 (no token in any log line)
```

- Promote someone to admin; as that admin invite `{"role":"admin"}` → 403 "Only an owner can invite
  another admin"; `{"role":"viewer"}` → 201.
- Two concurrent accepts (`curl … & curl … & wait`) → exactly one 200, one membership row.
- A 4th invite to the same email within a day → 429 (`inviteTargetLimiter`).
- A tries to demote themselves (the only owner) → 409 "An organisation needs at least one owner".
- Remove B → B's very next `GET /orgs/$ORG_A` → 404 (membership cache cleared).
- `DELETE /orgs/$ORG_A` with the wrong name → 400; with the right one → 200, and its memberships,
  invites and audit rows are gone.
- Web: register a second account from an invite link while signed out → verify → back on `/invites` →
  Accept → the Workspace switcher lists both workspaces; switching shows no request for the old id.

## 8. Definition of done

- [ ] `orgs`, `memberships`, `invites`, `audit_logs` migrated (migration `workspaces`); `Org` has only
      the data-model.md columns.
- [ ] Every new account owns a personal workspace (register and Google), as in PaperTrail.
- [ ] Every workspace route goes `authenticate → protectedApiLimiter → resolveOrg → requireOrgRole`;
      non-members get 404, wrong role 403, and role changes apply on the next request.
- [ ] `reviewer` has `examples.second_label` and nothing that writes `expected`, starts runs or invites.
- [ ] Invites: hash-only, 7-day, email-bound, single-use under concurrency, role caps, token only in a
      fragment or POST body; expired invites purged hourly.
- [ ] `check-tenancy.ts` prints `OK`; `test/tenancy.routes.ts` exists.
- [ ] Web: Workspace switcher, `/settings/members`, the accept page (including the new-account path).
- [ ] COPY files (`requireOrgRole`, `member.service`, `audit.service`, `org.store`) are identical to
      PaperTrail's.
- [ ] Commit: `feat: workspaces, roles and invitations (from PaperTrail orgs)`.

## 9. Interview angle

*"It's a personal benchmarking tool. Why multi-tenant?"* Because labels need a second pair of eyes. A
friend double-checks 20 postings, and the agreement rate is part of the result's credibility. That
friend gets a reviewer role: they can add a second label but can't touch mine or start runs. I already
had tenancy from my document-extraction project, with a Prisma extension that scopes every query to the
workspace in the URL and throws if a query has no scope, so a forgotten filter fails in development
instead of leaking. Strangers get 404s, so we don't even confirm a workspace exists.

*"How do invitations stay safe?"* The token is 256 random bits, stored only as a hash, bound to one
email, valid seven days, single use even under a double click, because acceptance is a conditional
delete. And it travels in the URL fragment and POST bodies, so it never lands in a server or proxy log.
