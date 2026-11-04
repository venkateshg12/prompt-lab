# Phase 05 — `authenticate`, `/auth/me`, device sessions, Google sign-in, password reset

## 1. Goal

Finish the account system copied from PaperTrail:
- `authenticate` middleware: verify the access token, **then check the session row is still alive**;
- `requireAdmin` (platform admin, live role), used later by the model registry probe (Phase 15), the
  DLQ (Phase 17) and the queue dashboard (Phase 08);
- `GET/PATCH /auth/me` and `POST /auth/me/password`;
- device sessions: `GET /session` (with `isCurrent`) and `DELETE /session/:id`;
- Google sign-in (`POST /auth/google`) with the unverified-account takeover rule;
- forgot and reset password, with the reset token sent in the **body**, never the URL.

## 2. What I will understand after this phase

1. Why a valid signature isn't enough, what the session check costs, and how Phase 07 makes it cheap.
2. Why `requireAdmin` reads the role from the database instead of trusting the token.
3. Why every revocation goes through `revokeSessions`: logout, reset, change password, revoke device
   and Google takeover.
4. Why a Google sign-in can take over an **unverified** local account with the same email.
5. Why the reset endpoint answers the same whether or not the email exists.
6. Why the reset token moves from the path into the body.

## 3. Prerequisites

- Phase 04 done (register, verify, login, refresh, logout).
- A Google Cloud OAuth **Web client** id for sign-in: Credentials → Create OAuth client ID → Web, with
  authorised JavaScript origin `http://localhost:3000`. It's a different client from the Gmail system
  sender (Phase 08).

## 4. Files

```
packages/types/src/user.ts                ADAPT  (resetPasswordSchema gains `token`)
apps/api/src/
├── constants/env.ts                      ADAPT  (+ GOOGLE_CLIENT_ID)
├── middleware/
│   ├── authenticate.ts                   ADAPT  @pt-api/src/middleware/authenticate.ts  (session check without the cache until Phase 07; + setRequestContext)
│   └── requireAdmin.ts                   COPY   @pt-api/src/middleware/requireAdmin.ts
├── services/auth.service.ts              ADAPT  (+ sentResetPasswordEmail, resetPassword, updateProfileService, changePasswordService from @pt-api)
├── controllers/
│   ├── auth.controller.ts                ADAPT  (+ forgot, reset (token in body), me, update me, change password)
│   ├── session.controller.ts             COPY   @pt-api/src/controllers/session.controller.ts
│   └── googleAuth.controller.ts          ADAPT  @pt-api/src/controllers/googleAuth.controller.ts (no ensurePersonalOrg; logger, not console)
├── routes/
│   ├── auth.route.ts                     ADAPT  (+ /google, /password/forgot, /password/reset, /me, /me/password)
│   └── session.route.ts                  ADAPT  @pt-api/src/routes/session.route.ts  (limiter in Phase 06)
└── app.ts                                ADAPT  (mount /session)
```

```bash
pnpm --filter api add google-auth-library@^9.15.0
```

## 5. Concepts

**The session check.** `authenticate`:
1. reads the access token from the `accessToken` cookie, or from a `Bearer` header so the benchmark
   CLI can call the API as you;
2. verifies the signature, audience and algorithm;
3. asks: does `sessions.id = sessionId` still exist, and has it not expired?

A forged or malformed token never reaches the database, because the signature is checked first. A
non-UUID `sessionId` is a 401, not a query error. Without the check, logout and "revoke device" would
leave the access token working for up to 15 minutes.

The cost is one indexed primary-key lookup per authenticated request. Phase 07 caches a
confirmed-active session in Redis for 60 seconds (`cache:session:<id>`), and `revokeSessions` deletes
that key. With Redis down, the cache reads as a miss and the check falls back to PostgreSQL, so it
**fails closed**.

**One door for revocation.** `revokeSessions(where)`:
1. finds the matching ids;
2. deletes **by id**, so a session created between the find and the delete isn't swept up;
3. from Phase 07, clears each cached check.

Logout, reset, change password ("sign out everywhere else"), revoke device and Google takeover all call
it. A direct `prisma.session.deleteMany` anywhere else is a bug: the cache would keep trusting a dead
session for up to a minute. Phase 28 greps for it.

**Live roles.** A token's `role` is a snapshot from when it was signed. `requireAdmin` reads
`users.role` on each admin request, so a demoted admin loses access immediately. Admin traffic is tiny,
so there's nothing worth saving. Phase 10 applies the same rule to workspace roles: `requireOrgRole`
reads `memberships.role` live, so a labeller you remove loses edit rights on the next request.

**Google takeover rule.** If an **unverified, local** account exists for an email that Google now
proves the user owns, someone may have pre-registered the victim's address. The real owner takes the
account over:
- the password is dropped and `authProvider` becomes `"google"`;
- sessions are revoked and pending links deleted.

A **verified** local account is simply linked (`googleId` is set).

