-- One Dispute row per job (see the model comment in schema.prisma).
--
-- `POST /api/disputes` writes the row before the on-chain dispute exists — the
-- `Raised` event carries no reason, so the row is the only place it is kept — and
-- the indexer's `raised` handler attaches the on-chain id afterwards. That
-- handler used to upsert on `onChainId` alone, which matches nothing while the
-- column is null and inserts a second row: one row with the reason, one with the
-- id. The handler now upserts on `jobId` (the same key the routes write), and
-- this constraint makes a second row impossible rather than merely unlikely.
--
-- Step 1 merges the pair a job may already have. The reason exists only
-- off-chain, and the id only on the row the panel's ruling is keyed to, so
-- neither can just be dropped: the reason is copied onto the surviving row,
-- which keeps its own `raisedByAddress` — the raiser the `raised` event
-- reported, which is the address the contract validated (`handleRaised` writes
-- the same value), rather than whoever happened to call `POST /api/disputes`.
UPDATE "Dispute" d
SET "reason" = keep."reason"
FROM "Dispute" keep
WHERE d."jobId" = keep."jobId"
  AND d."id" <> keep."id"
  AND d."onChainId" IS NOT NULL
  AND keep."onChainId" IS NULL
  AND keep."reason" <> ''
  AND d."reason" = '';

-- Step 2 keeps one row per job: first the row with an on-chain id (a ruling is
-- keyed to it), then the earliest, then the lowest id so the choice is
-- deterministic. The row-wise comparison is that ordering — 0 sorts before 1.
DELETE FROM "Dispute" d
USING "Dispute" keep
WHERE d."jobId" = keep."jobId"
  AND d."id" <> keep."id"
  AND (CASE WHEN keep."onChainId" IS NOT NULL THEN 0 ELSE 1 END, keep."createdAt", keep."id")
    <= (CASE WHEN d."onChainId" IS NOT NULL THEN 0 ELSE 1 END, d."createdAt", d."id");

-- DropIndex
-- The plain index from 20260105000000_add_job_query_indexes is now redundant:
-- the unique index below serves the same lookups by jobId.
DROP INDEX IF EXISTS "Dispute_jobId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_jobId_key" ON "Dispute"("jobId");
