# Phase 23 — Public demo: bring your own key

## 1. Goal

Let a visitor try Prompt Lab live **without spending your money and without you ever holding their
key** (spec §4: "let visitors run with their own key, kept in the browser, never stored, or a tiny
rate-limited sample"):

- The demo runs against a **published run** (Phase 22): its frozen prompt versions, its models, and
  up to **10 dev examples** with public inputs. Visitors can't send arbitrary text through your
  server.
- The visitor pastes **their own** provider key. It stays in browser memory (opt-in `sessionStorage`
  for the tab), goes to the API in an `X-Provider-Key` header, is used for the calls of that one
  request, and is dropped.
- Runs are **tiny and synchronous**: 1 prompt × 1 model × ≤ 10 examples × 1 repeat, 2 calls at a time,
  one 60 s budget, scored by the same `@repo/scoring` as real runs.
- **Nothing is stored**: no run, no result, no job, no cache entry, no log line with the key. A
  signed-in workspace member who wants to keep a result starts a normal run (Phase 20) instead.

## 2. What I will understand after this phase

1. Why a visitor key can't go through BullMQ, and how that shapes the design.
2. Every place a key could leak, and what closes each one.
3. Why the owner's server keys are never a fallback, and how a test proves it.
4. Why the demo only runs published prompts on published examples (not an open proxy).
5. How limits are sized when the visitor pays for the model and you pay for the server.

## 3. Prerequisites

- Phase 22 done; at least one published run of the job-postings task.
- Phase 14's `complete(model, price, request, { apiKey?, signal? })`: an explicit `apiKey` overrides the env key, and
  the provider is chosen from the model's `provider`.
- Phase 17's pure cell core: `executeCell(cell, deps)` = render → `complete` → `@repo/scoring`, with **no
  database writes** (the worker persists its return value; the demo just returns it).
- Phase 06's limiters, `demoDailyCapLimiter` and `demoDualLimiter` (add them here if Phase 06
  didn't), and the copied `visitorId` middleware.
- Phase 02's redaction paths include `x-provider-key`, `providerKey`, `apiKey`.
- Reference implementation, **built and tested**: the Playbook's Try-it. Its files are
  `@pb-root/apps/api/src/middleware/providerKey.ts`, `routes/tryIt.route.ts`,
  `controllers/tryIt.controller.ts`, `services/tryIt.service.ts`, `config/rateLimiter.ts`
  (`tryItIpLimiter`, `tryItVisitorLimiter`), and `@pb-root/apps/site/src/components/islands/TryIt.tsx`.
  Read its `tasks/lessons.md`: a rejected key is **401** (not 400); served NVIDIA models answer a bad
  key with **403**; a retired model answers **410**.

## 4. Files

```
packages/types/src/demo.ts                       NEW    (demoRunRequestSchema, demoRunResultSchema)
apps/api/src/
├── middleware/providerKey.ts                    ADAPT  @pb-root/apps/api/src/middleware/providerKey.ts (one shape per provider)
├── utils/scrubKeys.ts                           NEW
├── services/demo.service.ts                     ADAPT  @pb-root/apps/api/src/services/tryIt.service.ts (published run + executeCell + scoring; no usage table)
├── controllers/demo.controller.ts               ADAPT  @pb-root/apps/api/src/controllers/tryIt.controller.ts
├── routes/demo.route.ts                         ADAPT  @pb-root/apps/api/src/routes/tryIt.route.ts
├── config/rateLimiter.ts                        ADAPT  (+ demoDailyCapLimiter, demoDualLimiter if missing)
├── constants/{appErrorCode,env}.ts              ADAPT  (+ DemoKeyInvalid, DemoKeyMissing, DemoDailyCap; DEMO_DAILY_CAP default 300)
└── app.ts                                       ADAPT  (mount /demo with express.json({ limit: "16kb" }))
apps/web/src/
├── app/demo/page.tsx                            NEW    (public, outside the (app) group)
├── lib/providerKey.ts                           ADAPT  (the sessionStorage helpers from @pb-root/apps/site/src/components/islands/TryIt.tsx)
└── components/demo/{KeyInput,DemoRunForm,DemoResults}.tsx   NEW   (DemoResults reuses ResultsTable/ResultCard read-only)
```

## 5. Concepts

A demo cell uses the published run's `promptSnapshots` (system, few-shot, `maxTokens` from
`MAX_TOKENS_BY_TECHNIQUE`), so the visitor runs exactly what the published numbers came from.


