# Phase 05 — authenticate, device sessions, Google sign-in

## 1. Goal

Copy route protection and the remaining auth endpoints:
- `authenticate`: signature + live session, cached 60 s, fails closed;
- `requireAdmin`: the live platform role, used for the platform-admin views in Phase 16/27;
- device sessions: list and revoke;
- Google sign-in, with its takeover rule.

Then mount `/auth/me*` and `/session`.

## 2. What I will understand after this phase

1. Why a valid JWT isn't enough (a live session check).
2. Why the session check is cached and fails closed.
3. The Google "unverified local account" takeover rule.

## 3. Prerequisites

Phase 04 done. A Google OAuth **Web** client id (or reuse PaperTrail's and add the new origins).

## 4. Files

```
apps/api/src/
├── middleware/{authenticate,requireAdmin}.ts       COPY   @pt-api/src/middleware/
├── controllers/session.controller.ts               COPY   @pt-api/src/controllers/session.controller.ts
├── controllers/googleAuth.controller.ts            ADAPT  @pt-api/src/controllers/googleAuth.controller.ts  (remove ensurePersonalOrg)
├── routes/session.route.ts                         COPY   @pt-api/src/routes/session.route.ts
├── routes/auth.route.ts                            ADAPT  (+ /google, /me, PATCH /me, /me/password)
└── constants/env.ts                                ADAPT  (+ GOOGLE_CLIENT_ID)
```

```bash
pnpm --filter api add google-auth-library
```

## 5. Concepts

See PaperTrail's Phase 05 doc. In short:
- signature first (cheap), then the session document, cached in Redis for 60 s;
- every revocation goes through `revokeSessions`, which deletes the cache key;
- with Redis down, every request reads Mongo: slower, never less secure.

Google sign-in drops an unverified squatter's password when the real owner proves the address.

## 6. Steps

```bash
cd ~/Code/prompt-lab/apps/api/src; PT=~/Code/paper-trail/apps/api/src
cp $PT/middleware/{authenticate,requireAdmin}.ts middleware/
cp $PT/controllers/{session,googleAuth}.controller.ts controllers/
cp $PT/routes/session.route.ts routes/
```

- `googleAuth.controller.ts`: delete the `ensurePersonalOrg` import and its call. Re-tag the file
  ADAPT in the copy map. It's now identical to e-commerce's original.
- `session.route.ts` imports `protectedApiLimiter`: add a temporary `config/rateLimiter.ts` stub that
  exports a pass-through (PaperTrail's Phase 05 §6.1). Phase 06 replaces it.
- `auth.route.ts`: add `/google` and the `/me` routes with `authenticate`.
- `app.ts`: `app.use("/session", sessionRoutes)`.
- Make yourself platform admin once:
  `docker exec promptlab-mongo mongosh promptlab --eval 'db.users.updateOne({email:"you@example.com"},{$set:{role:"admin"}})'`.

## 7. Verify

PaperTrail's Phase 05 Verify list:
- `/auth/me` is 200 with the cookie and 401 without it;
- revoking the other device locks it out immediately;
- `DELETE /session/not-an-id` is 400;
- a bad Google token is 401.

`diff -q` the COPY files.

## 8. Definition of done

- [ ] Protected routes work; revocation is immediate.
- [ ] Google sign-in works from the web (checked again in Phase 09).
- [ ] Commit: `feat(api): authenticate, sessions, Google sign-in`.

## 9. Interview angle

*"JWTs are stateless, so why look up a session?"* Because otherwise logout doesn't log out. Cached for
60 s, fail-closed, and every revocation path goes through one function.
