# Phase 04 — Accounts, sessions, refresh rotation, verification links

## 1. Goal

Copy PaperTrail's account system, which is e-commerce's auth ported to Prisma:
- the `User`, `Session` and `VerificationLink` tables (the first real migration);
- `POST /auth/register`, `GET /auth/verify/:token`, `POST /auth/verify/resend`, `POST /auth/login`,
  `GET /auth/refresh` and `GET /auth/logout`;
- JWT access (15 min) and refresh (30 days) tokens in httpOnly cookies, **sessions in the database**;
- **refresh-token rotation with reuse detection**: a replayed refresh token revokes the session;
- `revokeSessions()` as the single door for every revocation;
- login timing that doesn't reveal which emails are registered.

You sign up here, and so does your second labeller (spec §6: "ask a friend to double-check 20"). A
new account belongs to **no workspace yet**. Phase 10 adds "create a workspace" and joining one by
invite.

## 2. What I will understand after this phase

1. Why sessions live in PostgreSQL when JWTs are "stateless".
2. How rotation works: one valid `jti` per session, a conditional update, a 30 s grace window for two
   tabs, and revocation when an old token is replayed.
3. Why access and refresh tokens differ in **audience**, **secret** and **cookie path**.
4. Why only the SHA-256 of a verification token is stored.
5. Why an unknown email still costs one bcrypt comparison.
6. Why PaperTrail's `createPersonalOrg` call is removed here.

## 3. Prerequisites

- Phase 03 done: Prisma generates, and `/health` reports the database.
- Read `@pt-root/docs/reference/ecommerce-architecture.md` §4 (authentication).

## 4. Files

```
packages/types/src/
├── user.ts                              ADAPT  @pt-root/packages/types/src/user.ts   (drop addressSchema / updateAddressSchema)
├── cookie.ts                            COPY   @pt-root/packages/types/src/cookie.ts
└── index.ts                             ADAPT  (+ user, cookie)
apps/api/
├── prisma/schema.prisma                 ADAPT  (+ AuthProvider, PlatformRole, User, Session, VerificationLink from @pt-api, minus back-relations to tables not copied)
└── src/
    ├── constants/
    │   ├── env.ts                       ADAPT  (+ JWT_SECRET, JWT_REFRESH_SECRET with PaperTrail's length/equality checks)
    │   └── verificationLinkType.ts      COPY   @pt-api/src/constants/verificationLinkType.ts
    ├── types/
    │   ├── auth.types.ts                COPY   @pt-api/src/types/auth.types.ts
    │   ├── user.types.ts                COPY   @pt-api/src/types/user.types.ts
    │   ├── session.types.ts             COPY   @pt-api/src/types/session.types.ts
    │   ├── verificationLink.types.ts    COPY   @pt-api/src/types/verificationLink.types.ts
    │   └── express.d.ts                 ADAPT  @pt-api/src/types/express.d.ts   (userId, sessionId, role only; orgId/orgRole in Phase 10)
    ├── utils/
    │   ├── auth/{bcrypt,cookies,jwt,verificationToken,index}.ts   COPY  @pt-api/src/utils/auth/  (not apiKey.ts)
    │   └── date/{date,index}.ts                                   COPY  @pt-api/src/utils/date/
    ├── services/auth.service.ts         ADAPT  @pt-api/src/services/auth.service.ts  (no personal workspace; cache and email as Phase comments)
    ├── controllers/auth.controller.ts   ADAPT  @pt-api/src/controllers/auth.controller.ts (register, login, logout, refresh, verify, resend)
    ├── routes/auth.route.ts             ADAPT  @pt-api/src/routes/auth.route.ts   (those six routes; limiters in Phase 06)
    ├── middleware/errorHandler.ts       ADAPT  (restore clearAuthCookies on the refresh path)
    └── app.ts                           ADAPT  (mount /auth)
```

```bash
pnpm --filter api add bcrypt@^6.0.0 jsonwebtoken@^9.0.3
pnpm --filter api add -D @types/bcrypt@^6.0.0 @types/jsonwebtoken@^9.0.10
```

## 5. Concepts

**Sessions are rows.** The access token carries `{ userId, role, sessionId }`; the refresh token
carries only `{ sessionId, jti }`. A session is a `sessions` row, and three things delete it:
- logout;
- a password reset (Phase 05);
- "sign out this device" (Phase 05).

Without the row, a stolen token would work until it expired. Phase 05's `authenticate` checks the row
on every request (cached for 60 s in Phase 07).

**Three independent locks on tokens.**
- **Different audiences** (`access`, `refresh`), so one can't be used as the other.
- **Different secrets**, each at least 32 characters, checked at boot (`env.ts` throws otherwise).
- **The algorithm pinned** to HS256 on sign and verify, so a token can't choose `none`.

The refresh cookie is scoped to `path: /auth/refresh`, so the browser sends it nowhere else.