**No queue for keys.** A BullMQ job's data lives in Redis and is visible in Bull Board, so a key in a
payload *is* a stored key. Demo runs execute **inside the request**. That's acceptable only because
the grid is tiny: ≤ 10 calls, 2 at a time, aborted at 60 s. The same `executeCell` the worker uses does
the work, so demo numbers are scored exactly like real ones. They're just not saved.

**Every leak path, closed.**

| Path | Closed by |
| --- | --- |
| Request object | `providerKey` copies the header to `res.locals.providerKey` and **deletes** it from `req.headers` before any later code (logger, error handler, Sentry) can see it |
| Logs | pino redaction (`x-provider-key`, `providerKey`, `apiKey`); the access log never prints headers; failures log only `{ outcome, status }` |
| Error messages | a **fixed message per outcome**; the provider's response body never reaches the visitor or the logs (the Playbook rule). Any message that still escapes goes through `scrubKeys` |
| Job payloads, Bull Board | demo runs never enqueue |
| Database | no `Run`/`Result` rows; the service has no Prisma write calls (a test greps the file) |
| Cache | `Cache-Control: no-store` on the response; nothing passes through `cache.getOrSet` |
| Rate-limit keys | keyed by IP and visitor id, never by the key (even a hash of a key identifies a person) |
| Browser | in memory by default; `sessionStorage` only with "remember for this tab", every access in try/catch; never `localStorage`, never a cookie |
| Third parties | the key goes only to its provider, over TLS, from `complete()` |
| Sentry (Phase 29) | `beforeSend` drops request headers and runs `scrubKeys` over the event |

**Never the owner's key.** No header → 400 "Add your API key", before any provider code runs.
`complete()` receives `apiKey` explicitly; the demo path never calls the env-key overload. A test sets
`NVIDIA_API_KEY` in the environment, sends a demo request **without** a header, and asserts zero
outbound calls (Phase 28).

**Not an open proxy.** The request names a **published slug**, a `promptVersion` and `modelKey` that
belong to that run, and example refs that are **dev**, `publicInput = true` examples of its task. A
visitor can't make your server relay their own prompts to a provider. Their key would pay, but your
server's IP and reputation would carry it.

**Key shapes, checked lightly** (fail fast on a pasted wrong key; never call a "validate key" endpoint,
which doubles traffic):

| Provider | Shape |
| --- | --- |
| NVIDIA | `^nvapi-[A-Za-z0-9_-]{20,200}$` |
| OpenAI | `^sk-[A-Za-z0-9_-]{20,200}$` (also covers `sk-proj-…`) |
| Anthropic | `^sk-ant-[A-Za-z0-9_-]{20,200}$` |
| Gemini | `^AIza[A-Za-z0-9_-]{30,60}$` |

