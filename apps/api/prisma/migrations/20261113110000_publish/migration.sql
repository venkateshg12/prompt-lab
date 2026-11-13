-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "publish_options" JSONB,
ADD COLUMN     "published_at" TIMESTAMPTZ(3),
ADD COLUMN     "published_slug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "runs_published_slug_key" ON "runs"("published_slug");

