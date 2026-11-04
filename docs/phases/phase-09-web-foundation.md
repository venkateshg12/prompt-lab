# Phase 09 — Next.js web foundation

## 1. Goal

Copy PaperTrail's web app foundation (`@pt-web`), which is e-commerce's client architecture ported to
the Next.js App Router:
- the axios instance with the **single-flight silent refresh** queue and error normalisation;
- the server-wake notice for a sleeping free-tier backend;
- the TanStack Query client (one per server render, one per tab) with `clearUserQueries`;
- the Zustand auth and server stores;
- `AuthLoader`, `RequireAuth`, `GuestOnly` (with the open-redirect guard), `RoleGuard`;
- the shadcn primitives;
- the public auth screens (login, register, verify, forgot, reset) and Google sign-in;
- the account page with **device sessions** (list and revoke).

Install **TanStack Table** now (the results table, test-set table and error browser all use it from
Phase 19 on), and **Recharts** (Phase 26's charts).

No Prompt Lab screens yet. After login the app lands on an empty `/tasks` shell. The workspace
switcher and the `X-Org-Id` header arrive with workspaces in Phase 10.

## 2. What I will understand after this phase

1. How the refresh queue turns many concurrent 401s into **one** `/auth/refresh` call, then replays them.
2. Why auth is guarded on the client, not in a Next.js `proxy` (formerly `middleware`): the cookies
   belong to the API's domain.
3. Why `NEXT_PUBLIC_*` must be written as a literal `process.env.NEXT_PUBLIC_X`.
4. Why there's one query client per server render and one per browser tab.
5. Why `clearUserQueries` runs on every way a session can end.
6. Next.js 15 vs 16 for this codebase, and TanStack Table 8 vs 9.

## 3. Prerequisites

- Phases 04–08 done: register, verify, login, refresh, logout, `/auth/me`, Google sign-in, `/session`,
  and the dev mailbox route (`/auth/dev/latest-link`).
- API `CORS_ORIGIN` includes `http://localhost:3000` with credentials (Phase 01).
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`: the same Google client as the API's `GOOGLE_CLIENT_ID`, with
  `http://localhost:3000` as an authorised JavaScript origin.

## 4. Files

```
apps/web/
├── package.json                    ADAPT  @pt-web/package.json   (name "web"; next ^16; drop @sentry/nextjs, @tanstack/react-virtual; + @tanstack/react-table)
├── next.config.ts                  ADAPT  @pt-web/next.config.ts (transpilePackages only; Sentry is Phase 29)
├── tsconfig.json                   COPY   @pt-web/tsconfig.json
├── postcss.config.mjs              COPY   @pt-web/postcss.config.mjs
├── components.json                 COPY   @pt-web/components.json
├── eslint.config.mjs               COPY   @pt-web/eslint.config.mjs
├── .env.example                    NEW    NEXT_PUBLIC_API_URL, NEXT_PUBLIC_GOOGLE_CLIENT_ID
└── src/
    ├── constants/env.ts            COPY   @pt-web/src/constants/env.ts
    ├── utils/appError.ts           COPY   @pt-web/src/utils/appError.ts
    ├── types/{index,api.types,auth.types,user.types,ui.types}.ts   COPY  @pt-web/src/types/
    ├── lib/
    │   ├── api.ts                  ADAPT  @pt-web/src/lib/api.ts          (no org header yet; no Idempotency-Key)
    │   ├── queryClient.ts          ADAPT  @pt-web/src/lib/queryClient.ts  (USER_SCOPED_KEYS)
    │   ├── serverStatus.ts         COPY   @pt-web/src/lib/serverStatus.ts
    │   ├── errorMessage.ts         COPY   @pt-web/src/lib/errorMessage.ts
    │   ├── utils.ts                COPY   @pt-web/src/lib/utils.ts        (cn)
    │   └── google/                 COPY   @pt-web/src/lib/google/
    ├── store/{auth.store,server.store}.ts    COPY  @pt-web/src/store/
    ├── api/{auth,session}.ts       COPY   @pt-web/src/api/
    ├── hooks/auth/*.ts             COPY   @pt-web/src/hooks/auth/   (useLogin, useLogout, useRegister, useGetProfile, useGoogleLogin, useForgotPassword, useResetPassword)
    ├── hooks/account/useAccountSessions.ts   COPY  @pt-web/src/hooks/account/useAccountSessions.ts
    ├── components/
    │   ├── ui/*                    COPY   @pt-web/src/components/ui/   (all primitives)
    │   ├── common/{QueryDevtools,RouteFallback,ServerWakeNotice}.tsx  COPY  @pt-web/src/components/common/
    │   ├── auth/{AuthLoader,RequireAuth,GuestOnly,GoogleSignInButton}.tsx  COPY / ADAPT (AuthLoader: product name)
    │   └── layout/RoleGuard.tsx    COPY   @pt-web/src/components/layout/RoleGuard.tsx
    └── app/
        ├── layout.tsx              ADAPT  @pt-web/src/app/layout.tsx      (title, description)
        ├── providers.tsx           COPY   @pt-web/src/app/providers.tsx
        ├── globals.css             COPY   @pt-web/src/app/globals.css
        ├── page.tsx                ADAPT  @pt-web/src/app/page.tsx        (a public landing page, Step 7)
        ├── (public)/layout.tsx     COPY   @pt-web/src/app/(public)/layout.tsx
        ├── (public)/{login,register,password/forgot}/page.tsx      COPY / ADAPT (product name)
        ├── (public)/auth/verify/[token]/page.tsx                   COPY
        ├── (public)/password/reset/[token]/page.tsx                COPY   (or as Phase 05's reset link says; see Step 3)
        ├── (app)/layout.tsx        ADAPT  @pt-web/src/app/(app)/layout.tsx  (nav: Tasks, Runs, Published, Account; no OrgSwitcher yet)
        ├── (app)/tasks/page.tsx    NEW    (empty state; Phase 19)
        └── (app)/account/page.tsx  COPY   @pt-web/src/app/(app)/account/page.tsx   (profile + device sessions)
```

Not copied: documents, review, DLQ, quality, webhooks, API keys, upload, `org.store.ts` and
`OrgSwitcher` (Phase 10), `UsageMeter`, the SSE hooks (Phase 17 writes its own per-run hook).

## 5. Concepts

**Next.js 15 or 16.** PaperTrail runs Next 15; npm's current major is 16. The Next 16 upgrade guide
lists these breaking changes: `params`/`searchParams` are async only, `middleware` is renamed `proxy`,
`next lint` is removed, Turbopack is the default for `next build`, Node ≥ 20.9 and TypeScript ≥ 5.1
are required. Against the files this phase copies:
- the dynamic pages read params through `useParams()` or `use(params)` (already the async form);
- there's no `middleware.ts` (auth is guarded on the client);
- the lint script is `eslint .`, not `next lint`;
- there's no custom webpack config; the only config wrapper was Sentry's (Phase 29).

So **use Next 16**, the same decision and check as the Enquiry plan's Phase 09. If `next build` fails on
something this missed, pin `next@^15` (PaperTrail's) and record why in `tasks/lessons.md`. Don't patch
around it.

**TanStack Table 8 or 9.** npm's current major is 9 (9.3.x), and nothing copied from PaperTrail uses the
table library, so there's no COPY reason to stay on 8. Version 9 changes the core API (checked on
Context7, `/tanstack/table`):
- `useReactTable` → `useTable`;
- a required `features` option built with `tableFeatures({...})`;
- row models are feature slots (`sortedRowModel: createSortedRowModel()`), and `getCoreRowModel` is
  gone (automatic);
- `sortingFns` → `sortFns`;
- `<table.FlexRender />` instead of calling `flexRender(...)`.

Use **9**, and write every table in Phases 19–21 against the v9 API. Most blog posts and Stack Overflow
answers show v8: translate them, don't mix. Keep each `features` object at module scope so its
reference is stable across renders.

**Why the guards are client-side.** The access and refresh cookies are httpOnly cookies on the **API's**
domain (Render), not the web's (Vercel). A Next.js `proxy` or Server Component on Vercel never sees
them, so it can't know who's signed in. The browser can, by calling `/auth/me` with `withCredentials`.
`AuthLoader` does that once on boot and fills the auth store. `RequireAuth` shows `RouteFallback` until
then, and redirects guests to `/login?from=<path>`. `GuestOnly` sends signed-in users away from the auth
pages. Its `sanitizeRedirectUrl` accepts only a path starting with `/` and not `//`, so
`?from=//evil.example` can't turn login into an open redirect. The API authorises every request
anyway; the guards only decide what to render.

**Single-flight refresh.** The access token lives 15 minutes. When it expires, every in-flight request
gets a 401 at once. The interceptor lets the **first** one call `/auth/refresh` on a separate axios
instance (so the refresh can't recurse into the interceptor). Every other 401 waits in `failedQueue` and
is replayed once the refresh succeeds. If refresh fails, the queue is rejected, the auth store cleared
and the user-scoped queries removed. Requests **to** auth routes (`AUTH_ROUTES`) never trigger a refresh,
so a wrong password can't loop. `_retry` marks a replayed request so it can't refresh twice. The client
uses the refresh/logout verbs Phase 04 kept from PaperTrail; check them before copying.

**Error normalisation.** Every rejection is `{ status, message, code?, errors? }` read from the envelope,
or `{ status: 0, message: "Network error…" }`. Components read `error.message`, never `AxiosError`.

**The sleeping server.** On Render's free tier the API sleeps and takes up to a minute to wake. The
axios timeout is 60 s. A request still pending after 3 s raises the `ServerWakeNotice`, unless the
server answered in the last 2 minutes. The query client retries only "server unavailable" errors, for
about 2 minutes, never a 4xx. A slow first load then reads as "starting up", not "broken". That matters
for a portfolio link opened by a recruiter.

**Two query clients.** `getQueryClient()` makes a new client per **server** render (two visitors' caches
can't mix during SSR) and one for the life of the browser tab.

**`clearUserQueries`.** Logout, a failed refresh and a profile that no longer resolves all call it. It
removes every query whose key starts with one of `USER_SCOPED_KEYS`:

```ts
const USER_SCOPED_KEYS = [
    "sessions", "profile",
    "org", "members", "invites",                           // Phase 10
    "tasks", "task", "examples", "agreement", "prompts",   // Phases 11–13, 19
    "runs", "run", "run-summary", "results", "compare",    // Phases 17–21
    "published-admin",                                     // Phase 22 (the owner's publish settings)
];
```

The model registry (`models`) and public pages (`public-run`) are deliberately **not** listed: they're
the same for everyone. Listing future keys now is deliberate: removing a key nobody uses yet is a no-op,
while a key added later but forgotten here would leak one person's labels or runs to the next person on
a shared lab computer.

**Literal `NEXT_PUBLIC_*`.** Next inlines `process.env.NEXT_PUBLIC_API_URL` by replacing that exact
text at build time. `process.env[name]` is never replaced, and in the browser it's `undefined`.
`constants/env.ts` passes the literal expression into `required()`, which throws at import, so a build
missing the variable fails loudly instead of calling `undefined/auth/me`.

## 6. Steps

1. **Scaffold** `apps/web` by copying the config files listed above, then:
   ```bash
   pnpm --filter web add next@^16 react@^19 react-dom@^19 @tanstack/react-query@^5 @tanstack/react-query-devtools@^5 \
     @tanstack/react-table@^9 axios zustand@^5 radix-ui class-variance-authority clsx tailwind-merge tw-animate-css \
     lucide-react recharts
   pnpm --filter web add -D tailwindcss@^4 @tailwindcss/postcss@^4 postcss typescript@5.9.2 @types/react @types/react-dom @types/node \
     @repo/typescript-config@workspace:* @repo/eslint-config@workspace:*
   pnpm --filter web add @repo/types@workspace:*
   ```
   `typescript@5.9.2` matches the root pin (a bare `pnpm add -D typescript` installs 7). Scripts as
   PaperTrail's: `"dev": "next dev -p 3000"`, `"build": "next build"`, `"start": "next start"`,
   `"lint": "eslint . --max-warnings 0"`, `"typecheck": "tsc --noEmit --incremental false"`.
2. `next.config.ts`:
   ```ts
   import type { NextConfig } from "next";

   // As PaperTrail: Next bundles @repo/types (its built CommonJS dist/) for the browser.
   // The Sentry wrapper is Phase 29.
   const nextConfig: NextConfig = {
     transpilePackages: ["@repo/types"],
   };

   export default nextConfig;
   ```
3. **Copy** the COPY files, then `diff -rq` the folders (`components/ui`, `hooks/auth`, `store`, `types`,
   `lib/google`) against `@pt-web/src/...`. If Phase 05 changed the password-reset link (for example,
   token in a URL fragment instead of the path), ADAPT the reset page to read the token the same way.
   The email link (Phase 08) and this page must agree.
4. **`lib/api.ts`** (ADAPT). From PaperTrail's request interceptor, remove:
   ```ts
   // removed until Phase 10 (workspaces):
   //   const orgId = useOrgStore.getState().selectedOrgId;
   //   if (orgId) config.headers["X-Org-Id"] = orgId;
   // Phase 10: restore the X-Org-Id header with org.store.ts.

   // removed for good: this API has no idempotency-key middleware (inherited-architecture.md,
   // "Deliberately not copied"); an unknown header would also have to be allowed in CORS.
   //   if (!config.headers["Idempotency-Key"]) config.headers["Idempotency-Key"] = crypto.randomUUID();
   ```
   and the `useOrgStore` import. Everything else is PaperTrail's: the wake timers, `AUTH_ROUTES`, the
   refresh queue, `clearAuth()` + `clearUserQueries()` on refresh failure, error normalisation.
5. **`lib/queryClient.ts`** (ADAPT): only `USER_SCOPED_KEYS`, as in §5.
6. **Product name.** `AuthLoader`'s splash ("Welcome to **Prompt Lab**", "Prompts, measured"),
   `layout.tsx` metadata (`title: "Prompt Lab"`, `description: "Compare prompts and models on a
   hand-labelled test set, with real scores"`), the auth pages' headings. Classes stay inline in
   `className`.
7. **`app/page.tsx`**: PaperTrail redirects `/` to the app or `/login`. Here `/` is a short public
   landing page, the first thing a recruiter sees:
   - one line: "Which prompt, on which model, gives the best results, and at what cost and speed?";
   - three bullets: a hand-labelled test set; every output scored by code, never by eye; results you
     can open down to the single wrong field;
   - **See published results** (links to `/r`, which 404s until Phase 22), **Try it with your own key**
     (`/demo`, Phase 23), **Sign in**.

   A signed-in user is redirected to `/tasks` in an effect, the way PaperTrail's page does it.
8. **`(app)/layout.tsx`** (ADAPT): `RequireAuth` around a header with the product name, nav links
   **Tasks** (`/tasks`), **Runs** (`/runs`), **Published** (`/settings/published`), **Account**, and
   the logout button (`useLogout`). Leave `{/* Phase 10: <OrgSwitcher /> */}` where PaperTrail has its
   switcher. Links to pages that don't exist yet 404 until their phase.
9. **`(app)/tasks/page.tsx`**: a heading and an empty state: "No tasks yet. A task is the instructions
   plus the fields you want back, each with a scoring rule." Phase 19 replaces it.
10. **`(app)/account/page.tsx`**: COPY. It lists `GET /session` and revokes with
    `DELETE /session/:id` via `useAccountSessions`. Revoking the current session behaves like logout.
11. `.env.example` (and `.env.local`):
    ```
    NEXT_PUBLIC_API_URL=http://localhost:5000
    NEXT_PUBLIC_GOOGLE_CLIENT_ID=
    ```
12. Confirm `pnpm dev` at the root now starts the API and the web together (Phase 00's `turbo.json`).

## 7. Verify

```bash
docker compose up -d && pnpm dev            # api :5000 (+ workers), web :3000
```

In the browser:
1. `http://localhost:3000/` shows the landing page; **Sign in** → **Create account** → register →
   "check your email".
2. `curl -s "localhost:5000/auth/dev/latest-link?email=<you>" | jq -r .email.link`, open it → "Email
   verified".
3. Log in → `/tasks` with the empty state. `/account` lists this session as "this device".
4. **Guards**: log out, open `/account` → `/login?from=%2Faccount`; log in → back on `/account`. Open
   `/login?from=//evil.example` while signed in → you land on `/tasks`, not the other site.
5. **Silent refresh**: in DevTools → Application, delete the `accessToken` cookie for `localhost:5000`
   (keep `refreshToken`) and reload `/account`. Network: one `/auth/me` 401, **one** `/auth/refresh`
   200, then the replayed `/auth/me` 200. You stay signed in.
6. **Concurrent 401s**: with the access cookie deleted, open `/account` (it fires `/auth/me` and
   `/session` together). Still exactly one `/auth/refresh`.
7. **Refresh failure**: delete both cookies, click anything → `/login`; Query Devtools show no
   `sessions`/`profile` data left.
8. **Revoke**: sign in in a second browser, revoke it from `/account` in the first. The second's next
   click → `/login` (the API rejects the session at once, Phase 07).
9. **Wake notice**: stop the API, reload → after ~3 s "Server is waking up…"; start the API → "Server
   is ready", and the page loads without a manual reload.
10. **Google**: with `NEXT_PUBLIC_GOOGLE_CLIENT_ID` set, the Google button signs in.

```bash
pnpm --filter web build        # Next 16 (Turbopack) succeeds; routes: / /login /register … /tasks /account
pnpm --filter web lint && pnpm --filter web typecheck
grep -rn "process.env\[" apps/web/src && echo "dynamic env access found" || echo "ok: literal env only"
diff -rq ~/Code/paper-trail/apps/web/src/components/ui apps/web/src/components/ui     # nothing
pnpm --filter web list @tanstack/react-table                                           # 9.x
```

## 8. Definition of done

- [ ] Register → verify → login → `/tasks` works end to end in the browser.
- [ ] One `/auth/refresh` per expiry however many requests 401 together; failed refresh → `/login`
      with user-scoped queries cleared.
- [ ] `GuestOnly` rejects `//host` redirects.
- [ ] `/account` lists and revokes device sessions.
- [ ] The wake notice appears and clears on its own.
- [ ] `next build` passes on Next 16 (or Next 15 is pinned with the reason in `tasks/lessons.md`).
- [ ] `@tanstack/react-table` 9 and `recharts` are installed; the v9 API note is in `tasks/lessons.md`
      for Phases 19–21.
- [ ] No `X-Org-Id` or `Idempotency-Key` header is sent yet; `// Phase 10:` marks where the org header goes.
- [ ] COPY files are identical to `@pt-web`.
- [ ] Commit: `feat(web): Next.js foundation with silent refresh, guards and device sessions`.

## 9. Interview angle

*"Your access token expires while the results page fires five requests. What happens?"* The first 401
starts one refresh on a separate axios instance. The other four wait in a queue and replay when it
succeeds, so the user sees nothing. If the refresh fails, the queue is rejected, the auth store and every
user-scoped query are cleared, and the user lands on login. Auth routes are exempt, so a wrong password
can't trigger a refresh loop.

*"Why aren't routes protected in Next.js middleware?"* The session cookies belong to the API's domain,
so a proxy on the web's domain can't see them. The client asks the API who it is, and the API authorises
every request anyway. The client guard is UX; the API is the security boundary.

*"You picked the newest TanStack Table. Isn't that risky?"* Nothing I copied depends on the old API, so
there was no reason to start a new app on a superseded major. The risk is that most examples online are
v8. I wrote the v9 differences down once (features object, `useTable`, `FlexRender`) and every table
follows them.
