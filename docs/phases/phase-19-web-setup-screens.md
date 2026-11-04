# Phase 19 — Web: tasks, test sets, prompts

## 1. Goal

The screens where an experiment is set up, on top of the Phase 09 web foundation and the Part B APIs:

- **Tasks**: a list, then a task page with tabs **Overview** (field rules as a readable table, a rule
  editor, and the generated JSON Schema), **Test set**, **Prompts**, **Runs** (Phase 20 fills it).
- **Test set**: a TanStack Table with split/tag filters in the URL, cursor "load more", inline edits
  of split and tags, a row sheet with an input/expected editor validated by the shared schema,
  **Import** (paste or file → dry-run report → commit), and for reviewers a **second label** editor
  plus an **agreement** view (spec §6: "ask a friend to double-check 20").
- **Prompts**: versions grouped by key, an editor with placeholder chips, a few-shot picker that can
  only see **dev** examples, a server-rendered **preview** of exactly what the model will receive, and
  a visible **frozen** state ("used by run … → create @N+1").

No new API concepts: every guarantee already lives in the API (Phases 11–13). This phase makes each one
a UI state instead of an error toast.

## 2. What I will understand after this phase

1. How API guarantees (dry-run import, frozen prompts, dev-only few-shot) become UI states.
2. TanStack Table **v9** (`useTable` + `tableFeatures`), with the server doing filtering and cursors.
3. Why the prompt preview is rendered by the server's renderer, not a client copy.
4. How inter-annotator agreement is computed with the **scorer's** field rules, so "disagree" means
   what the benchmark means.
5. Why filter state lives in the URL.

## 3. Prerequisites

- Phase 09 (web foundation: `lib/api.ts`, query client with `USER_SCOPED_KEYS`, auth guards, the
  shadcn primitives) and Phase 10 (org store and `X-Org-Id`, workspace switcher).
- Phases 11–13 APIs, as assumed here (fix this guide if your earlier phases named them differently):

| Need | Endpoint (all under `/orgs/:orgId`) | Phase |
| --- | --- | --- |
| tasks | `GET/POST /tasks`, `GET/PATCH /tasks/:taskId` (field edits bump `Task.version`) | 11 |
| examples | `GET /tasks/:taskId/examples?split&tag&q&cursor`, `PATCH /tasks/:taskId/examples/:id` (bumps `revision`), `POST /tasks/:taskId/examples/import?dryRun=true\|false` `{ format, text }` | 12 |
| second label | `PUT /tasks/:taskId/examples/:id/second-label`, `GET /tasks/:taskId/examples/agreement` | 12 |
| prompts | `GET/POST /tasks/:taskId/prompts`, `PATCH /tasks/:taskId/prompts/:id` (409 `PROMPT_FROZEN` once frozen), `POST /tasks/:taskId/prompts/:id/versions`, `GET /tasks/:taskId/prompts/:id/preview?exampleId=` | 13 |
| models | `GET /models` | 14 |

- Shared code: `fieldRulesSchema` (`@repo/types`), `jsonSchemaFor(fields)`, `answerSchemaFor(fields)`
  and `scoreField(rule, expected, actual)` (`@repo/scoring`, pure).

## 4. Files

```
apps/web/
├── package.json                                   ADAPT  (+ @tanstack/react-table@^9)
└── src/
    ├── api/{task,example,prompt,model}.ts         NEW    (one function per endpoint, @pt-web/src/api/document.ts shape)
    ├── hooks/tasks/{useTasks,useTask,useCreateTask,useUpdateTask}.ts                      NEW
    ├── hooks/examples/{useExamples,useUpdateExample,useImportExamples,useSecondLabel,useAgreement}.ts   NEW
    ├── hooks/prompts/{usePrompts,useCreatePrompt,useUpdatePrompt,useNewPromptVersion,usePromptPreview}.ts NEW
    ├── hooks/models/useModels.ts                  NEW
    ├── lib/queryClient.ts                         ADAPT  @pt-web/src/lib/queryClient.ts (USER_SCOPED_KEYS += tasks, task, examples, agreement, prompts, prompt-preview, models)
    ├── app/(app)/tasks/page.tsx                   NEW
    ├── app/(app)/tasks/[taskId]/page.tsx          NEW    (tabs; ?tab= in the URL)
    ├── components/tasks/{TaskCard,NewTaskDialog,RulesTable,RuleEditor,SchemaViewer}.tsx            NEW
    ├── components/examples/{ExamplesTable,ExampleSheet,ImportDialog,SecondLabelEditor,AgreementPanel,TagEditor}.tsx NEW
    ├── components/prompts/{PromptList,PromptEditor,PlaceholderChips,FewShotPicker,PromptPreview,FrozenBadge}.tsx   NEW
    └── components/common/JsonView.tsx             NEW    (pretty, collapsible, copy)
```

Primitives used (copied in Phase 09 from `@pt-web/src/components/ui/`): `tabs`, `table`, `sheet`,
`dialog`, `select`, `badge`, `textarea`, `field`, `input`, `skeleton`, `alert-popup`. Class strings
stay inline in JSX.

## 5. Concepts

