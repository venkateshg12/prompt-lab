# Data handling

## The test set

- Job postings were collected by hand from public listings, within each site's terms
  (`cases/job-postings/SOURCES.md`).
- They were anonymised **before** labelling: real company names replaced from a fixed list of fictional
  ones, emails, phone numbers, URLs and recruiter names removed, boilerplate trimmed. `check-public.ts`
  fails on any `@`, `+91`, 10-digit run, `http`, `www.` or a real name from the gitignored
  `.private-names.txt`.
- A posting that can't be republished even anonymised is imported with `publicInput: false`. Published
  pages then show its id and scores only: no input, no raw or parsed output, no per-field values and no
  label (all of which could quote it). The integration suite checks this.

## What the public repository contains

Code, the anonymised case files, prompt versions, exported results of published runs and the documents
in `docs/`. Never `.env` files, keys, `.private-names.txt` or database dumps.

## Visitor keys (the `/demo` page)

- The key travels in one request header, `X-Provider-Key`. The middleware copies it out and **deletes
  the header** before any logging, error handling or tracing can see it.
- Demo runs are synchronous (≤ 10 calls, 60 s). They never enter the queue, the database or the cache.
  Failure messages are fixed per outcome; a provider's response body never reaches the visitor or the
  logs.
- In the browser the key lives in memory, or in `sessionStorage` only when "remember for this tab" is
  ticked. Never `localStorage`, never a cookie.
- The leak scan (Phase 28) searches every text and JSON column, both Redis instances and the captured logs
  for the key after a demo run: zero hits is a test, not a promise.

## What the server logs never contain

The logger redacts passwords, tokens, cookies, authorization headers, `apiKey`, `providerKey`, the
per-provider key names and `x-provider-key`; access logs carry the path without the query string.
Model inputs and outputs are not logged.
