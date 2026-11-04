# Phase 02 — Logging, request ids, redaction

## 1. Goal

Copy PaperTrail's structured logging:
- pino;
- an `AsyncLocalStorage` request context;
- the `requestId` middleware, which writes one access-log line per request.

Then extend the redaction list for what this app handles that PaperTrail didn't:
- **provider API keys**, both the owner's and, in the public demo, visitors' (`X-Provider-Key`);
- **raw model output and test inputs.** Job postings may be third-party text you're only allowed to
  store for testing (spec §6). Outputs can quote them.

Logs say **what happened to which cell**, never **what the posting said or what the model answered**:

```
INFO cell scored {"requestId":"…","jobId":"cell-0193…-0193…-0193…-2","runId":"0193…","validJson":true,"overall":0.875,"latencyMs":1840}
```

## 2. What I will understand after this phase

1. How `AsyncLocalStorage` gives every log line its request id (and later its run and job ids)
   without passing them around.
2. Why a visitor's API key must be redacted even though the code "never logs it". The redaction list
   is the backstop for the day someone logs `req.headers` while debugging.
3. Why raw output and inputs stay out of logs: they're in PostgreSQL, behind auth and tenancy, with
   the run they belong to.
4. Why redaction is a fixed set of **paths**, not a deep scan, and what that misses.
5. Why `runAsSystem` lives in the request-context file even though tenancy arrives in Phase 03.

## 3. Prerequisites

Phase 01 done.

## 4. Files

```
apps/api/src/
├── utils/requestContext.ts      ADAPT  @pt-api/src/utils/requestContext.ts  (+ jobId in the context type; everything else identical)
├── utils/logger.ts              ADAPT  @pt-api/src/utils/logger.ts          (REDACT_PATHS for keys/outputs/inputs; drop PDF keys; swappable sink)
├── middleware/requestId.ts      COPY   @pt-api/src/middleware/requestId.ts
├── constants/env.ts             ADAPT  (+ LOG_LEVEL, SERVICE_NAME)
├── app.ts                       ADAPT  (requestId first)
├── middleware/errorHandler.ts   ADAPT  (console → logger, resolving Phase 01's comments)
└── index.ts · worker.ts         ADAPT  (console → logger)
```

```bash
pnpm --filter api add pino@^10.4.0
pnpm --filter api add -D pino-pretty@^13.2.0
```