**Make the guarantees visible.**

| API rule | UI state |
| --- | --- |
| Import is checked before it's written | The dialog shows the dry-run counts (`valid · invalid · new · changed · unchanged`) and a table of invalid lines with their Zod issues. **Import** stays disabled until `invalid = 0` |
| Frozen prompts are immutable | Read-only editor, a lock badge ("Frozen 24 Oct · used by 2 runs"), a primary **Create @N+1** button |
| Few-shot comes from dev only | The picker queries `split=dev`. A test example can't be chosen at all, rather than being rejected |
| Field edits change scoring | Saving rules shows "Task v3 → v4: runs scored with v3 will show a stale banner (Phase 21)" before it sends |
| Moving an example test → dev after a test run | A confirm dialog: published results will carry the "test reused" note |

**TanStack Table v9.** v9 is the npm `latest` (checked 3 Nov 2026: `9.3.1`). A table declares its
features: `tableFeatures({ rowSortingFeature, sortedRowModel: createSortedRowModel(), sortFns })`,
then `useTable({ features, columns, data })`, and cells render with `<table.FlexRender cell={cell}/>`.
The v8 names (`useReactTable`, `getSortedRowModel`) are gone. The examples table needs **no** client
row models: the server filters and pages, and the table only renders rows. Keep `features` and
`columns` at module scope so row models aren't rebuilt on every render.

**Server-rendered preview.** `GET …/prompts/:id/preview?exampleId=` returns the exact
`{ system, messages, structured }` that Phase 13's `renderPrompt` produces. A client copy of the
renderer could drift (whitespace, a placeholder rule, the few-shot format), and then the preview would
lie about the benchmark. It's shown as a chat transcript (system, few-shot user/assistant pairs,
final user turn), with a token **estimate** (`chars ÷ 4`, labelled as one).

**Agreement means what the scorer means.** For each double-labelled example, `AgreementPanel`
runs `scoreField(rule, firstLabel[key], secondLabel[key])` for every field. Agreement per field is the
mean score (so skills use F1, salary uses the ±5 % rule). Raw string equality would call `"Acme Labs"`
vs `"acme labs."` a disagreement that the benchmark itself never counts. The API's `GET …/agreement`
does the same computation server-side for the README. The panel lists disagreements first, with
"Accept second label" / "Keep mine" buttons that write `expected` and bump `revision`.

**Filters in the URL.** `?tab=examples&split=dev&tag=salary_lpa&q=lpa` survives a reload and can be
pasted into notes ("these 6 are the LPA misses"). `useSearchParams` reads them; `router.replace`
writes them.

## 6. Steps

1. **API modules and hooks**, in PaperTrail's convention (one function per endpoint in `api/*.ts`,
   one hook per operation). Keys start with names you add to `USER_SCOPED_KEYS`, so logout clears them.

   ```ts
   // src/hooks/examples/useExamples.ts
   export const useExamples = (taskId: string, filters: ExampleFilters) =>
     useInfiniteQuery<SuccessResponse<ExampleItem[]>>({
       queryKey: ["examples", taskId, filters],
       queryFn: ({ pageParam }) => listExamples(taskId, { ...filters, cursor: pageParam as string | undefined }),
       initialPageParam: undefined as string | undefined,
       getNextPageParam: (last) => (last.meta?.hasMore ? (last.meta.nextCursor ?? undefined) : undefined),
     });
   ```

2. **Tasks page.** Cards: name, field count, `dev / test` counts, prompt count, latest run status.
   `NewTaskDialog`: name, slug, instructions, and the rules as JSON validated with `fieldRulesSchema`
   before sending, plus a "Load the job-postings example" button that pastes `cases/job-postings/task.json`.
3. **Overview tab.**
   - `RulesTable`: key · kind · details (enum values, synonyms count, money tolerance) · nullable.
   - `RuleEditor`: one row per field (kind select, kind-specific options), validated live; Save calls
     `PATCH /tasks/:taskId` and shows the version bump notice from §5.
   - `SchemaViewer`: `jsonSchemaFor(fields)` from `@repo/scoring`. Display only; the server uses the
     same function for structured output (Phase 15).
