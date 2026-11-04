# Phase 21 — Export and published pages

## 1. Goal

- **Export** a run as **Markdown** (the README table, with notes and price dates) and as **CSV**
  (summary rows, and every result row for your own analysis).
- **Publish** a run to a public, read-only page at `/r/<slug>`: the results table, the error
  browser in read-only mode, and the run's metadata. That's the "live demo" link, which costs nothing
  per visit because it shows saved results.
- A public landing page listing published runs.

## 2. What I will understand after this phase

1. Why the README table is **generated**, never typed.
2. What a published page must hide (owner data, the editor, anything that triggers spend) and what it
   must show (versions, split, price dates, sample sizes, caveats).
3. How CSV exports stay safe for spreadsheets (formula injection, PaperTrail's `csv.ts`).

## 3. Prerequisites

Phase 20 done.

## 4. Files

```
packages/scoring/src/exportMarkdown.ts        NEW   (pure: summary → Markdown; also used by the CLI)
apps/api/src/
├── utils/csv.ts (+ csv.test.ts)               COPY  @pt-api/src/utils/csv.ts, csv.test.ts
├── services/export.service.ts                 NEW
├── services/publish.service.ts                NEW   (publish/unpublish, slug, public read model)
├── routes/{export,public}.route.ts            NEW
apps/web/src/
├── app/r/[slug]/page.tsx                      NEW   (public, Server Component fetch + client islands)
├── app/r/[slug]/errors/page.tsx               NEW
├── app/page.tsx                               ADAPT (list published runs)
└── components/results/ExportMenu.tsx · PublishDialog.tsx   NEW
```

## 5. Concepts

**Generated, never typed.** The spec: "Report only numbers you actually measure". The Markdown export
is a pure function of the summary, so the README table is pasted output, with the run id and date in
its caption. A typo in a hand-typed table is how portfolios lose credibility in interviews.

The Markdown includes:
- the table with the spec's columns (Prompt · Model · Overall · Skills F1 · Salary acc · Valid JSON ·
  Consistency · $/100 · p95), `n` per row, errors if any;
- a caption: "Run #r_8f2c · test split (70 examples) · 3 repeats · 24 Oct 2026 · prices checked
  24 Oct 2026";
- notes: structured "n/a" rows explained; the NVIDIA reference-price note (`providers.md` §6);
  examples moved out of test after a test run, if any.

**CSV.** Two files:
- `summary.csv` (the table);
- `results.csv`: one row per result with ids, scores per field, validJson, cost, latency, and **no
  raw input text** by default (inputs may be third-party postings, see Phase 23). The checkbox
  "include inputs and outputs" is for your own use.

The copied `csv.ts` escapes formula-leading cells (`=`, `+`, `-`, `@`): a posting's text can start
with anything.

**Publishing.** `POST /runs/:id/publish` (owner) creates a random, unguessable slug
(`r_` + 10 base62 characters) and freezes a **public view**: summary, metadata, and per-result fields
for the error browser. The public view **omits**:
- owner identity and email;
- the notes field, unless "include notes" is ticked;
- example inputs, when the task is marked `publicInputs: false` (show `jp_017 [input hidden]` and
  the field values only);
- anything that can start a run.

`DELETE /runs/:id/publish` removes it. Public routes: `GET /public/runs/:slug`,
`GET /public/runs/:slug/results`, behind `publicReadLimiter` (Phase 06), cached under `published`
(Phase 07), no auth.

**Caveats travel with the numbers.** The public page shows the split, the sample size per row, the
price date, the labeller note ("labelled by one person; 20 double-checked, 92 % field agreement"),
and the limits section. A results page without its limits is marketing.

## 6. Steps

1. `exportMarkdown(summary, meta)` in `@repo/scoring` (pure; the CLI prints the same string).
2. `GET /runs/:id/export.md`, `GET /runs/:id/export/summary.csv`,
   `GET /runs/:id/export/results.csv?includeText=false`: streamed with backpressure (PaperTrail's
   export pattern), using the copied `csv.ts`.
3. `publish.service.ts`: generate a slug (retry on the unique-index collision), set `publishedSlug` +
   `publishedAt` + options, bump `published`.
4. Public routes and the read model: a projection of the summary + metadata. Results through the same
   `results.service` with a `publicView` flag that drops inputs when needed and never returns
   `rawOutput` for hidden-input tasks (raw output can quote the input).
5. Web:
   - `ExportMenu` (Copy Markdown, Download CSVs);
   - `PublishDialog` (options; shows the URL; unpublish);
   - `/r/[slug]`: a public results table (reuse `ResultsTable` in read-only mode) and a link to the
     read-only error browser;
   - `/` lists published runs (title, task, split, best row, date).

   Public pages need no auth: they sit outside the `(app)` group and fetch with a plain `fetch` (no
   cookies). Use `revalidate: 60` on the Server Component fetch so Vercel caches them.
6. Add the Markdown export to the CLI: `bench … --markdown > results.md`.

## 7. Verify

1. Export Markdown → paste it into a scratch README → it renders as the spec's table, with a caption
   and notes.
2. `results.csv` opens in a spreadsheet; a cell starting with `=` shows as text.
3. Publish → open `/r/<slug>` in a private window: the table and error browser are visible, nothing is
   editable, no owner email, inputs hidden if configured.
4. Unpublish → the slug is 404 (after the cache's next version bump; immediately, since unpublish bumps
   `published`).
5. 400 rapid requests to a public page → 429 after 300 (the limiter).

## 8. Definition of done

- [ ] Markdown and CSV exports generated from the summary; formula-safe; the CLI prints the same
      Markdown.
- [ ] Publish/unpublish with unguessable slugs; public pages read-only, cached, rate-limited, with
      caveats.
- [ ] Commit: `feat: exports and published read-only runs`.

## 9. Interview angle

*"Is that table in your README real?"* It's generated from a stored run by the same function the app
uses, captioned with the run id, split, sample size and price date. The live link is a read-only
published page of that exact run, so anyone can click into the individual mistakes.
