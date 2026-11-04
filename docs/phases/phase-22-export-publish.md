# Phase 22 — Export and published pages

## 1. Goal

Get results **out** of Prompt Lab without retyping a single number:

- **Markdown**: the README table (spec §11 columns), generated from a run's summary, with a caption
  (run id · split · n · repeats · date · prices checked on · test-reuse/re-score notes).
- **`summary.csv`**: the same table as CSV; **`results.csv`**: one row per result, inputs **off** by
  default. Both use PaperTrail's formula-injection escaping.
- **`results.jsonl`**: one line per cell in the **Playbook contract** format
  (`playbook-contract.md` §1), the file the Playbook's built importer reads. Also from the CLI:
  `bench … --out results.jsonl`.
- **`examples/export.jsonl`**: the test set as Playbook case lines (contract §2).
- **Publish** a run to an unguessable slug: a public, read-only `/r/<slug>` with the table, the error
  browser (read-only, hidden inputs respected), run metadata and caveats, and no owner data.
  Unpublish removes it.

## 2. What I will understand after this phase

1. Why the README table is generated, never typed.
2. What a published page must hide (owner identity, notes unless chosen, hidden inputs, anything that
   spends money) and must show (versions, split, n, price date, caveats).
3. How CSV exports stay safe in spreadsheets (formula injection).
4. Why a cross-repo export format is a **contract** with a test, not a convention.
5. Why public pages read through `runAsSystem()` by slug and then scope to that run's org.

## 3. Prerequisites

- Phase 21 done (summary, results list, re-score).
- [../reference/playbook-contract.md](../reference/playbook-contract.md) read. The Playbook's importer is
  **built**: `@pb-root/apps/site/scripts/import-prompt-lab.ts`, `@pb-root/apps/site/scripts/import/prompt-lab.ts`,
  and its schemas in `@pb-root/packages/types/src/importContracts.ts` (`promptLabResultLineSchema`,
  `promptLabCaseLineSchema`). Open them before writing the serializer.

## 4. Files

```
packages/scoring/src/exportMarkdown.ts            NEW    (pure: summary + meta → Markdown string)
packages/types/src/export.ts                      NEW    (resultLineSchema, caseLineSchema: mirrors of the Playbook's, publishSchema)
apps/api/
├── prisma/migrations/<ts>_publish/               NEW    (Run.publishedSlug @unique, publishedAt, publishOptions)
└── src/
    ├── utils/csv.ts (+ csv.test.ts)              ADAPT  @pt-api/src/utils/csv.ts (drop csvAmountMinor/csvTaxRateBp/csvDate, keep csvText/csvNumber/csvLine/UTF8_BOM)
    ├── services/export.service.ts                NEW    (streams; toResultLine from Phase 17's runner/resultLine.ts, toCaseLine)
    ├── services/publish.service.ts               NEW    (publish/unpublish, slug, public read model)
    ├── controllers/{export,publish,public}.controller.ts   NEW
    ├── routes/{export,public}.route.ts           NEW
    ├── config/rateLimiter.ts                     ADAPT  (+ publicReadLimiter if Phase 06 didn't add it)
    ├── utils/cache/cache.ts                      ADAPT  (CacheDomain += "published" if Phase 07 didn't)
    ├── scripts/bench.ts                          ADAPT  (Phase 17's CLI: + --out <file.jsonl>, + --markdown)
    └── scripts/export-run.ts                     NEW    (`--run <id> --out-dir <dir>` → <dir>/<runId>.results.jsonl, .summary.csv, .md)
apps/web/src/
├── app/r/[slug]/page.tsx                         NEW    (public Server Component)
├── app/r/[slug]/errors/page.tsx                  NEW    (public, read-only error browser)
├── app/page.tsx                                  ADAPT  (lists published runs)
└── components/results/{ExportMenu,PublishDialog}.tsx   NEW
```

## 5. Concepts

**Generated, never typed.** The Markdown is a pure function of the summary (`exportMarkdown`), so the
README table is pasted output with the run id and date in its caption, and the CLI prints the same
string. Example output:

```markdown
| Prompt | Model | Overall | Skills F1 | Salary acc | Valid JSON | Consistency | $ / 100 inputs | p95 latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v1-zero-shot@1 | nvidia:openai/gpt-oss-20b | 71.2 % (68.4–73.9) | 0.78 | 54.3 % | 97.1 % | 88.6 % | $0.031 | 2.1 s |

*Run r_… · test split, 70 examples × 3 repeats (n = 210 per row) · 3 Nov 2026 · prices checked 24 Oct 2026
· NVIDIA prices are a reference host's published price for the same open model.*
```

(The numbers above are layout only. Yours come from the run.) Notes appended automatically:
`test reused` when set; "re-scored on … with task vN"; structured "n/a" rows explained; error counts.

