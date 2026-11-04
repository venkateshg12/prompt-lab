# Phase 03 — MongoDB and data conventions

## 1. Goal

Connect to MongoDB (local replica set, Atlas in production), report it in `/health`, disconnect on
shutdown, and fix the conventions every Prompt Lab model follows:
- `ownerId` on every user-owned document;
- **integer micro-dollars** for cost;
- ObjectId validation at the edge;
- `withTransaction` for multi-document writes;
- cursor pagination helpers.

## 2. What I will understand after this phase

1. Why a single-owner app still stamps `ownerId` on everything (published pages, a future team mode).
2. Why cost is integer micro-dollars and scores are plain floats (0–1).
3. When Prompt Lab needs a transaction (freezing prompts + creating a run) and when it doesn't.

## 3. Prerequisites

Phase 02 done; `docker compose up -d mongo`.

## 4. Files

```
apps/api/src/
├── config/db.ts                 COPY   @pt-api/src/config/db.ts
├── utils/db/transaction.ts      COPY   @pt-api/src/utils/db/transaction.ts
├── utils/db/cursor.ts (+test)   COPY   @pt-api/src/utils/db/cursor.ts, cursor.test.ts
├── utils/db/index.ts            NEW    (export transaction + cursor; money.ts is not needed)
├── constants/env.ts             ADAPT  (+ MONGO_URI)
├── app.ts · index.ts            ADAPT  (health reports mongo; connect / disconnect)
packages/types/src/
├── objectId.ts                  COPY   @pt-root/packages/types/src/objectId.ts
└── pagination.ts                COPY   @pt-root/packages/types/src/pagination.ts
```

```bash
pnpm --filter api add mongoose
```

## 5. Concepts

**`ownerId` everywhere.** Prompt Lab has one kind of user: the owner of a workspace. Tasks, examples,
prompts, runs and results all carry `ownerId`, and every service filters by it. Phase 21's published
pages are the only reads not by owner (by slug, read-only, and only for runs the owner chose to
publish). If you later add teams, `ownerId` becomes `workspaceId` with PaperTrail's membership
pattern, and nothing else moves.

**Numbers.**
- Cost: integer **micro-dollars** (`$0.000375` → `375`), summed exactly. PaperTrail's lesson.
- Scores: floats in [0, 1] (F1 is inherently fractional). Aggregates are means over hundreds of
  results, rounded only for display (one decimal place in percentages).
- Tokens and latency: integers.

**Transactions where two writes must agree**: creating a run **and** freezing the prompt versions it
uses (Phase 12/16). A prompt used by a run can't be edited afterwards, so the freeze and the run must
commit together. Result writes are single-document upserts, so no transaction is needed.

## 6. Steps

```bash
cd ~/Code/prompt-lab; PT=~/Code/paper-trail
cp $PT/apps/api/src/config/db.ts apps/api/src/config/
mkdir -p apps/api/src/utils/db && cp $PT/apps/api/src/utils/db/{transaction,cursor,cursor.test}.ts apps/api/src/utils/db/
printf 'export * from "./transaction";\nexport * from "./cursor";\n' > apps/api/src/utils/db/index.ts
cp $PT/packages/types/src/{objectId,pagination}.ts packages/types/src/
```

- `packages/types/src/index.ts`: export `objectId` and `pagination`.
- `env.ts`: restore `MONGO_URI`. `.env.example`:
  `MONGO_URI=mongodb://localhost:27017/promptlab?replicaSet=rs0`.
- `app.ts`: PaperTrail's `/health` body without the cache line (Phase 07 adds it back).
- `index.ts`: `await connectDB()` first, `await mongoose.disconnect()` last in shutdown.

Write the model template every later model copies:

```ts
ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
// …fields…
{ timestamps: true }
```

## 7. Verify

- `/health` → `mongo: "up"`; stop Mongo → 503.
- The transaction probe from PaperTrail's Phase 03 (insert + rolled-back insert → count 1) works.
- `diff -q` the copied files.

## 8. Definition of done

- [ ] Connected, reported, disconnected in order.
- [ ] Conventions written (copy the model template into `tasks/lessons.md` as a reminder).
- [ ] Commit: `feat(api): mongo connection and conventions`.

## 9. Interview angle

*"Why Mongo for a benchmark tool?"* The results are naturally documents (a raw output, a parsed JSON,
a map of field scores), the aggregates are `$group` pipelines, and it's the same database as my other
projects. The spec suggested SQLite, and I recorded the trade-off in an ADR.
