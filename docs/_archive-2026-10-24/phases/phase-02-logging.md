# Phase 02 — Logging and request ids

## 1. Goal

Copy PaperTrail's pino logger, `AsyncLocalStorage` request context and `requestId` middleware, then
extend the **redaction list** for Prompt Lab's own secret: visitors' bring-your-own API keys
(Phase 22). A run's progress lines (Phase 16) carry the run id through the same context.

## 2. What I will understand after this phase

1. How `AsyncLocalStorage` gives every log line a request or run id.
2. Why redaction is configured in the logger and not at call sites.
3. Why raw model outputs and test inputs are **not** logged: they're stored in Mongo with the
   result, which is the right place.

## 3. Prerequisites

Phase 01 done.

## 4. Files

```
apps/api/src/
├── utils/requestContext.ts      ADAPT  @pt-api/src/utils/requestContext.ts   (fields: requestId, ownerId, runId; drop orgId/systemScope)
├── utils/logger.ts              ADAPT  @pt-api/src/utils/logger.ts           (+ redact paths)
├── middleware/requestId.ts      COPY   @pt-api/src/middleware/requestId.ts
├── middleware/errorHandler.ts   (unchanged COPY; its logger import now resolves)
├── constants/env.ts             ADAPT  (+ LOG_LEVEL, SERVICE_NAME)
└── app.ts                       ADAPT  (app.use(requestId) first)
```

```bash
pnpm --filter api add pino && pnpm --filter api add -D pino-pretty
```

## 5. Concepts

**What gets redacted, and why.**
- Auth secrets from the copied list (password, tokens, cookies, authorization).
- **`x-provider-key` and `providerKey`**: a visitor's own OpenAI/Anthropic/Gemini/NVIDIA key sent with
  a demo run. It must never reach a log line, a job payload or a database row. Phase 22 enforces that
  in code; the logger is the backstop.
- **`input`, `rawOutput`, `expected`**: test inputs and model outputs are data. They live in
  `examples` and `results`, which you can query. Logging them duplicates potentially third-party
  text (job postings) into a log retention you don't control.

## 6. Steps

```bash
cd ~/Code/prompt-lab/apps/api/src; PT=~/Code/paper-trail/apps/api/src
cp $PT/utils/{logger,requestContext}.ts utils/ && cp $PT/middleware/requestId.ts middleware/
```

`requestContext.ts`: change the context type to
`{ requestId: string; ownerId?: string; runId?: string }`. Delete `runAsSystem`, `systemScope` and
`orgId`. Keep `runWithRequestContext`, `getRequestContext`, `getRequestId`, `setRequestContext`.

`logger.ts`: in `REDACT_PATHS`, keep the auth entries; delete the document-specific ones (`pageText`,
`rawText`, `imageBase64`); add:

```ts
// Bring-your-own-key demo (Phase 22): a visitor's provider key must never be logged.
"providerKey", "*.providerKey", "headers[\"x-provider-key\"]", "req.headers[\"x-provider-key\"]",
// Data that lives in Mongo, not in logs.
"input", "*.input", "rawOutput", "*.rawOutput", "expected", "*.expected",
```

`env.ts`: restore `LOG_LEVEL` and `SERVICE_NAME` from PaperTrail's file. `app.ts`: `app.use(requestId)`
as the first middleware. Swap any `console.*` in `index.ts` for `logger`.

## 7. Verify

```bash
curl -si localhost:5000/health | grep -i x-request-id                 # a UUID
curl -si -H 'x-request-id: abc-123' localhost:5000/health | grep -i x-request-id   # abc-123
```

A temporary line `logger.info({ providerKey: "sk-test", req: { headers: { "x-provider-key": "sk-test" } }, input: "posting" }, "check")`
prints `[redacted]` for all three. `diff -q` the copied `requestId.ts`.

## 8. Definition of done

- [ ] Request ids on every response and log line.
- [ ] Provider keys, inputs and raw outputs redacted (checked once by hand).
- [ ] Commit: `feat(api): pino logging with request ids`.

## 9. Interview angle

*"How do you handle users' API keys in a demo?"* They never leave the request: not stored, not queued,
not logged. Redaction in the logger is the backstop for code that forgets.
