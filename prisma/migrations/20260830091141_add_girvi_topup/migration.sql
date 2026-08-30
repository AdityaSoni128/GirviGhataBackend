-- CreateTable
CREATE TABLE "girvi_topups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "girviTransactionId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "topUpDate" TIMESTAMP(3) NOT NULL,
    "applyPreviousInterestStartDate" BOOLEAN NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "girvi_topups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "girvi_topups_tenantId_girviTransactionId_idx" ON "girvi_topups"("tenantId", "girviTransactionId");

-- AddForeignKey
ALTER TABLE "girvi_topups" ADD CONSTRAINT "girvi_topups_girviTransactionId_fkey" FOREIGN KEY ("girviTransactionId") REFERENCES "girvi_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