**CSV.**
- `summary.csv`: one row per variant, every summary metric with `ci_low`/`ci_high`.
- `results.csv`: ids, example ref, tags, repeat, status, valid/schema/exact flags, overall, one column
  per field score, tokens, cost, latency. `?includeText=true` adds input and raw output; it's for your
  own analysis and is off by default, because inputs may be third-party postings (Phase 24).
- Every text cell goes through `csvText`, which prefixes `'` to cells starting with `= + - @ \t \r`. A
  posting can start with anything.

**The contract export.** `toResultLine(result, ctx)` maps one `Result` to exactly the Playbook's line:

| Contract key | From |
| --- | --- |
| `runId` | `Run.id` |
| `split` | `Run.split` |
| `promptVersion` | `` `${PromptVersion.key}@${PromptVersion.version}` `` |
| `modelKey` | `Model.key` |
| `exampleId` | `Example.ref` |
| `repeat` | `Result.repeatIndex` (0-based) |
| `status` | `Result.status` (`scored` / `error` / `skipped`) |
| `rawOutput`, `validJson`, `schemaValid`, `exactMatch`, `overallScore` | same-named columns |
| `fieldScores` | `[{ key, score }]` (the `reason` key may stay: the Playbook's Zod object strips unknown keys) |
| `outputTokens`, `costUsdMicros`, `latencyMs` | same-named columns |
| `completedAt` | `Result.completedAt.toISOString()` |
| extra (allowed) | `tags`, `fieldDetails`, `inputTokens`, `error`, `testReused` |

`resultLineSchema` in `@repo/types` mirrors the Playbook's `promptLabResultLineSchema` field by field.
The serializer parses every line with it before writing. Phase 27 adds the cross-repo test that runs
the Playbook's real importer on an export. Lines stream with backpressure (one cursor page of 500 at a
time, `res.write` + `await once(res, "drain")` when it returns false). A 3,150-cell run never sits in
memory as one array.

**Publishing.** `POST …/runs/:id/publish { includeNotes, title }` (admin):
- slug = `r_` + 10 base62 characters from `crypto.randomInt` (≈ 8 × 10¹⁷ values, unguessable);
  insert, and on `P2002` (`isUniqueViolation`) retry up to 3 times;
- sets `publishedSlug`, `publishedAt`, `publishOptions`; `cache.bump("published")`; an `AuditLog`
  entry.

`DELETE …/runs/:id/publish` clears them and bumps the cache.

**The public read model.** `GET /public/runs` (published runs: slug, title, task name, split,
best row, published date; used by the home page and the Phase 23 demo), `GET /public/runs/:slug` and
`GET /public/runs/:slug/results` (no auth, `publicReadLimiter`) look the run up **by slug** inside `runAsSystem()` (the only cross-tenant read),
then run every following query with that run's `orgId` set in the request context, so the tenant
extension scopes them as usual. Returned: summary, run metadata (task name + version, split, repeats,
prompt versions **with their text**, models with prices and dates, published date, notes only when
`includeNotes`), and the caveats. **Never**: owner name/email, workspace name, user ids, drafts, any
endpoint that can start a run. In results, an example with `publicInput = false` returns
`input: null, inputHidden: true`, and `rawOutput: null` too, because a raw output can quote the input.

**Caching.** API: `cache.getOrSet` under the `published` domain, 5 min TTL, bumped on publish,
unpublish and re-score. Web: the Server Component fetches with `next: { revalidate: 60 }` (checked
for Next 16, see §6), so Vercel serves cached HTML. An unpublished slug can live up to 60 s more in
Next's cache. The page says nothing that isn't already public, so that's acceptable and written down.

## 6. Steps

1. **Markdown** in `@repo/scoring` (pure; unit-tested with a fixture summary: column order, rounding,
   caption, every note). The CLI's `--markdown` prints `exportMarkdown(summary, meta)`.
2. **CSV**: adapt `csv.ts` (keep the escaping functions and their test). `GET …/runs/:id/export/summary.csv`
   and `…/export/results.csv?includeText=false` with `Content-Disposition: attachment` and the BOM
   (spreadsheets read UTF-8 Hindi/₹ correctly).
3. **JSONL**:

   ```ts
   // services/export.service.ts
   export const streamResultLines = async (runId: string, res: Response) => {
     const run = await prisma.run.findUnique({ where: { id: runId }, include: { variants: { include: { promptVersion: true, model: true } } } });
     appAssert(run, NOT_FOUND, "Run not found");
     const variants = new Map(run.variants.map((v) => [v.id, v]));
     res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
     res.setHeader("Content-Disposition", `attachment; filename="run-${run.id}.jsonl"`);
     let cursor: string | undefined;
     for (;;) {
       const page = await prisma.result.findMany({
         where: { runId }, orderBy: { id: "asc" }, take: 500,
         ...(cursor && { cursor: { id: cursor }, skip: 1 }),
         include: { example: { select: { ref: true, tags: true } } },
       });
       if (page.length === 0) break;
       for (const r of page) {
         const line = resultLineSchema.parse(toResultLine(r, run, variants.get(r.variantId)!));
         if (!res.write(JSON.stringify(line) + "\n")) await once(res, "drain");
       }
       cursor = page[page.length - 1]!.id;
     }
     res.end();
   };
   ```

   Route: `GET …/runs/:id/export/results.jsonl`. Add `--out <file>` to `bench.ts`, using the same
   `toResultLine` and writing with `fs.createWriteStream`.