**Forgot and reset.**
- `POST /auth/password/forgot { email }` always answers with the same generic message. If the account
  exists, older reset links are deleted, a new 10-minute link is created (digest stored) and the email
  is queued (Phase 08).
- `POST /auth/password/reset { token, password, confirmPassword }` consumes the link (single use),
  sets the password, deletes remaining reset links and **revokes every session** for the user.

**Why the token moves to the body.** PaperTrail uses `POST /auth/password/reset/:token`. Phase 02's
access log prints the path, so every reset would write a live credential into the logs for its
10-minute lifetime. With the token in the body, the API's log line is `POST /auth/password/reset`. The
web page still lives at `/password/reset/[token]`, the link in the email. That path is seen by the web
host, not by this API, and the page posts the token in the body (Phase 09 ADAPTs it).

## 6. Steps

1. **@repo/types.** In `user.ts`:
   ```ts
   export const resetPasswordSchema = registerFieldsSchema.pick({
       password: true,
       confirmPassword: true,
   }).extend({
       // The emailed token travels in the body, never the URL (Phase 05 §5).
       token: z.string().regex(/^[0-9a-f]{64}$/, { message: "Invalid or expired reset link" }),
   }).refine((data) => data.password === data.confirmPassword, {
       message: "Password do not match",
       path: ["confirmPassword"],
   });
   ```
   Rebuild the package (`pnpm --filter @repo/types build`).

2. **env.ts:** add `export const GOOGLE_CLIENT_ID = getEnv("GOOGLE_CLIENT_ID");`. In `.env.example`,
   add `GOOGLE_CLIENT_ID=` with a comment pointing at Credentials → OAuth client ID (Web).

