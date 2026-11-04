# Phase 18 — Web: tasks, test sets, prompts

## 1. Goal

The screens where an experiment is set up:
- **Tasks**: a list, then a task page with tabs **Overview** (rules as a readable table + the
  generated JSON Schema), **Test set**, **Prompts**, **Runs**.
- **Test set**: a TanStack Table with split/tag filters, cursor "load more", row detail with an
  input/expected editor and a second-label diff, and **Import** (paste or file → dry-run report →
  commit).
- **Prompts**: versions grouped by name, an editor with placeholder chips, few-shot picker (dev only),
  and a live **preview** of exactly what the model will see for a chosen example. Frozen versions are
  read-only with "New version".

## 2. What I will understand after this phase

1. How the API's guarantees (dry-run import, frozen prompts, dev-only few-shot) show up as UI states
   rather than error toasts.
2. TanStack Table with server-side cursors.
3. Why the preview is rendered by the server's renderer, not a client copy.

## 3. Prerequisites

Phases 10–17 done.

## 4. Files

```
apps/web/src/
├── api/{task,example,prompt,model}.ts            NEW   (one function per endpoint, PaperTrail's api/*.ts shape)
├── hooks/{tasks,examples,prompts,models}/*.ts    NEW   (one hook per operation)
├── app/(app)/tasks/page.tsx                      NEW
├── app/(app)/tasks/[id]/page.tsx                 NEW   (tabs; tab state in ?tab=)
├── components/tasks/{RulesTable,SchemaViewer}.tsx                     NEW
├── components/examples/{ExamplesTable,ExampleSheet,ImportDialog,LabelDiff}.tsx   NEW
├── components/prompts/{PromptList,PromptEditor,PlaceholderChips,FewShotPicker,PromptPreview}.tsx   NEW
└── components/common/JsonView.tsx                NEW   (pretty, collapsible, copy button)
```

Use the shadcn primitives copied in Phase 09: `tabs`, `table`, `sheet`, `dialog`, `select`, `badge`,
`textarea`, `field`. Remember: class strings inline in JSX.

## 5. Concepts

**Make the guarantees visible.**
- **Import**: the dialog shows the dry-run result (`valid / invalid / new / changed / unchanged`) and a
  table of invalid lines with their issues. The **Commit** button is disabled until there are zero
  invalid rows. The server refuses anyway; the UI just makes the rule obvious.
- **Frozen prompts**: the editor is read-only, with a lock badge "Used by run #12 on 24 Oct" and a
  primary **Create v3** button. No 409 toast surprises.
- **Few-shot**: the picker lists **dev** examples only, filterable by tag, showing a one-line
  summary of each label (title · salary). Selecting a test example is impossible, not just rejected.
- **Split changes**: moving an example from test to dev after a test run shows a confirm dialog that
  explains it will be flagged in the published results.

**Server-rendered preview.** `GET /prompts/:id/preview?exampleId=` returns the exact
`{ system, messages, structured }` that `renderPrompt` produces. A client-side copy of the renderer
could differ (an import version, a whitespace rule), and then the preview would lie. Show it as a chat
transcript: system, then (few-shot) user/assistant pairs, then the final user turn, with token
estimates (`chars / 4`, labelled as an estimate).

**Tables.** TanStack Table in manual mode: the server does the filtering (`split`, `tag`) and the
cursor; the client just renders the rows and calls `fetchNextPage`. Columns: id, split badge, tags,
input (first 80 chars), title / salary from `expected` (case-study-aware, but fall back to "N fields"
for other tasks), label version.

## 6. Steps

1. API modules and hooks in PaperTrail's conventions:
   `useTasks`, `useTask(id)`, `useExamples(taskId, filters)` (infinite), `useImportExamples`,
   `useUpdateExample`, `usePrompts(taskId)`, `usePrompt(id)`, `useCreatePrompt`,
   `useUpdatePrompt`, `useNewPromptVersion`, `usePromptPreview(id, exampleId)`, `useModels`. Every key
   starts with a name in `USER_SCOPED_KEYS` (Phase 09).
2. **Tasks page**: cards with name, field count, example counts per split, prompt count, latest run;
   "New task" opens a dialog with name, instructions and a rules JSON editor validated by
   `fieldRulesSchema` from `@repo/types` before it's sent.
3. **Overview tab**: `RulesTable` (key, kind, details: enum values, synonyms count, tolerance) and
   `SchemaViewer` (`jsonSchemaFor(fields)`, computed client-side from the shared package, which is fine:
   it's display only, and the server uses the same function).
4. **Test set tab**: the filters in the URL (`?split=dev&tag=salary_lpa`), the table, the row sheet
   with two textareas (input, expected JSON) validated live with `answerSchemaFor`, a save
   (`labelVersion` increments), and `LabelDiff` when `secondLabel` exists (per-field, red/green, using
   `@repo/scoring`'s `scoreField` so "disagree" means what the scorer means).
5. **Import dialog**: paste or choose a `.jsonl` / `.csv` file (read with `FileReader`; nothing is
   uploaded but text), format auto-detected by extension, then **Check** → dry-run report → **Import**.
6. **Prompts tab**: a list grouped by name, showing the latest version, technique badge, frozen lock
   and notes, plus a version history drawer. The editor has two textareas (system, user),
   `PlaceholderChips` that insert `{{…}}` at the cursor, a technique select, options, the few-shot
   picker (only enabled for `few_shot`) and notes. Save, or New version when frozen.
7. **Preview**: choose any example (dev by default), then a rendered transcript plus the structured
   schema when the technique is `structured`.

## 7. Verify

1. Seeded task → Overview shows 8 rules; the schema viewer shows 8 properties.
2. Import a file with errors → the report lists lines; Import is disabled; fix → import → the table
   shows the rows; filter `?split=dev&tag=salary_lpa` survives a reload.
3. Edit a label → `labelVersion` 2 is shown; an invalid enum is flagged before saving.
4. Prompt v1 (frozen by a run) → read-only, with **Create v2** → the editor opens with v1's content.
5. The few-shot picker can't show a test example. The preview for v2 shows 3 example pairs and the
   final posting; the preview text equals the API's `preview` response.
6. A task with a second, non-job-posting rule set renders without case-study-specific columns
   breaking.

## 8. Definition of done

- [ ] Task, test-set and prompt screens complete; the API's guarantees visible as UI states.
- [ ] Import with a dry run; the label editor validated with the shared schema; a preview from the
      server.
- [ ] Commit: `feat(web): task, test set and prompt screens`.

## 9. Interview angle

*"How do you stop yourself from tuning prompts on the test set?"* The UI makes it impossible to pick
test examples as few-shot, defaults runs to dev, flags split changes after a test run, and freezes
prompts once used, so the reported numbers always point at the exact prompt text.
