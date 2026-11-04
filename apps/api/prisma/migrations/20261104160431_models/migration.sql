-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('nvidia', 'openai', 'anthropic', 'gemini', 'fake');

-- CreateEnum
CREATE TYPE "StructuredSupport" AS ENUM ('supported', 'unsupported', 'untested');

-- CreateTable
CREATE TABLE "models" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "model_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "context_tokens" INTEGER,
    "input_usd_micros_per_mtok" INTEGER NOT NULL,
    "output_usd_micros_per_mtok" INTEGER NOT NULL,
    "price_note" TEXT,
    "price_checked_on" DATE NOT NULL,
    "structured" "StructuredSupport" NOT NULL DEFAULT 'untested',
    "structured_mode" TEXT,
    "structured_probed_at" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "models_key_key" ON "models"("key");