**Rotation with reuse detection** (`refreshUserAccessToken`, copied unchanged):
1. Verify the refresh JWT. Load the session (it must exist and not be expired) and the user.
2. Run a **conditional update**: `updateMany({ where: { id, refreshJti: presented }, data: {
   refreshJti: new, prevRefreshJti: presented, rotatedAt: now, expiresAt: +30 d } })`. Only one
   concurrent refresh can match, so two can't both rotate.
3. If it matched 0 rows, re-read the session:
   - The presented `jti` was replaced less than 30 s ago: two tabs raced. Answer with the current
     token.
   - Otherwise it's a **replayed old token**, so someone has a copy. Revoke the session, which signs
     out both the thief and the user.

That's the refresh-token rotation from the OAuth 2.0 Security BCP, with the multi-tab race handled.

**Verification links.** The token is 256 random bits and is emailed raw. Only `sha256(token)` is
stored, so a database leak hands out no live links. Redeeming finds the row by digest, then deletes it
by id with `deleteMany`. Only the first of two concurrent clicks gets `count === 1`, so a link can't
be used twice.

**No account enumeration.**
- An unknown email at login still runs one bcrypt compare against a dummy hash, so a wrong email takes
  as long as a wrong password.
- "Resend verification" answers identically whether or not the account exists.
- Register does say "User already exists". That's the honest trade-off for a sign-up form, and it's
  rate-limited in Phase 06.

**Why no personal workspace.** PaperTrail creates an org in the same transaction as the user. It also
can't, yet: workspaces arrive in Phase 10, and this phase stays inside its own scope. When Phase 10
lands, the web app sends a signed-in user with no memberships to "Create your workspace". A labeller
invited to your workspace never gets an empty one of their own in the switcher.

## 6. Steps

1. **@repo/types.** Copy `cookie.ts`. Copy `user.ts`, then delete `addressSchema`,
   `updateAddressSchema` and their types (there are no addresses here). Export both files from
   `index.ts`, then run `pnpm --filter @repo/types build`.

2. **env.ts.** Copy PaperTrail's `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MIN_JWT_SECRET_LENGTH` and both
   checks verbatim. `.env.example`:
   ```
   # Two DIFFERENT random secrets of at least 32 characters; the server refuses to start otherwise.
   # Generate each with: openssl rand -hex 32
   JWT_SECRET=
   JWT_REFRESH_SECRET=
   ```

3. **Schema.** Add the two enums and the three models from `@pt-api/prisma/schema.prisma`. In `User`,
   keep only `sessions` and `verificationLinks` as relations. Drop `memberships`, `orgsCreated`,
   `invitesSent`, `apiKeysCreated`, `documentsUploaded` and `documentsApproved`; Phase 10 adds back the
   ones this project uses. Then:
   ```bash
   pnpm --filter api db:migrate:dev --name accounts < /dev/null
   ```

4. **Copy** the auth utils, the date utils, the four type files and `verificationLinkType.ts`. Then
   write `express.d.ts`:
   ```ts
   import type { User } from "../generated/prisma/client";

   declare global {
       namespace Express {
           interface Request {
               userId: string;
               sessionId: string;
               role: User["role"];
               // Phase 06: visitorId. Phase 10: orgId, orgRole.
           }
       }
   }
   export {};
   ```

5. **auth.service.ts.** Copy the whole file, then make exactly these changes:
   - **`createAccount`:** replace the transaction that also calls `createPersonalOrg` with a plain
     create, and drop the `withTransaction` and `createPersonalOrg` imports:
     ```ts
     // No personal workspace: owners create one, labellers join by invite (Phase 10).
     const user = await prisma.user.create({ data: { name: data.name, email, password } });
     ```
   - **`revokeSessions`:** remove `await cache.del(...)`, leave
     `// Phase 07: await cache.del(...ids.map(sessionCacheKey));` in its place, and remove the `cache`
     import.
   - **`issueEmailVerificationLink`:** replace the `EmailProducer.sendVerifyMail` call with:
     ```ts
     // Phase 08: await EmailProducer.sendVerifyMail({ userId: user.id, email: user.email, verificationToken: token });
     if (NODE_ENV === "development") {
         logger.debug({ url: `${CLIENT_URL}/auth/verify/${token}` }, "dev verification link (no email until Phase 08)");
     }
     ```
   - **Leave out** `sentResetPasswordEmail`, `resetPassword`, `updateProfileService` and
     `changePasswordService`; Phase 05 copies them.

   The diff against PaperTrail is then exactly these edits plus the missing functions.

   The dev link is logged at `debug` with the key `url`, not `token`, so the Phase 02 redaction
   doesn't hide it. It only happens in development.

6. **auth.controller.ts.** Copy these handlers unchanged and remove the imports for functions not
   copied yet:
   - `registerHandler`, `loginHandler`, `logoutHandler`;
   - `refreshHandler`, `verifyEmailHandler`, `resendVerificationHandler`.