3. **authenticate.ts.** Copy it, then replace the cache lines so the check is direct:
   ```ts
   const assertSessionActive = async (sessionId: AccessTokenPayload["sessionId"]) => {
       // Phase 07: return early on a cached "1" for cache:session:<id>, and cache it for 60 s after this check.
       const sessionIsActive =
           isUuid(sessionId) &&
           (await prisma.session.count({ where: { id: sessionId, expiresAt: { gt: new Date() } } })) > 0;
       appAssert(sessionIsActive, UNAUTHORIZED, "Session expired", appErrorCode.InvalidAccessToken);
   };
   ```
   The rest is unchanged: `authenticate` itself, and the error codes for an expired vs an invalid
   token. After `req.userId` and the rest are set, add `setRequestContext({ userId: payload.userId });`
   so log lines carry the actor (Phase 02's context). This is the one documented hunk in an otherwise
   copied file. Phase 07's Verify expects exactly this hunk.

4. **Copy** `requireAdmin.ts` and `session.controller.ts`.

5. **auth.service.ts:** copy `sentResetPasswordEmail`, `resetPassword`, `updateProfileService` and
   `changePasswordService` from PaperTrail. In `sentResetPasswordEmail`, replace the producer call:
   ```ts
   // Phase 08: await EmailProducer.sendPasswordReset({ userId: user.id, email: user.email, resetToken: token });
   if (NODE_ENV === "development") {
       logger.debug({ url: `${CLIENT_URL}/password/reset/${token}` }, "dev reset link (no email until Phase 08)");
   }
   ```

6. **auth.controller.ts:** copy `forgotPasswordHandler`, `getProfileData`, `updateProfileHandler` and
   `changePasswordHandler`. Rewrite `resetPasswordHandler`:
   ```ts
   export const resetPasswordHandler = catchError(async (req, res) => {
       const { token, password } = resetPasswordSchema.parse(req.body);
       await resetPassword({ token, password });
       clearAuthCookies(res).status(OK).json(ok("Password reset successful"));
   });
   ```

7. **googleAuth.controller.ts:** copy it, then make two changes:
   - Delete `ensurePersonalOrg` (both the import and the call), leaving
     `// Phase 10: no personal workspace; the web app sends a user with no memberships to onboarding.`
   - Replace `console.error(...)` with `logger.warn({ err }, "Google ID token verification failed")`.

8. **Routes.**
   ```ts
   // auth.route.ts (adds to Phase 04's six). Phase 06 adds limiters in front of each.
   authRoutes.post("/password/forgot", forgotPasswordHandler);
   authRoutes.post("/password/reset", resetPasswordHandler);
   authRoutes.post("/google", googleAuthHandler);
   authRoutes.get("/me", authenticate, getProfileData);
   authRoutes.patch("/me", authenticate, updateProfileHandler);
   authRoutes.post("/me/password", authenticate, changePasswordHandler);
   ```
   ```ts
   // session.route.ts
   const sessionRoutes = Router();
   sessionRoutes.use(authenticate); // Phase 06: protectedApiLimiter
   sessionRoutes.get("/", getSessionHandler);
   sessionRoutes.delete("/:id", deleteSessionHandler);
   export default sessionRoutes;
   ```
   `app.ts`: `app.use("/session", sessionRoutes);` after `/auth`.

9. **The one-door check**, now and in every later phase:
   ```bash
   grep -rn "session.delete" apps/api/src | grep -v revokeSessions
   ```
   This must print only the two lines inside `revokeSessions` itself.

10. Commit: `feat(api): authenticate, device sessions, Google sign-in, password reset`.

## 7. Verify

```bash
J=/tmp/pl.jar; L=/tmp/laptop.jar; rm -f $J $L
login() { curl -s -c $1 -X POST localhost:5000/auth/login -H 'content-type: application/json' \
  -H "user-agent: $2" -d '{"email":"me@example.com","password":"correct-horse-1"}' >/dev/null; }
login $J phone; login $L laptop

curl -s -b $J localhost:5000/auth/me | jq '.data.user | {email, verified, password}'
# { "email": "me@example.com", "verified": true, "password": null }   ← key absent: toSafeUser

curl -s -b $J localhost:5000/session | jq '.data[] | {userAgent, isCurrent}'
# { "userAgent": "phone",  "isCurrent": true }
# { "userAgent": "laptop", "isCurrent": false }

LAPTOP=$(curl -s -b $J localhost:5000/session | jq -r '.data[] | select(.userAgent=="laptop") | .id')
curl -s -b $J -X DELETE localhost:5000/session/$LAPTOP | jq .data
# { "message": "Session expired!" }
curl -s -b $L localhost:5000/auth/me | jq '.errors[0].message'
# "Session expired"                       ← the laptop's still-valid access token is dead immediately

curl -s -b $J -X DELETE localhost:5000/session/not-a-uuid | jq '.errors[0].message'
# "Invalid session id"                    (400, not a database error)

# Bearer header (what the CLI will use):
TOKEN=$(grep accessToken $J | awk '{print $7}')
curl -s -H "Authorization: Bearer $TOKEN" localhost:5000/auth/me | jq -r .data.user.email
# me@example.com

# Forgot / reset
curl -s -X POST localhost:5000/auth/password/forgot -H 'content-type: application/json' -d '{"email":"nobody@x.co"}' | jq -r .data.message
curl -s -X POST localhost:5000/auth/password/forgot -H 'content-type: application/json' -d '{"email":"me@example.com"}' | jq -r .data.message
# both: "If an account with that email exists, a password reset link has been sent. …"
# dev terminal (second call only): DEBUG dev reset link … /password/reset/<64 hex>

curl -s -X POST localhost:5000/auth/password/reset -H 'content-type: application/json' \
  -d '{"token":"<64 hex>","password":"new-horse-22","confirmPassword":"new-horse-22"}' | jq .data
# "Password reset successful"
# dev terminal access log: … "path":"/auth/password/reset" …   ← no token in the log
curl -s -b $J localhost:5000/auth/me | jq '.errors[0].message'
# "Session expired"                       ← reset revoked every session

# Google: sign in from the web app once Phase 09 exists; for now, an invalid token:
curl -s -X POST localhost:5000/auth/google -H 'content-type: application/json' -d '{"idToken":"x"}' | jq '.errors[0].message'
# "Invalid Google ID token"

for f in middleware/requireAdmin.ts controllers/session.controller.ts; do
  diff -q ~/Code/paper-trail/apps/api/src/$f apps/api/src/$f; done
# (no output)
grep -rn "session.delete" apps/api/src | grep -v revokeSessions
# (only the lines inside revokeSessions)
```

## 8. Definition of done

- [ ] `authenticate` rejects a valid token whose session was revoked, on the very next request.
- [ ] Both cookie and `Bearer` access tokens work (the CLI path).
- [ ] `/session` lists devices with `isCurrent`, and revoking one kills its access token immediately.
- [ ] `/auth/me` never returns the password hash.
- [ ] Forgot password answers identically for known and unknown emails.
- [ ] Reset is single use, revokes all sessions, and the token never appears in the access log.
- [ ] Google sign-in verifies the ID token against `GOOGLE_CLIENT_ID` and applies the takeover rule.
- [ ] `grep` shows sessions are deleted only inside `revokeSessions`.
- [ ] `requireAdmin.ts` and `session.controller.ts` are identical to PaperTrail's. Committed;
      `tracker.md` updated.

## 9. Interview angle

*"How fast does 'sign out that device' take effect?"* On that device's very next request. The access
token is still cryptographically valid for up to 15 minutes, but `authenticate` checks that its session
row exists after verifying the signature. Revocation deletes the row through one function, which from
Phase 07 also clears the 60-second Redis cache of that check. The cache makes the common path cheap
without delaying a revocation.

*"Why read the role from the database if it's in the token?"* The token is a snapshot from up to 15
minutes ago. For a platform admin, or a labeller I just removed from my workspace, "15 more minutes of
access after demotion" is the bug. Role checks are rare and indexed, so they read live.

*"Anything you changed from the code you copied?"* The reset token moved from the URL path into the
POST body. My request logger prints paths, so the copied route would have written a live,
account-taking credential into the logs on every reset. Copying code means rechecking its assumptions
in the new context.
