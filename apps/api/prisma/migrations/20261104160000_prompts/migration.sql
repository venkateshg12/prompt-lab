-- CreateEnum
CREATE TYPE "Technique" AS ENUM ('zero_shot', 'few_shot', 'cot', 'structured', 'custom');

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "technique" "Technique" NOT NULL,
    "system" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "few_shot_example_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "notes" TEXT,
    "frozen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_task_id_key_version_key" ON "prompt_versions"("task_id", "key", "version");

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
