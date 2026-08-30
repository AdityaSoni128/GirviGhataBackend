-- AlterTable
ALTER TABLE "girvi_transactions" ADD COLUMN     "customerSignatureUrl" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "paymentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