7. **auth.route.ts:**
   ```ts
   export const authRoutes = Router();
   // prefix: /auth. Phase 06 puts the source/account/pair limiters in front of each route.
   authRoutes.post("/register", registerHandler);
   authRoutes.post("/login", loginHandler);
   authRoutes.get("/refresh", refreshHandler);
   authRoutes.get("/logout", logoutHandler);
   authRoutes.get("/verify/:token", verifyEmailHandler);
   authRoutes.post("/verify/resend", resendVerificationHandler);
   ```
   `refresh` and `logout` stay **GET**, as in PaperTrail, so the copied web client (Phase 09) calls
   them unchanged. Both are safe from CSRF in practice: the cookies are `SameSite`, the refresh cookie
   is scoped to one path, and the responses only set cookies.

8. **errorHandler.ts:** put back `if (_req.path === REFRESH_PATH) clearAuthCookies(res);`. A failed
   refresh must clear the dead cookies, or the client retries forever.

9. **app.ts:** `app.use("/auth", authRoutes);`.

10. Commit: `feat(api): accounts, DB sessions, refresh rotation with reuse detection`.

## 7. Verify

```bash
pnpm --filter api dev
J=/tmp/pl.jar; rm -f $J

curl -s -X POST localhost:5000/auth/register -H 'content-type: application/json' \
  -d '{"name":"Venkatesh","email":"Me@Example.com","password":"correct-horse-1","confirmPassword":"correct-horse-1"}'
# {"status":"success","data":{"title":"Account created Successfully",…}}
# dev terminal: DEBUG dev verification link … "url":"http://localhost:3000/auth/verify/<64 hex>"

docker exec promptlab-postgres psql -U promptlab -d promptlab -tAc "select email, verified from users;"
# me@example.com|f                        (lower-cased on write)
docker exec promptlab-postgres psql -U promptlab -d promptlab -tAc "select length(token) from verification_links;"
# 64                                       (the SHA-256 hex, not the emailed token)

curl -s -X POST localhost:5000/auth/login -H 'content-type: application/json' \
  -d '{"email":"me@example.com","password":"correct-horse-1"}'
# 401 "Your email is not verified yet…"

curl -s -c $J localhost:5000/auth/verify/<token from the log>
# {"status":"success","data":{"user":{…,"verified":true},"message":"Email verified successfully!"}}
curl -s localhost:5000/auth/verify/<same token>
# 400 "Verification link has expired or is invalid."      (single use)

# Rotation:
curl -s -b $J -c $J localhost:5000/auth/refresh        # success, new cookies
cp $J /tmp/old.jar
curl -s -b $J -c $J localhost:5000/auth/refresh        # success again (rotated)
sleep 31
curl -s -b /tmp/old.jar localhost:5000/auth/refresh
# 401 "Session revoked"                                  (replay of a replaced token)
curl -s -b $J localhost:5000/auth/refresh
# 401 "Session Expired!"                                 (the whole session is gone: thief and victim out)

# Timing (unknown vs known email, wrong password): about the same, ≥ one bcrypt compare each
time curl -s -X POST localhost:5000/auth/login -H 'content-type: application/json' -d '{"email":"nobody@x.co","password":"x"}' >/dev/null
time curl -s -X POST localhost:5000/auth/login -H 'content-type: application/json' -d '{"email":"me@example.com","password":"x"}' >/dev/null

# Copies:
for f in utils/auth/bcrypt.ts utils/auth/cookies.ts utils/auth/jwt.ts utils/auth/verificationToken.ts \
         types/auth.types.ts types/user.types.ts constants/verificationLinkType.ts; do
  diff -q ~/Code/paper-trail/apps/api/src/$f apps/api/src/$f; done
# (no output)
```

A boot check: set `JWT_REFRESH_SECRET` equal to `JWT_SECRET`. The server refuses to start with
`JWT_SECRET and JWT_REFRESH_SECRET must be different values`.

## 8. Definition of done

- [ ] Migration `accounts` applied: three tables with snake_case columns and UUIDv7 ids.
- [ ] Register → verify (single use) → login → refresh → logout works with cookies.
- [ ] Replaying a refresh token older than the 30 s grace window revokes the session.
- [ ] Only token digests are stored, and emails are stored lower-case.
- [ ] An unknown email and a wrong password take about the same time.
- [ ] No workspace is created. No email is sent: the dev link is logged at debug only.
- [ ] Copied files are identical, and every removed call has a `// Phase NN:` comment.
- [ ] Committed; `tracker.md` updated.

## 9. Interview angle

*"JWTs are stateless. Why a session table?"* Because logout has to work. A signed token proves it was
issued, not that the user still wants it valid. With a session row, logout, a password reset or "sign
out the laptop I left at the lab" delete the row, and the next request fails. Phase 07 caches the
check for 60 seconds, so each request costs one Redis read, not one database query.

*"What happens if a refresh token is stolen?"* Each refresh token is single-use: refreshing rotates
the session's `jti` with a conditional update. If the thief refreshes first, the user's next refresh
presents a replaced token, and if the user refreshes first, the thief's does. Either way, a replaced
token outside the 30-second two-tab window revokes the whole session. The stolen copy dies, and the
user signs in again. That's the OAuth Security BCP's rotation pattern, implemented by hand.
