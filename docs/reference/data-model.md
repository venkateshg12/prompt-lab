# Data model (PostgreSQL 17 + Prisma 7.10.1)

**PostgreSQL only.** The `apps/api/prisma/schema.prisma` the phases build up to. Each phase adds only
its own models and one migration (`pnpm --filter api db:migrate:dev --name <slug>`; in scripts run
`prisma migrate dev < /dev/null`, since it waits on stdin, then `prisma generate`).

Conventions (from `@pt-api/prisma/schema.prisma`):
- UUIDv7 ids, snake_case tables/columns (`@@map`/`@map`), camelCase fields, `Timestamptz(3)`;
- every tenant table has `orgId` and is in `TENANT_MODELS` (`src/db/prisma.ts`);
- `onDelete: Cascade` from parent to child (deleting a run deletes its results in one statement);
- money is **integer micro-dollars**; running totals `BigInt`;
- document-shaped data (field rules, expected answers, parsed outputs, field scores, summaries) is
  `jsonb`, validated by `@repo/types` on write and read;
- copied models keep PaperTrail's names exactly;
- Prisma **7.10.1** pinned (npm `latest` is an 8.0 RC).

```prisma
generator client {
  provider     = "prisma-client"
  output       = "../src/generated/prisma"
  moduleFormat = "cjs"
}

datasource db {
  provider = "postgresql"
}

// ── Copied (PaperTrail) ───────────────────────────────────────────────────────────────────────────
enum AuthProvider { local google }
enum PlatformRole { user admin }
enum OrgRole      { owner admin reviewer viewer }
enum InviteRole   { admin reviewer viewer }
enum ActorType    { user system api_key }

model User             { /* COPY @pt-api */ }
model Session          { /* COPY */ }
model VerificationLink { /* COPY */ }
model Org {            // ADAPT: a workspace
  id                     String   @id @default(uuid(7)) @db.Uuid
  name                   String
  createdById            String   @map("created_by") @db.Uuid
  monthlyBudgetUsdMicros BigInt   @default(20000000) @map("monthly_budget_usd_micros")   // $20 of owner-key runs
  createdAt              DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt              DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)
  createdBy   User         @relation("OrgCreatedBy", fields: [createdById], references: [id])
  memberships Membership[]
  invites     Invite[]
  @@map("orgs")
}
model Membership { /* COPY */ }
model Invite     { /* COPY */ }
model AuditLog   { /* COPY — label edits, prompt freezes, publishes */ }

// ── New enums ─────────────────────────────────────────────────────────────────────────────────────
enum Split         { dev test }
enum Technique     { zero_shot few_shot cot structured custom }
enum Provider      { nvidia openai anthropic gemini fake }
enum StructuredSupport { supported unsupported untested }
enum RunStatus     { queued running completed failed cancelled }
enum ResultStatus  { scored error skipped }

// ── Tasks and test sets (Phases 11–12) ────────────────────────────────────────────────────────────
model Task {
  id           String   @id @default(uuid(7)) @db.Uuid
  orgId        String   @map("org_id") @db.Uuid
  slug         String                                   // "job-postings"
  name         String
  description  String   @default("")
  instructions String                                   // the shared {{instructions}} block
  fields       Json                                     // FieldRule[] (the DSL, scoring-rules.md §2)
  version      Int      @default(1)                     // bumped when fields change; runs record it
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt    DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  org      Org             @relation(fields: [orgId], references: [id], onDelete: Cascade)
  examples Example[]
  prompts  PromptVersion[]
  runs     Run[]

  @@unique([orgId, slug])
  @@map("tasks")
}

model Example {
  id                String   @id @default(uuid(7)) @db.Uuid
  orgId             String   @map("org_id") @db.Uuid
  taskId            String   @map("task_id") @db.Uuid
  ref               String                               // "jp_017": stable, exported as exampleId
  split             Split
  tags              String[] @default([])
  input             String
  expected          Json
  publicInput       Boolean  @default(true) @map("public_input")    // false → hidden on published pages
  secondLabel       Json?    @map("second_label")                    // the double-check (Phase 12)
  secondLabelById   String?  @map("second_label_by") @db.Uuid
  notes             String?
  revision          Int      @default(1)                             // bumped on every expected edit
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(3)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(3)

  task    Task     @relation(fields: [taskId], references: [id], onDelete: Cascade)
  results Result[]

  @@unique([taskId, ref])
  @@index([taskId, split])
  @@map("examples")
}

// ── Prompts and models (Phases 13–15) ─────────────────────────────────────────────────────────────
model PromptVersion {
  id               String    @id @default(uuid(7)) @db.Uuid
  orgId            String    @map("org_id") @db.Uuid
  taskId           String    @map("task_id") @db.Uuid
  key              String                                 // "v2-few-shot"
  version          Int                                    // exported as "<key>@<version>"
  technique        Technique
  system           String
  template         String                                 // contains {{input}}, may use {{instructions}} {{fields}} {{examples}}
  fewShotExampleIds String[] @default([]) @map("few_shot_example_ids") @db.Uuid   // dev examples only (enforced)
  notes            String?
  frozenAt         DateTime? @map("frozen_at") @db.Timestamptz(3)   // set when first used by a run; then immutable
  createdAt        DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)

  task     Task         @relation(fields: [taskId], references: [id], onDelete: Cascade)
  variants RunVariant[]

  @@unique([taskId, key, version])
  @@map("prompt_versions")
}

model Model {                                              // global registry, not tenant-owned
  id                    String            @id @default(uuid(7)) @db.Uuid
  key                   String            @unique         // "nvidia:openai/gpt-oss-20b"
  provider              Provider
  modelId               String            @map("model_id")
  label                 String
  contextTokens         Int?              @map("context_tokens")
  inputUsdMicrosPerMTok Int               @map("input_usd_micros_per_mtok")
  outputUsdMicrosPerMTok Int              @map("output_usd_micros_per_mtok")
  priceNote             String?           @map("price_note")           // "reference host price; NVIDIA free tier"
  priceCheckedOn        DateTime          @map("price_checked_on") @db.Date
  structured            StructuredSupport @default(untested)
  structuredMode        String?           @map("structured_mode")      // "native" | "guided_json" (Phase 15 probe)
  structuredProbedAt    DateTime?         @map("structured_probed_at") @db.Timestamptz(3)
  active                Boolean           @default(true)               // false = retired (410) or removed

  variants RunVariant[]
  @@map("models")
}

// ── Runs and results (Phases 17–18) ───────────────────────────────────────────────────────────────
model Run {
  id             String    @id @default(uuid(7)) @db.Uuid
  orgId          String    @map("org_id") @db.Uuid
  taskId         String    @map("task_id") @db.Uuid
  taskVersion    Int       @map("task_version")
  split          Split
  repeats        Int       @default(1)
  temperature    Float     @default(0)
  status         RunStatus @default(queued)
  datasetHash    String    @map("dataset_hash")          // sha256 of the examples' (ref, revision) list
  testReused     Boolean   @default(false) @map("test_reused")
  pricesSnapshot Json      @map("prices_snapshot")
  promptSnapshots Json     @map("prompt_snapshots")      // rendered system/template/few-shot per variant, written by createRun
  totalCells     Int       @map("total_cells")
  doneCells      Int       @default(0) @map("done_cells")
  errorCells     Int       @default(0) @map("error_cells")
  notes          String?
  startedById    String    @map("started_by") @db.Uuid
  createdAt      DateTime  @default(now()) @map("created_at") @db.Timestamptz(3)
  finishedAt     DateTime? @map("finished_at") @db.Timestamptz(3)
  publishedSlug  String?   @unique @map("published_slug")
  publishedAt    DateTime? @map("published_at") @db.Timestamptz(3)
  publishOptions Json?     @map("publish_options")

  task     Task         @relation(fields: [taskId], references: [id], onDelete: Cascade)
  variants RunVariant[]
  results  Result[]

  @@index([orgId, createdAt(sort: Desc), id(sort: Desc)])
  @@map("runs")
}

model RunVariant {                                         // one prompt version × one model in a run
  id              String  @id @default(uuid(7)) @db.Uuid
  orgId           String  @map("org_id") @db.Uuid
  runId           String  @map("run_id") @db.Uuid
  promptVersionId String  @map("prompt_version_id") @db.Uuid
  modelId         String  @map("model_id") @db.Uuid
  summary         Json?                                   // aggregates (scoring-rules.md §3), written by finalize
  run           Run           @relation(fields: [runId], references: [id], onDelete: Cascade)
  promptVersion PromptVersion @relation(fields: [promptVersionId], references: [id])
  model         Model         @relation(fields: [modelId], references: [id])
  results       Result[]

  @@unique([runId, promptVersionId, modelId])
  @@map("run_variants")
}

model Result {
  id            String       @id @default(uuid(7)) @db.Uuid
  orgId         String       @map("org_id") @db.Uuid
  runId         String       @map("run_id") @db.Uuid
  variantId     String       @map("variant_id") @db.Uuid
  exampleId     String       @map("example_id") @db.Uuid
  repeatIndex   Int          @map("repeat_index")
  status        ResultStatus
  rawOutput     String?      @map("raw_output")
  extractedText String?      @map("extracted_text")
  parsedJson    Json?        @map("parsed_json")
  validJson     Boolean?     @map("valid_json")
  schemaValid   Boolean?     @map("schema_valid")
  fieldScores   Json?        @map("field_scores")        // [{ key, score, reason? }]
  fieldDetails  Json?        @map("field_details")       // { skills: { precision, recall }, <field>: { reason }, … }
  overallScore  Float?       @map("overall_score")
  exactMatch    Boolean?     @map("exact_match")
  inputTokens   Int?         @map("input_tokens")
  outputTokens  Int?         @map("output_tokens")
  costUsdMicros Int?         @map("cost_usd_micros")
  latencyMs     Int?         @map("latency_ms")
  finishReason  String?      @map("finish_reason")
  attempts      Int          @default(1)
  error         String?                                 // also skip reasons: "structured_unsupported", "cancelled"
  judge         Json?                                     // Phase 26: { model, pass, rationale }
  completedAt   DateTime     @default(now()) @map("completed_at") @db.Timestamptz(3)

  run     Run        @relation(fields: [runId], references: [id], onDelete: Cascade)
  variant RunVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)
  example Example    @relation(fields: [exampleId], references: [id])

  @@unique([runId, variantId, exampleId, repeatIndex])   // one result per cell, even on retries
  @@index([runId, variantId, overallScore])
  @@map("results")
}
```