4. **Test set tab.**

   ```tsx
   // src/components/examples/ExamplesTable.tsx (excerpt)
   const features = tableFeatures({});
   const col = createColumnHelper<typeof features, ExampleItem>();
   const columns = col.columns([
     col.accessor("ref", { header: "Id" }),
     col.accessor("split", { header: "Split", cell: (i) => <SplitBadge split={i.getValue()} /> }),
     col.accessor("tags", { header: "Tags", cell: (i) => <TagEditor exampleId={i.row.original.id} tags={i.getValue()} /> }),
     col.accessor("input", { header: "Input", cell: (i) => <span className="line-clamp-1 text-muted-foreground">{i.getValue().slice(0, 80)}</span> }),
     col.display({ id: "label", header: "Label", cell: (i) => <LabelSummary expected={i.row.original.expected} /> }),
     col.accessor("revision", { header: "Rev" }),
   ]);

   export function ExamplesTable({ rows, onOpen }: { rows: ExampleItem[]; onOpen: (id: string) => void }) {
     const table = useTable({ features, columns, data: rows });
     return (
       <Table>
         <TableHeader>{table.getHeaderGroups().map((g) => (
           <TableRow key={g.id}>{g.headers.map((h) => <TableHead key={h.id}><table.FlexRender header={h} /></TableHead>)}</TableRow>
         ))}</TableHeader>
         <TableBody>{table.getRowModel().rows.map((r) => (
           <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r.original.id)}>
             {r.getAllCells().map((c) => <TableCell key={c.id}><table.FlexRender cell={c} /></TableCell>)}
           </TableRow>
         ))}</TableBody>
       </Table>
     );
   }
   ```

   `LabelSummary` shows `title · salary` for the job-postings task and "N fields" for any other task, so
   a second task never breaks the table. `ExampleSheet` has two editors (input text, expected JSON),
   with the expected answer validated live by `answerSchemaFor(task.fields)`; Save bumps `revision`.
   The split select opens the §5 confirm when moving test → dev after a completed test run.
5. **Import dialog.** Paste, or pick a `.jsonl` / `.csv` file (read with `FileReader`; only text is
   sent). **Check** → `?dryRun=true` → report → **Import** → `?dryRun=false`. The accepted line shape
   is the Playbook case line (`{ id, split, tags, input, expected }`, `playbook-contract.md` §2), so
   `cases/job-postings/data/job_postings.jsonl` imports as-is.
6. **Second labels (reviewer role).** `SecondLabelEditor` shows the input and an empty answer form (the
   first label hidden until saved, so the second labeller isn't anchored). After saving,
   `AgreementPanel` shows per-field agreement, overall agreement and the disagreement list. The tab is
   hidden for `viewer`; `RoleGuard` (Phase 09) wraps it.
7. **Prompts tab.**
   - `PromptList`: grouped by `key`, latest version first, technique badge, `FrozenBadge`, notes, a
     version history drawer.
   - `PromptEditor`: system and template textareas; `PlaceholderChips` insert `{{input}}`,
     `{{instructions}}`, `{{fields}}`, `{{examples}}` at the cursor; technique select; `FewShotPicker`
     (enabled only for `few_shot`; lists dev examples, filterable by tag, max 5). Save, or **Create
     @N+1** when frozen (the editor opens on the copy).
   - `PromptPreview`: choose an example (dev by default) → the server-rendered transcript, plus the
     JSON Schema sent for `structured`.
8. **Empty, loading and error states** everywhere: skeleton rows, "No examples yet → Import", and the
   normalised API error message (`lib/api.ts` already shapes it).

## 7. Verify

```bash
pnpm --filter api dev & pnpm --filter web dev
pnpm --filter api cases:import -- cases/job-postings     # Phase 12's CLI seeds the case study
```

1. `/tasks` → the job-postings card shows 8 fields, `30 dev / 70 test` (or your current counts).
2. Overview → `RulesTable` lists 8 rules; `SchemaViewer` shows 8 properties with the enum values.
3. Import a 5-line file with one bad enum (`"remote": "wfh"`) → **Check** reports `invalid 1` with the
   line number and the Zod path; **Import** is disabled. Fix it → Import → the rows appear.
4. Filter `?tab=examples&split=dev&tag=salary_lpa` → reload → the same filtered view.
5. Edit a label → `Rev` goes 1 → 2; type an invalid enum → the editor flags it before Save.
6. As a `reviewer`: second-label 3 examples, one with `"Acme Labs."` vs `"acme labs"` → agreement for
   `company` is 1 on it (normalised the scorer's way); a different salary period beyond ±5 % shows as
   a disagreement.
7. A prompt used by a run → read-only, lock badge, **Create @2** opens an editable copy; the API never
   returns 409 from this screen.
8. `FewShotPicker` shows only `dev` refs (`jp_0xx` with split dev). The preview for `v2-few-shot`
   shows 3 user/assistant pairs and the final posting, and is byte-identical to
   `curl …/prompts/<id>/preview?exampleId=<id>`.
9. As a `viewer`: no edit buttons, no second-label tab.
10. `pnpm --filter web lint && pnpm --filter web typecheck` → clean.

## 8. Definition of done

- [ ] Task, test-set and prompt screens complete; dry-run import, frozen prompts, dev-only few-shot
      and split moves are visible UI states.
- [ ] Tables use TanStack Table v9 with server-side filtering and cursors; filters live in the URL.
- [ ] Labels validated with the shared schema; second labels and agreement use `scoreField`.
- [ ] The preview comes from the server's renderer.
- [ ] New query keys added to `USER_SCOPED_KEYS`.
- [ ] Commit: `feat(web): task, test set and prompt screens`.

## 9. Interview angle

*"How do you stop yourself tuning prompts on the test set?"* The UI makes it impossible: few-shot
examples can only come from dev, prompts freeze the moment a run uses them, and moving a test example
to dev after a test run is flagged in the published results. *"How do you know your labels are
right?"* A second person labels a sample blind, and agreement is measured with the same field rules
the benchmark uses, so "we disagree" means a real disagreement, not a trailing full stop.