`@pt-api/src/utils/pii.ts` is **not** copied: Prompt Lab stores no customer contacts. (The Enquiry
Assistant needs it; this project doesn't.)

## 5. Concepts

**The request context.** The `requestId` middleware opens an `AsyncLocalStorage` store per request
(`runWithRequestContext({ requestId })`). Everything awaited inside that request, however deep, can
read the store. Later phases enrich it with `setRequestContext`:
- `authenticate` adds `userId` (Phase 05);
- `resolveOrg` adds `orgId` (Phase 10);
- the run-cell worker adds `runId` and `jobId` (Phase 17).

pino's `mixin()` copies the store into every line. So a line from deep inside the scorer says which
workspace, run and cell it belongs to, and nobody passed those ids. PaperTrail's context type already
has `runId` (for its eval runs). Prompt Lab adds only `jobId`.

**`runAsSystem(fn)`** sets `systemScope: true`. Phase 03's tenant extension reads it: work that must
cross workspaces opts out of tenant scoping explicitly, and the log line shows it. That work is:
- the model registry (`Model` isn't tenant-owned);
- the stale-run sweeper;
- published pages looked up by slug.

`settleInScope` makes sure a lazy Prisma query starts while the scope is still active. Keep it
exactly; Phase 03 explains the bug it prevents.

**Redaction is paths, compiled once.** pino compiles `redact.paths` into a fast serializer. `"*.input"`
covers one level of nesting, which is where job data and request bodies put fields
(`{ data: { input } }`). It's **not** a deep scan. That's why the rule comes first ("log ids, not
content") and redaction second.

| Category | Paths (each also as `*.x`) | Why |
| --- | --- | --- |
| Secrets (kept from PaperTrail) | `password`, `currentPassword`, `newPassword`, `token`, `accessToken`, `refreshToken`, `verificationToken`, `resetToken`, `apiKey`, `secret`, `authorization`, `cookie`, `headers.authorization`, `headers.cookie` | credentials |
| Provider keys | `providerKey`, `headers["x-provider-key"]`, `nvidiaApiKey`, `openaiApiKey`, `anthropicApiKey`, `geminiApiKey` | the demo's visitor key (Phase 23) and the owner's keys |
| Model I/O | `rawOutput`, `extractedText`, `parsedJson`, `messages`, `system`, `prompt` | outputs quote inputs; a rendered prompt contains the input |
| Test data | `input`, `expected`, `secondLabel` | third-party text; labels are your work, kept in the database |
| Personal | `email` | logs are kept longer and read by more people than the database |

PaperTrail's PDF keys (`pageText`, `imageBase64`, `accountNumber`, `transactions`) are dropped.
Nothing here produces them.

**The access log never prints a query string.** `requestId` logs `req.originalUrl.split("?")[0]`.
Verification and invite links carry tokens; Phase 05 keeps reset tokens out of URLs entirely.

**A swappable sink for tests.** Phase 28's "no key and no output in logs" test needs to capture what
the real `logger` prints, without every module importing a different instance. When the pretty
transport is off (always in tests), pino writes through a sink the test can redirect.

## 6. Steps

1. **Copy** `middleware/requestId.ts` (identical).

2. **requestContext.ts.** Copy it, then extend the type only:
   ```ts
   type RequestContext = {
       requestId: string;
       orgId?: string;
       userId?: string;
       runId?: string;
       jobId?: string;       // any BullMQ job (Phase 08); run cells set it (Phase 17)
       systemScope?: boolean;
   };
   ```
   Everything else stays byte-identical: `settleInScope`, `runWithRequestContext`, `runAsSystem`,
   `getRequestContext`, `getRequestId` and `setRequestContext`.

3. **env.ts.**
   ```ts
   export const LOG_LEVEL = getEnv("LOG_LEVEL", "info");
   export const SERVICE_NAME = getEnv("SERVICE_NAME", "api");
   ```
   `.env.example`: `LOG_LEVEL=debug`, `SERVICE_NAME=api`. The worker sets `SERVICE_NAME=worker` in
   production (Phase 29).

4. **logger.ts.** Copy it, then replace `REDACT_PATHS`:
   ```ts
   const both = (...keys: string[]) => keys.flatMap((key) => [key, `*.${key}`]);

   /*
     Keys whose values never reach a log line. Paths, not a recursive scan: pino compiles them once.
     The rule is still "log ids, not content"; this list is the backstop for code that forgets.
    */
   const REDACT_PATHS = [
       ...both("password", "currentPassword", "newPassword", "token", "accessToken", "refreshToken",
               "verificationToken", "resetToken", "apiKey", "secret", "authorization", "cookie"),
       "headers.authorization", "headers.cookie",
       // Provider keys: the owner's (env) and a demo visitor's (X-Provider-Key, Phase 23).
       ...both("providerKey", "nvidiaApiKey", "openaiApiKey", "anthropicApiKey", "geminiApiKey"),
       'headers["x-provider-key"]', '*.headers["x-provider-key"]',
       // Model I/O and test data: stored in PostgreSQL with their run, never in logs.
       ...both("rawOutput", "extractedText", "parsedJson", "messages", "system", "prompt"),
       ...both("input", "expected", "secondLabel"),
       ...both("email"),
   ];
   ```
   Keep `canPrettyPrint`, `mixin`, `base`, `timestamp` and the pretty transport exactly. Then add the
   swappable sink for the non-pretty branch:
   ```ts
   import type { DestinationStream } from "pino";

   let current: DestinationStream = pino.destination(1);                  // stdout
   const sink: DestinationStream = { write: (line: string) => current.write(line) };
   /** Tests only: send every log line to `stream` (Phase 28's log capture). */
   export const setLogDestination = (stream: DestinationStream) => {
       current = stream;
   };
   // non-pretty branch: pino({ …options }, sink)
   ```

5. **app.ts:** `app.use(requestId)` is the **first** middleware, so even a helmet or CORS rejection
   carries an id. **errorHandler, index, worker:** replace every `console.*` with `logger.*`,
   resolving the `// Phase 02:` comments.

6. **A rule for every later phase**, written into `tasks/lessons.md` now: *log `runId`, `jobId`,
   `variantId`, `exampleId` (the ref, e.g. `jp_017`), statuses, scores, counts and durations; never an
   input, an output, a rendered prompt or a key.*

7. Commit: `feat(api): structured logging, request ids, redaction`.

## 7. Verify

```bash
pnpm --filter api dev
curl -si localhost:5000/health | grep -i x-request-id
# X-Request-Id: 6b0c…   (a UUID)

curl -si -H 'X-Request-Id: my-trace-123' localhost:5000/health | grep -i x-request-id
# X-Request-Id: my-trace-123

curl -si -H 'X-Request-Id: <script>' localhost:5000/health | grep -i x-request-id
# X-Request-Id: <a fresh UUID>       (unsafe incoming ids are replaced)

# One line per request, path without the query string:
curl -s 'localhost:5000/nope?token=abc' >/dev/null
# INFO request completed {"requestId":"…","method":"GET","path":"/nope","status":404,"durationMs":1}

# Redaction (pnpm --filter … exec runs inside apps/api):
NODE_ENV=production PORT=1 CORS_ORIGIN=x pnpm --filter api exec tsx -e '
const { logger } = require("./src/utils/logger");
logger.info({ providerKey: "nvapi-SECRET", headers: { "x-provider-key": "nvapi-SECRET" },
              rawOutput: "{\"title\":\"x\"}", data: { input: "We are hiring…", apiKey: "sk-1" },
              runId: "0193…", validJson: true }, "check");'
# {"level":30,…,"providerKey":"[redacted]","headers":{"x-provider-key":"[redacted]"},"rawOutput":"[redacted]",
#  "data":{"input":"[redacted]","apiKey":"[redacted]"},"runId":"0193…","validJson":true,"msg":"check"}

NODE_ENV=production PORT=1 CORS_ORIGIN=x pnpm --filter api exec tsx -e '
const { logger } = require("./src/utils/logger");
logger.info({ providerKey: "nvapi-SECRET" }, "x");' | grep -c "nvapi-SECRET"
# 0

diff -q ~/Code/paper-trail/apps/api/src/middleware/requestId.ts apps/api/src/middleware/requestId.ts
# (no output)
diff ~/Code/paper-trail/apps/api/src/utils/requestContext.ts apps/api/src/utils/requestContext.ts
# one hunk: the added `jobId?: string;` line
```

## 8. Definition of done

- [ ] Every response has `X-Request-Id`; unsafe incoming ids are replaced.
- [ ] One access-log line per request, with no query string.
- [ ] Provider keys (including the `x-provider-key` header), raw outputs, inputs and labels print as
      `[redacted]`, at the top level and one level deep.
- [ ] `requestContext.ts` differs from PaperTrail's only by `jobId`; `runAsSystem` is kept.
- [ ] `setLogDestination` exists and the non-pretty branch writes through it.
- [ ] No `console.*` left in `apps/api/src` (`grep -rn "console\." apps/api/src` → nothing outside
      `src/scripts`).
- [ ] The "ids, not content" rule is in `tasks/lessons.md`. Committed; `tracker.md` updated.

## 9. Interview angle

*"Your public demo takes the visitor's own API key. How do you know it never ends up in a log?"*
1. The code never logs it: it's read from a header, passed to one provider call and dropped.
2. The logger redacts `providerKey` and the `x-provider-key` header even if someone logs request
   headers while debugging. The access log prints method, path, status and duration, never headers
   or query strings.
3. A test (Phase 28) captures the real logger's output during a demo request and asserts the key
   string appears nowhere. "We don't log it" is a claim; the test makes it a fact.

*"Why not log the model output? It would make debugging easier."* It's already stored, in the
`results` table with its run, behind auth, where the error browser shows it next to the expected
answer. Logs get copied to drains and kept for months, and outputs quote the inputs, which are
third-party postings. A log line carries the `jobId` and `runId`; the content is one click away in
the app.
