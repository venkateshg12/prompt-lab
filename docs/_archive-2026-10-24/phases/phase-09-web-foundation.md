# Phase 09 — Next.js web foundation

## 1. Goal

Create `apps/web` by copying PaperTrail's web foundation, which is e-commerce's client already ported
to the Next.js App Router:
- the axios client with the **single-flight 401 refresh queue** and the server-wake notice;
- TanStack Query with the server/browser client split;
- the Zustand auth and server stores;
- shadcn primitives, `AuthLoader`, `RequireAuth` / `GuestOnly` guards, and the auth screens.

Remove the org parts, add TanStack Table (Phase 20 needs it), and rebrand.

## 2. What I will understand after this phase

1. The refresh queue (redraw it from memory).
2. Why guards are client layouts, not Next middleware (the cookies belong to the API's domain).
3. Why `NEXT_PUBLIC_*` must be read literally.
4. Why every user-scoped query key is listed in `clearUserQueries`.

## 3. Prerequisites

Phases 04–08 done; API on `:5000` with `CORS_ORIGIN=http://localhost:3000`.

## 4. Files

```
apps/web/
├── package.json · next.config.ts · tsconfig.json · eslint.config.mjs · components.json   ADAPT / COPY  @pt-web/
├── .env.example                                         NEW
└── src/
    ├── app/layout.tsx · providers.tsx · globals.css     ADAPT / COPY  @pt-web/src/app/   (metadata, splash text)
    ├── app/page.tsx                                     NEW    (landing: published results + "Sign in")
    ├── app/(public)/**                                  ADAPT  @pt-web/src/app/(public)/  (branding)
    ├── app/(app)/layout.tsx                             ADAPT  @pt-web/src/app/(app)/layout.tsx   (no OrgSwitcher; nav: Tasks, Runs, Models)
    ├── app/(app)/account/page.tsx                       ADAPT  @pt-web/src/app/(app)/account/page.tsx
    ├── lib/api.ts                                       ADAPT  @pt-web/src/lib/api.ts         (remove X-Org-Id + org store)
    ├── lib/queryClient.ts                               ADAPT  @pt-web/src/lib/queryClient.ts (USER_SCOPED_KEYS)
    ├── lib/{serverStatus,utils}.ts · lib/google/*       COPY   @pt-web/src/lib/
    ├── store/{auth,server}.store.ts                     COPY   @pt-web/src/store/
    ├── types/{api,auth,ui,user}.types.ts                COPY   @pt-web/src/types/
    ├── types/index.ts                                   ADAPT  (barrel)
    ├── utils/appError.ts · constants/env.ts             COPY   @pt-web/src/
    ├── components/ui/*                                  COPY   @pt-web/src/components/ui/
    ├── components/common/*                              ADAPT  @pt-web/src/components/common/  (ServerWakeNotice text)
    ├── components/auth/*                                ADAPT  @pt-web/src/components/auth/    (AuthLoader branding; default redirect "/tasks")
    ├── components/layout/RoleGuard.tsx                  COPY   @pt-web/src/components/layout/RoleGuard.tsx
    ├── api/{auth,session}.ts                            COPY   @pt-web/src/api/
    └── hooks/auth/*                                     COPY   @pt-web/src/hooks/auth/
```

## 5. Concepts

All of it is in PaperTrail's Phase 09 doc. Re-read §5 (what changes between Vite and Next, why
client guards, literal env access, the query client split, the refresh queue) before copying.

**Prompt Lab's user-scoped keys.** Everything under a signed-in owner:

```ts
const USER_SCOPED_KEYS = ["sessions", "tasks", "task", "examples", "prompts", "models", "runs", "run", "results", "result"];
```

Published pages use the key `["published", slug]`, which is not user-scoped, so it survives logout.
That's correct, since they're public.

## 6. Steps

```bash
cd ~/Code/prompt-lab/apps
rsync -a --exclude node_modules --exclude .next --exclude tsconfig.tsbuildinfo \
  --exclude 'src/app/(app)/inbox' --exclude 'src/app/(app)/documents' --exclude 'src/app/(app)/settings' \
  --exclude 'src/app/invites' --exclude 'src/components/documents' --exclude 'src/components/review' \
  --exclude 'src/hooks/documents' --exclude 'src/hooks/review' --exclude 'src/hooks/org' \
  --exclude 'src/api/document.ts' --exclude 'src/api/upload.ts' --exclude 'src/api/org.ts' \
  --exclude 'src/api/apiKey.ts' --exclude 'src/api/webhook.ts' --exclude 'src/lib/uploadToBucket.ts' \
  --exclude 'src/lib/documentStatus.ts' --exclude 'src/store/org.store.ts' --exclude 'src/components/layout/OrgSwitcher.tsx' \
  --exclude 'sentry.*' --exclude 'src/instrumentation.ts' --exclude Dockerfile \
  ~/Code/paper-trail/apps/web/ web/
cd web && pnpm add @tanstack/react-table && pnpm install
```

Then:
1. `package.json`: `"name": "web"`. Remove `@sentry/nextjs`, `react-pdf` and anything else that only
   PaperTrail's removed pages imported (`pnpm exec depcheck`).
2. `lib/api.ts`: delete the `useOrgStore` import and the `X-Org-Id` block. The `Idempotency-Key` block
   can go too: Prompt Lab's run creation is guarded server-side instead (Phase 16).
3. `lib/queryClient.ts`: the `USER_SCOPED_KEYS` above.
4. `(app)/layout.tsx`: remove `OrgSwitcher`; the nav links are **Tasks**, **Runs**, **Models**,
   **Account**.
5. Branding: "PaperTrail" → "Prompt Lab" in the metadata, `AuthLoader`, `ServerWakeNotice` and the auth
   screens. Post-login default route: `/tasks` (the `GuestOnly` default and the auth hooks' targets).
6. `app/page.tsx` (public): a hero ("Compare prompts and models with real scores"), a list of
   published runs (Phase 21 fills it), and Sign in / Try with your own key (Phase 22) buttons.
7. `.env.example`: `NEXT_PUBLIC_API_URL=http://localhost:5000`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID=`.

## 7. Verify

PaperTrail's Phase 09 checks:
1. `/tasks` signed out → `/login?from=%2Ftasks`.
2. Register → verify → land on `/tasks` (a placeholder for now).
3. Delete the `accessToken` cookie → the next request refreshes silently, **once**.
4. Delete both cookies → back to login, and the user-scoped queries are removed.
5. Stop the API → the wake notice; start it → it recovers without a reload.
6. An open redirect (`?from=https://evil.example`) is ignored.
7. `pnpm --filter web build lint typecheck` pass.

`diff -q` the COPY files against `@pt-web/`.

## 8. Definition of done

- [ ] The auth flows work on Next.js; no org code remains (`grep -ri org src/` only matches words like
      "organic" or "origin").
- [ ] Commit: `feat(web): Next.js foundation (from PaperTrail)`.

## 9. Interview angle

*"How does your client handle expired tokens?"* A single-flight refresh with a waiting queue, a
separate client for the refresh call, auth routes exempt, and every user-scoped cache entry dropped
when a session ends. The same code has run in two other apps.
