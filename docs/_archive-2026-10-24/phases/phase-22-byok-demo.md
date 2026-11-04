# Phase 22 — Public demo: bring your own key

## 1. Goal

Let a visitor try Prompt Lab live **without spending your money and without you ever holding their
key**:
- the visitor pastes **their own** provider key (NVIDIA, OpenAI, Anthropic or Gemini). It stays in
  the browser (`sessionStorage`, opt-in "remember for this tab"), is sent **per request** in an
  `X-Provider-Key` header, used for the calls of that request, and dropped;
- demo runs are **tiny** (≤ 10 inputs, 1 prompt × 1 model, 1 repeat, on the published demo task's dev
  examples), **synchronous** (no queue: the key can't be put in a job payload), and limited per
  visitor and per IP;
- results are shown immediately and **not stored**, unless the visitor signs in and saves them.

## 2. What I will understand after this phase

1. Why the key can't go through the queue, and how that shapes the design.
2. Every place a key could leak (logs, job payloads, error messages, Sentry, the database, browser
   storage) and how each is closed.
3. Why the owner's server keys are never used for anonymous runs, even as a fallback.
4. How the demo's limits are sized.

## 3. Prerequisites

Phase 21 done; the demo task published.

## 4. Files

```
apps/api/src/
├── middleware/providerKey.ts            NEW   (read + validate the header; never store; scrub on error)
├── services/demo.service.ts             NEW   (tiny synchronous grid using executeCell)
├── routes/demo.route.ts                 NEW   (POST /demo/run — visitor + IP limiters, no auth)
└── utils/logger.ts                      (redaction from Phase 02 already covers the header)
apps/web/src/
├── app/demo/page.tsx                    NEW
├── components/demo/{KeyInput,DemoRunForm,DemoResults}.tsx   NEW
└── lib/providerKey.ts                   NEW   (sessionStorage helpers, try/catch)
```

## 5. Concepts

**No queue for keys.** BullMQ job payloads live in Redis and are visible in Bull Board, so a key in a
payload is a stored key. So demo runs execute **inside the request**: at most 10 calls, with the
provider's concurrency limited to 2, and a hard 60 s total budget. That's the same `executeCell` core
(Phase 16) with `apiKey` passed through `complete()`'s `apiKey` option (Phase 13), and nothing
persisted. The grid limit is what makes synchronous execution acceptable.

**Every leak path, closed.**

| Path | Closed by |
| --- | --- |
| Logs | pino redact paths for `x-provider-key` / `providerKey` (Phase 02); the access log doesn't print headers |
| Error messages | provider errors are re-thrown as `ProviderHttpError(status, body)`; the body is the provider's response (it never echoes the key, but scrub `sk-…` / `nvapi-…` patterns from any error text before it's returned or logged) |
| Job payloads | demo runs never enqueue |
| Database | demo results are returned, not written; "Save" requires sign-in and saves the **results only** |
| Cache | demo responses aren't cached |
| Rate-limit keys | keyed by visitor and IP, never by the key |
| Browser | `sessionStorage` only if the visitor ticks "remember for this tab"; never `localStorage`, never a cookie |
| Third parties | the key goes only to its provider's API, over TLS |

`DATA-HANDLING` paragraph for the README: "Your key is sent with your request, used for at most 10
calls to that provider, and discarded. It is never stored, logged or queued. You can check: the code
is open source (`demo.service.ts`)."

**Never the owner's key.** If `X-Provider-Key` is missing, the demo endpoint answers 400 "Add your API
key". It does **not** fall back to `NVIDIA_API_KEY`. `complete()` is called with
`apiKey: <header value>`, and a missing header never reaches it. A test asserts this (Phase 26).

**Limits.** These are the Phase 06 limiters:
- `demoRunVisitorLimiter`: 5 / hour per visitor;
- `demoRunIpLimiter`: 20 / hour per IP;
- the global limiter.

Plus request validation: ≤ 10 examples, only examples of the task marked `demo: true`, only the dev
split, 1 prompt, 1 model, 1 repeat, a model from the enabled registry for the key's provider. Inputs
are the task's examples, so visitors can't send arbitrary text to the provider *through your server*.
That would make the demo a free proxy for their own prompts. (Optional: allow one custom posting of
≤ 4,000 characters; it's still the visitor's key and quota.)

