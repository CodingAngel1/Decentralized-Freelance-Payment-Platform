-- CreateTable
CREATE TABLE "ChainEvent" (
    "id" TEXT NOT NULL,
    "escrowId" BIGINT NOT NULL,
    "action" TEXT NOT NULL,
    "amount" DECIMAL(65,30),
    "txHash" TEXT,
    "ledger" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChainEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChainEvent_escrowId_ledger_idx" ON "ChainEvent"("escrowId", "ledger");