4. **Case lines**: `GET …/tasks/:taskId/examples/export.jsonl?split=&publicOnly=true` →
   `{ id: ref, split, tags, input, expected }`. `publicOnly` omits `publicInput = false` examples. This
   is how `cases/job-postings/data/job_postings.jsonl` is regenerated after label fixes.
5. **Publish service + routes** (§5). Migration `publish`:
   `pnpm --filter api db:migrate:dev --name publish` (`< /dev/null` in scripts, then `prisma generate`).
6. **Web**:
   - `ExportMenu` on the run page: Copy Markdown (clipboard), Download summary.csv / results.csv
     (with an "include inputs and outputs" checkbox) / results.jsonl.
   - `PublishDialog`: title, "include notes", Publish → shows the URL with Copy; Unpublish.
   - `/r/[slug]/page.tsx`:

     ```tsx
     export default async function PublishedRun({ params }: { params: Promise<{ slug: string }> }) {
       const { slug } = await params;                       // params is a Promise since Next 15
       const res = await fetch(`${API_URL}/public/runs/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } });
       if (res.status === 404) notFound();
       if (!res.ok) throw new Error("Couldn't load this run");
       const { data } = (await res.json()) as SuccessResponse<PublishedRun>;
       return <PublishedRunView run={data} />;              // ResultsTable in read-only mode + caveats + metadata
     }
     ```

     The public pages live outside the `(app)` group (no `AuthLoader`, no cookies) and reuse
     `ResultsTable` / `ResultCard` with `readOnly`.
   - `app/page.tsx` lists published runs (title, task, split, best row, date).
7. Add `published`, `public-run` to the query keys only if you fetch them client-side. Public pages are
   server-fetched, so there's nothing user-scoped to clear.

## 7. Verify

1. **Copy Markdown** → paste into a scratch `.md` → it renders as the spec's table with caption and
   notes; `bench --task job-postings --run <id> --markdown` prints the identical string (`diff`).
2. `results.csv` in LibreOffice/Excel: a posting starting with `=HYPERLINK(` shows as text. Hindi and
   `₹` display correctly (BOM).
3. Contract check (the full cross-repo test is Phase 27):

   ```bash
   curl -s -b cookies.txt "$API/orgs/$ORG/runs/$RUN/export/results.jsonl" > /tmp/run.jsonl
   wc -l /tmp/run.jsonl                       # = totalCells
   cd ~/Code/prompt-engineering-playbook/apps/site
   pnpm tsx scripts/import-prompt-lab.ts --run /tmp/run.jsonl --lesson be-specific \
     --variant "bad=v1-zero-shot@1,<modelKey>,Zero-shot" \
     --variant "better=v2-few-shot@1,<modelKey>,Few-shot" \
     --metrics overall,valid_json --dry-run    # parses every line, prints rows; no file written
   ```

   (`key=promptVersion,modelKey,Label` is the importer's `parseVariant` syntax in `import/args.ts`.)
4. Publish → open `/r/<slug>` in a private window: table and error browser visible, nothing editable,
   no owner email or workspace name in the HTML (`curl -s … | grep -c "@"` finds only content, never the
   owner's address). An example marked `publicInput = false` shows "[input hidden]" and no raw output.
5. Unpublish → `GET /public/runs/<slug>` returns 404 immediately (cache bumped); the web page 404s
   within 60 s.
6. Hammer `/public/runs/<slug>` past `publicReadLimiter`'s budget → 429 with the envelope.
7. A guessed slug (`r_aaaaaaaaaa`) → 404, and the response time doesn't differ from a valid slug by
   more than noise (no enumeration oracle worth having: lookup is by unique index either way).

## 8. Definition of done

- [ ] Markdown (generated, captioned, notes), summary.csv and results.csv (formula-safe, inputs off by
      default), the CLI printing the same Markdown.
- [ ] `results.jsonl` matches the Playbook contract line for line (validated before writing,
      streamed); the Playbook's importer reads it in `--dry-run`.
- [ ] Case-line export for the test set.
- [ ] Publish/unpublish with unguessable slugs; public pages read-only, cached, rate-limited, with
      caveats and without owner data; hidden inputs respected (raw output too).
- [ ] Commit: `feat: exports, Playbook result lines and published runs`.

## 9. Interview angle

*"Is that table in your README real?"* It's generated from a stored run by the same function the app
uses, captioned with the run id, split, sample size and price date. The live link is a read-only
published page of that exact run, so anyone can click into the individual mistakes. *"How do two of your
repos stay compatible?"* The export format is a written contract with a schema on both sides, and the
second repo's real importer is run against a real export, not a hand-made sample.
