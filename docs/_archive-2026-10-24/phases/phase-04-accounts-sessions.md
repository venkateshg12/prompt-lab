# Phase 04 — Accounts, sessions, refresh rotation

## 1. Goal

Copy the account system that originated in e-commerce and is now hardened and tested in PaperTrail:
- register, verify email, login, logout;
- **refresh with rotation and reuse detection**;
- forgot/reset password, change password, profile.

The one change: no organisations. Sign-up creates a user, not a workspace org, because the user
*is* the workspace (`ownerId`).

Until the queue arrives in Phase 08, emails go through a temporary producer that logs the link (the
same trick as PaperTrail's Phase 04).

Read the concept section of `~/Code/paper-trail/docs/phases/phase-04-accounts-sessions.md` (or
`~/Code/paper-trail/docs/reference/ecommerce-architecture.md` §4) for the reasoning: three locks on
tokens, rotation with a 30 s multi-tab grace window, sessions as documents, timing-safe login, hashed
single-use links, the 72-byte password cap.

## 2. What I will understand after this phase

1. Rotation and reuse detection, well enough to draw them.
2. Why sessions are documents.
3. Why login against an unknown email still runs bcrypt.
4. What changes when there's no org in the sign-up transaction (the answer: almost nothing, which is
   the point of the layering).

## 3. Prerequisites

Phase 03 done.

## 4. Files

```
packages/types/src/{user,cookie}.ts            COPY   @pt-root/packages/types/src/
apps/api/src/
├── constants/verificationLinkType.ts          COPY   @pt-api/src/constants/verificationLinkType.ts
├── utils/date/*                               COPY   @pt-api/src/utils/date/
├── utils/auth/{bcrypt,cookies,jwt,verificationToken}.ts   COPY   @pt-api/src/utils/auth/
├── utils/auth/index.ts                        ADAPT  @pt-api/src/utils/auth/index.ts   (no apiKey export)
├── types/{auth,session,verificationLink,user}.types.ts    COPY   @pt-api/src/types/
├── types/express.d.ts                         ADAPT  @pt-api/src/types/express.d.ts    (userId, sessionId, role, visitorId only)
├── models/{user,session,verificationLink}.model.ts        COPY   @pt-api/src/models/
├── services/auth.service.ts                   ADAPT  @pt-api/src/services/auth.service.ts  (no org)
├── controllers/auth.controller.ts             COPY   @pt-api/src/controllers/auth.controller.ts
├── routes/auth.route.ts                       ADAPT  @pt-api/src/routes/auth.route.ts  (limiters stubbed until Phase 06)
├── jobs/producers/email.producer.ts           NEW    (TEMPORARY stub; replaced in Phase 08)
├── utils/cache/index.ts                       NEW    (TEMPORARY stub; replaced in Phase 07)
└── constants/env.ts                           ADAPT  (+ JWT secrets block with its entropy checks, verbatim)
```

```bash
pnpm --filter api add bcrypt jsonwebtoken && pnpm --filter api add -D @types/bcrypt @types/jsonwebtoken
```

## 5. Concepts

**Removing orgs cleanly.** PaperTrail's `createAccount` wraps "create user + `createPersonalOrg`" in a
transaction. Prompt Lab removes the org call **and the transaction** (one insert needs none), and goes
back to e-commerce's original shape:

```ts
const user = await UserModel.create({ name: data.name, email: data.email, password: data.password });
await issueEmailVerificationLink(user);
return { user: user.omitPassword() };
```

Everything else in `auth.service.ts` (rotation, `revokeSessions`, reset, change password) is untouched.
Layering pays off: tenancy lived in one call.

**Who can run experiments?** Only signed-in owners spend *the server's* provider keys. Visitors can
look at published results and run small experiments with *their own* key (Phase 22). That's why auth
exists at all in a tool that looks single-user.

## 6. Steps

```bash
cd ~/Code/prompt-lab; PT=~/Code/paper-trail; A=apps/api/src
cp $PT/packages/types/src/{user,cookie}.ts packages/types/src/
mkdir -p $A/{utils/date,utils/auth,types,models,services,controllers,routes,jobs/producers,utils/cache}
cp $PT/$A/constants/verificationLinkType.ts $A/constants/
cp $PT/$A/utils/date/* $A/utils/date/
cp $PT/$A/utils/auth/{bcrypt,cookies,jwt,verificationToken}.ts $A/utils/auth/
cp $PT/$A/types/{auth,session,verificationLink,user}.types.ts $A/types/
cp $PT/$A/models/{user,session,verificationLink}.model.ts $A/models/
cp $PT/$A/controllers/auth.controller.ts $A/controllers/
cp $PT/$A/services/auth.service.ts $A/services/ && cp $PT/$A/routes/auth.route.ts $A/routes/
```

Then:
1. `utils/auth/index.ts`: export the four copied modules (PaperTrail's also exports `apiKey`).
2. `types/express.d.ts`:
   ```ts
   declare global { namespace Express { interface Request {
       userId: Types.ObjectId; sessionId: Types.ObjectId; role: UserDocument["role"]; visitorId?: string;
   } } }
   ```
3. `auth.service.ts`: remove the `createPersonalOrg` import and the transaction in `createAccount`
   (shape above). Keep everything else.
4. `auth.route.ts`: replace the limiter imports with a temporary `pass` middleware (Phase 06 restores
   them), and leave the `/me` routes until Phase 05 (they need `authenticate`).
5. The temporary `email.producer.ts` and `utils/cache/index.ts` stubs: copy them from PaperTrail's
   Phase 04 guide, §6.5–6.6.
6. `errorHandler.ts`: its refresh-path cookie clearing now resolves.
7. Mount `app.use("/auth", authRoutes)`.

## 7. Verify

Run the cookie-jar walkthrough from PaperTrail's Phase 04 Verify section against `localhost:5000`:
register → link in the log → verify → refresh rotates → after 31 s the old refresh token revokes the
session. Also: a 73-byte password → 400. `diff -q` every COPY file against `~/Code/paper-trail`.

## 8. Definition of done

- [ ] The full auth flow works; replay detection works; stubs are marked TEMPORARY.
- [ ] Only `auth.service.ts`, `express.d.ts`, `utils/auth/index.ts` and `auth.route.ts` differ from
      PaperTrail.
- [ ] Commit: `feat(api): accounts and sessions (from PaperTrail / e-commerce)`.

## 9. Interview angle

The rotation story, then: *"In this project I removed multi-tenancy by deleting one call. The auth
service didn't need to know, because it never did tenancy itself."*