**Key format check.** Light validation only (length, character set, a prefix per provider when one is
documented) to fail fast on a pasted wrong key. Never call a "validate key" endpoint, which doubles
traffic.

## 6. Steps

```ts
// middleware/providerKey.ts
const KEY_SHAPE = /^[A-Za-z0-9_\-.]{20,200}$/;

export const readProviderKey: RequestHandler = (req, res, next) => {
    const key = req.get("x-provider-key");
    appAssert(key && KEY_SHAPE.test(key), BAD_REQUEST, "Add your provider API key to run the demo", appErrorCode.ProviderKeyMissing);
    res.locals.providerKey = key;                       // request-scoped only; never on req.body, never logged
    delete req.headers["x-provider-key"];               // nothing downstream (logger, Sentry) can read it again
    next();
};

// Remove anything key-shaped from text that might be returned or logged.
export const scrubKeys = (text: string) => text.replace(/(sk-|nvapi-|AIza)[A-Za-z0-9_\-]{8,}/g, "[key]");
```

```ts
// services/demo.service.ts
export const runDemo = async (body: DemoRunSchema, apiKey: string) => {
    const task = await TaskModel.findOne({ slug: body.taskSlug, demo: true }).lean();
    appAssert(task, NOT_FOUND, "Demo task not found");
    const examples = await ExampleModel.find({ taskId: task._id, split: "dev", _id: { $in: body.exampleIds } }).limit(10).lean();
    const prompt = await PromptModel.findOne({ _id: body.promptId, taskId: task._id, frozenAt: { $ne: null } }).lean();
    const model = await ModelModel.findOne({ key: body.modelKey, provider: body.provider }).lean();
    appAssert(prompt && model && examples.length > 0, BAD_REQUEST, "Invalid demo selection");

    const snapshot = buildSnapshot(prompt, task);
    const deadline = AbortSignal.timeout(60_000);
    const results = await mapWithConcurrency(examples, 2, (example) =>
        executeCell({ task, prompt, model, example, snapshot }, { complete, apiKey, signal: deadline })
            .catch((error) => ({ status: "error" as const, error: { code: errorCode(error), message: scrubKeys(String(error.message)) } })));
    return { results, summary: aggregate(results.map(toLite), task.fields.map((f) => f.key)) };
};
```

The route is `POST /demo/run` with `demoRunIpLimiter, demoRunVisitorLimiter, readProviderKey`, then the
controller. Run it with `express.json({ limit: "64kb" })`.

Web `/demo`:
- `KeyInput`: provider select, password field, a "remember for this tab" checkbox
  (`sessionStorage` with try/catch), a "your key is never stored" note linking to the code;
- `DemoRunForm`: the published task, a frozen prompt (v1–v5), a model of that provider, 5 dev
  examples preselected;
- `DemoResults`: the same `ResultsTable` and `ResultCard` components;
- "Save to my workspace" (requires sign-in): posts the **results** (not the key) to
  `POST /demo/save`, which creates a run with `byok: true`.

## 7. Verify

1. Without a key → 400 "Add your provider API key", and **no** outbound call (fake provider call count
   0). The server's `NVIDIA_API_KEY` is never used (a test with the env key set proves it).
2. With a valid NVIDIA key → 5 results in < 60 s; nothing in `results` / `runs` collections; no
   `cell:` jobs in Redis.
3. `grep` the API logs for the key's last 8 characters → nothing. Force a provider 401 → the error
   shown contains no key.
4. The 6th demo run within an hour from the same browser → 429; a new incognito window from the same IP
   still works until 20/hour.
5. 11 example ids → 400; a test-split example id → 400; a prompt that isn't frozen → 400.
6. "Remember for this tab" off → reload → the key is gone; on → it survives reloads in that tab only.

## 8. Definition of done

- [ ] Demo runs are synchronous, tiny, limited, and use only the visitor's key.
- [ ] Every leak path in the table is closed and checked.
- [ ] The owner's key can never be used for an anonymous run (tested).
- [ ] Commit: `feat: bring-your-own-key public demo`.

## 9. Interview angle

*"Your demo calls paid APIs. Who pays, and how do you handle the user's key?"* They do, with their own
key, and it never leaves the request. No queue, no database, no logs (redacted, and the header is
deleted after reading), error text scrubbed. Runs are capped at ten calls, limited per visitor and per
IP, and there's deliberately no fallback to my key.