**Limits** (the visitor pays the model; you pay the server and your IP's reputation):
- `demoDualLimiter` (Phase 06): 5 runs / hour per visitor **and** 20 / hour per IP; neither is charged when the other rejects;
- `demoDailyCapLimiter` (Phase 06): 500 runs / 24 h across all visitors (`DEMO_DAILY_CAP`);
- a global **daily cap** (`DEMO_DAILY_CAP`, Redis `INCR demo-<YYYY-MM-DD>` with a 48 h TTL), which
  fails open like the Playbook's: the visitor's key pays, and the IP limiter still applies when Redis is
  down;
- the request itself: ≤ 10 examples, 1 prompt, 1 model, 1 repeat, `max_tokens` from the frozen prompt,
  60 s total.

## 6. Steps

1. **Middleware** (adapted from the Playbook's, extended per provider):

   ```ts
   // middleware/providerKey.ts
   const KEY_SHAPES: Record<Exclude<Provider, "fake">, RegExp> = {
     nvidia: /^nvapi-[A-Za-z0-9_-]{20,200}$/,
     openai: /^sk-[A-Za-z0-9_-]{20,200}$/,
     anthropic: /^sk-ant-[A-Za-z0-9_-]{20,200}$/,
     gemini: /^AIza[A-Za-z0-9_-]{30,60}$/,
   };

   /* Moves the visitor's key out of the request before anything else sees it. */
   export const providerKey: RequestHandler = (req, res, next) => {
     const raw = req.headers["x-provider-key"];
     delete req.headers["x-provider-key"];
     const key = typeof raw === "string" ? raw.trim() : "";
     if (!key) return next(new AppError(BAD_REQUEST, "Add your API key to run the demo.", appErrorCode.DemoKeyMissing));
     res.locals.providerKey = key;          // shape is checked in the service, once the model (and so the provider) is known
     next();
   };

   export const assertKeyShape = (provider: Provider, key: string) =>
     appAssert(provider !== "fake" && KEY_SHAPES[provider].test(key), BAD_REQUEST,
       `That doesn't look like a ${provider} API key.`, appErrorCode.DemoKeyInvalid);
   ```

   ```ts
   // utils/scrubKeys.ts
   export const scrubKeys = (text: string) =>
     text.replace(/(nvapi-|sk-ant-|sk-|AIza)[A-Za-z0-9_\-]{8,}/g, "[key]");
   ```

2. **Service.**

   ```ts
   // services/demo.service.ts
   const FAILURES = {
     invalid_key: "The provider rejected this key.",
     rate_limited: "The provider is rate-limiting this key.",
     timeout: "No answer within the time limit.",
     retired: "This model has been retired by the provider.",
     provider_error: "The provider couldn't answer this time.",
   } as const;

   export const runDemo = async (input: DemoRunRequest, apiKey: string) => {
     const run = await runAsSystem(() => prisma.run.findUnique({
       where: { publishedSlug: input.slug },
       include: { variants: { include: { promptVersion: true, model: true } }, task: true },
     }));
     appAssert(run?.publishedAt, NOT_FOUND, "Demo not found");
     const variant = run.variants.find((v) => `${v.promptVersion.key}@${v.promptVersion.version}` === input.promptVersion && v.model.key === input.modelKey);
     appAssert(variant && variant.model.active, BAD_REQUEST, "Pick a prompt and model from this run");
     assertKeyShape(variant.model.provider, apiKey);
     appAssert(await underDailyCap(), SERVICE_UNAVAILABLE, "The demo is resting until tomorrow.", appErrorCode.DemoDailyCap);

     const examples = await withOrgScope(run.orgId, () => prisma.example.findMany({
       where: { taskId: run.taskId, ref: { in: input.exampleRefs }, split: "dev", publicInput: true },
     }));
     appAssert(examples.length === input.exampleRefs.length, BAD_REQUEST, "Only public dev examples can be used");

     const signal = AbortSignal.timeout(60_000);
     const results = await mapWithConcurrency(examples, 2, async (example) => {
       try {
         const cell = await executeCell({ task: run.task, promptVersion: variant.promptVersion, model: variant.model, example, repeatIndex: 0 },
                                        { complete, apiKey, signal });              // Phase 17: pure, returns the scored result
         return { exampleRef: example.ref, ...cell };
       } catch (error) {
         const outcome = classify(error);                                           // 401/403 → invalid_key, 429, 410 → retired, abort → timeout
         logger.info({ outcome, status: statusOf(error) }, "demo cell failed");     // never the body, never the key
         return { exampleRef: example.ref, status: "error" as const, error: FAILURES[outcome], outcome };
       }
     });
     appAssert(results.some((r) => r.outcome !== "invalid_key"), UNAUTHORIZED, FAILURES.invalid_key, appErrorCode.DemoKeyInvalid);
     return { results, summary: aggregateVariant(results, run.task.fields), model: variant.model.key, promptVersion: input.promptVersion };
   };
   ```

   `withOrgScope(orgId, fn)` runs `fn` with that org in the request context (Phase 03's
   `requestContext`), the same pattern Phase 22's public read model uses. `aggregateVariant` is Phase
   18's pure function from `@repo/scoring`.
3. **Controller and route.**

   ```ts
   // routes/demo.route.ts — limiters first (they never look at the key), then the key leaves req.headers.
   demoRoutes.post("/run", demoDailyCapLimiter, demoDualLimiter, providerKey, demoRunHandler);
   ```

   The handler sets `Cache-Control: no-store`, parses `demoRunRequestSchema`
   (`{ slug, promptVersion, modelKey, exampleRefs: string[1..10] }`), and calls `runDemo(input,
   res.locals.providerKey)`. Mount it in `app.ts` with its own `express.json({ limit: "16kb" })`.
4. **Web `/demo`** (public, no `AuthLoader`):
   - `KeyInput`: provider shown from the chosen model; a password field; "remember for this tab"
     (`sessionStorage` via `lib/providerKey.ts`, copied from the Playbook island with the same
     try/catch guards); the note "Your key is sent with this request only, used for at most 10 calls,
     and never stored or logged" linking to `demo.service.ts` on GitHub.
   - `DemoRunForm`: the published runs (from `GET /public/runs`), then a prompt version and model from
     that run, then 5 dev examples preselected (max 10).
   - `DemoResults`: the read-only `ResultsTable` for one variant and `ResultCard`s, with "This is a
     10-example sample on your key, not the published result" above it, and **Download JSON** (built in
     the browser; nothing goes to the server).
   - For a signed-in member of the run's workspace: a **Run this properly** link to the Phase 20
     launcher prefilled with the same prompt and model (a normal, stored run on the owner's keys and
     budget).
5. On a 401, clear the in-memory key, remove it from `sessionStorage`, and focus the key field. On a
   429, show "Too many runs, try again in an hour" (the Playbook lesson: treat 429 as its own state).

## 7. Verify

1. No header → `400 DEMO_KEY_MISSING`. Run it with `NVIDIA_API_KEY` set in the API env and the `fake`
   provider counting calls: the count stays **0**.
2. A wrong-shaped key for the model's provider → `400 DEMO_KEY_INVALID`, no outbound call.
3. A real NVIDIA key, 5 examples → results in < 60 s; then
   `SELECT count(*) FROM runs; SELECT count(*) FROM results;` are unchanged, and
   `redis-cli --scan --pattern 'bull:*'` shows no new demo keys.
4. Log check: `grep -c "<last 8 chars of the key>" api.log` → `0`. Force a provider 401 (an invalid
   key with the right shape) → `401`, the body says "The provider rejected this key.", and the log line
   is only `{ outcome: "invalid_key", status: 401|403 }`.
5. The 6th run within an hour from one browser → `429`; a fresh incognito window from the same IP still
   works until 20 per hour, then the IP is blocked.
6. 11 example refs → 400; a test-split ref → 400; a ref with `publicInput = false` → 400; a
   `promptVersion` that isn't in the published run → 400; an unpublished slug → 404.
7. "Remember for this tab" off → reload → the key field is empty. On → it survives reloads in that tab
   and is gone in a new tab. DevTools → Application: nothing in localStorage or cookies.
8. A model retired by the provider (`active` still true locally) → each cell says "This model has been
   retired by the provider." (410), not a generic error.

## 8. Definition of done

- [ ] Demo runs are synchronous, tiny, limited, scored by the shared core, and use only the
      visitor's key on a published run's prompts and public dev examples.
- [ ] Every path in the leak table is closed and checked (header deleted, redaction, fixed messages,
      scrub, no queue/DB/cache, `no-store`).
- [ ] The owner's key can never serve an anonymous run (checked with the env key present).
- [ ] 401 / 403 / 410 / 429 / timeout each get their own message; 429 is its own UI state.
- [ ] Commit: `feat: bring-your-own-key public demo`.

## 9. Interview angle

*"Your demo calls paid APIs. Who pays, and what happens to the visitor's key?"* They pay, with their own
key, and it never outlives the request: no queue, no database, no cache, no logs (the header is deleted
before anything else runs, and error text is fixed per outcome). Runs are capped at ten calls on my
published prompts and public examples, limited per visitor, per IP and per day, and there's deliberately
no fallback to my key. I built the same thing once already for the Playbook's Try-it, and its lessons
(401 vs 403, retired models) are in this one from day one.
