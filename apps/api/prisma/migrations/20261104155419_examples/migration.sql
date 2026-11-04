-- CreateEnum
CREATE TYPE "Split" AS ENUM ('dev', 'test');

-- CreateTable
CREATE TABLE "examples" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "ref" TEXT NOT NULL,
    "split" "Split" NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "input" TEXT NOT NULL,
    "expected" JSONB NOT NULL,
    "public_input" BOOLEAN NOT NULL DEFAULT true,
    "second_label" JSONB,
    "second_label_by" UUID,
    "notes" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "examples_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "examples_task_id_split_idx" ON "examples"("task_id", "split");

-- CreateIndex
CREATE UNIQUE INDEX "examples_task_id_ref_key" ON "examples"("task_id", "ref");

-- AddForeignKey
ALTER TABLE "examples" ADD CONSTRAINT "examples_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
