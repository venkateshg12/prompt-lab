-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "ResultStatus" AS ENUM ('scored', 'error', 'skipped');

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "task_version" INTEGER NOT NULL,
    "split" "Split" NOT NULL,
    "repeats" INTEGER NOT NULL DEFAULT 1,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "dataset_hash" TEXT NOT NULL,
    "test_reused" BOOLEAN NOT NULL DEFAULT false,
    "prices_snapshot" JSONB NOT NULL,
    "prompt_snapshots" JSONB NOT NULL,
    "total_cells" INTEGER NOT NULL,
    "done_cells" INTEGER NOT NULL DEFAULT 0,
    "error_cells" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "started_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_variants" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "prompt_version_id" UUID NOT NULL,
    "model_id" UUID NOT NULL,
    "summary" JSONB,

    CONSTRAINT "run_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "results" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "example_id" UUID NOT NULL,
    "repeat_index" INTEGER NOT NULL,
    "status" "ResultStatus" NOT NULL,
    "raw_output" TEXT,
    "extracted_text" TEXT,
    "parsed_json" JSONB,
    "valid_json" BOOLEAN,
    "schema_valid" BOOLEAN,
    "field_scores" JSONB,
    "field_details" JSONB,
    "overall_score" DOUBLE PRECISION,
    "exact_match" BOOLEAN,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cost_usd_micros" INTEGER,
    "latency_ms" INTEGER,
    "finish_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "error" TEXT,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "runs_org_id_created_at_id_idx" ON "runs"("org_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "run_variants_run_id_prompt_version_id_model_id_key" ON "run_variants"("run_id", "prompt_version_id", "model_id");

-- CreateIndex
CREATE INDEX "results_run_id_variant_id_overall_score_idx" ON "results"("run_id", "variant_id", "overall_score");

-- CreateIndex
CREATE UNIQUE INDEX "results_run_id_variant_id_example_id_repeat_index_key" ON "results"("run_id", "variant_id", "example_id", "repeat_index");

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_variants" ADD CONSTRAINT "run_variants_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_variants" ADD CONSTRAINT "run_variants_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "prompt_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_variants" ADD CONSTRAINT "run_variants_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "run_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "results" ADD CONSTRAINT "results_example_id_fkey" FOREIGN KEY ("example_id") REFERENCES "examples"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