Cancel sets `Run.status = cancelled` immediately (there is no `cancelling` state); cells that start
afterwards record `status: skipped`, `error: "cancelled"`. A `structured` prompt on a model whose
`structured` is `unsupported` produces `skipped` cells (`error: "structured_unsupported"`); on an
`untested` model `createRun` refuses with `MODEL_UNPROBED`.

`TENANT_MODELS`: `Invite`, `AuditLog`, `Task`, `Example`, `PromptVersion`, `Run`, `RunVariant`,
`Result`. Not tenant: `User`, `Session`, `VerificationLink`, `Org`, `Membership`, `Model`. Public pages
read a published run through `runAsSystem()` **by slug only**, then filter on its `orgId`.

## Which phase adds what

| Phase | Models / enums | Migration |
| --- | --- | --- |
| 03 | Prisma wiring + empty migration | `init` |
| 04 | `AuthProvider`, `PlatformRole`, `User`, `Session`, `VerificationLink` | `accounts` |
| 10 | `OrgRole`, `InviteRole`, `ActorType`, `Org`, `Membership`, `Invite`, `AuditLog` | `workspaces` |
| 11 | `Task` | `tasks` |
| 12 | `Split`, `Example` | `examples` |
| 13 | `Technique`, `PromptVersion` | `prompts` |
| 14 | `Provider`, `StructuredSupport`, `Model` (incl. `structuredMode`, set by Phase 15's probe) | `models` |
| 17 | `RunStatus`, `ResultStatus`, `Run` (incl. `promptSnapshots`), `RunVariant`, `Result` | `runs` |
| 22 | `Run.publishedSlug`, `publishedAt`, `publishOptions` | `publish` |
| 26 | `Result.judge` | `judge` |
