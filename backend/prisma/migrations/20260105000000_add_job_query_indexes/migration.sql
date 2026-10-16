-- AlterTable
ALTER TABLE "IndexerDeadLetter" ALTER COLUMN "lastSeenAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Dispute_jobId_idx" ON "Dispute"("jobId");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Job_clientId_idx" ON "Job"("clientId");

-- CreateIndex
CREATE INDEX "Job_freelancerId_idx" ON "Job"("freelancerId");

-- CreateIndex
CREATE INDEX "Milestone_jobId_idx" ON "Milestone"("jobId");

-- CreateIndex
CREATE INDEX "Rating_jobId_idx" ON "Rating"("jobId");

-- CreateIndex
CREATE INDEX "Rating_rateeId_idx" ON "Rating"("rateeId");

-- CreateIndex
CREATE INDEX "Rating_raterId_idx" ON "Rating"("raterId");
