-- AlterTable
ALTER TABLE "Job" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "Job_tags_idx" ON "Job" USING GIN ("tags" array_ops);
