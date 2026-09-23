-- CreateEnum
CREATE TYPE "Payer" AS ENUM ('CUSTOMER', 'BANK');

-- CreateTable
CREATE TABLE "PaymentScheduleItem" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "payer" "Payer" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentScheduleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncentiveResult" (
    "projectId" TEXT NOT NULL,
    "salesUserId" TEXT NOT NULL,
    "partnerId" TEXT,
    "orderValue" DECIMAL(12,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL,
    "incentivePct" DECIMAL(7,4) NOT NULL,
    "incentiveAmount" DECIMAL(12,2) NOT NULL,
    "partnerCommissionPct" DECIMAL(7,4) NOT NULL,
    "partnerCommissionAmount" DECIMAL(12,2) NOT NULL,
    "rules" JSONB NOT NULL,
    "provisional" BOOLEAN NOT NULL DEFAULT true,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncentiveResult_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE INDEX "PaymentScheduleItem_projectId_idx" ON "PaymentScheduleItem"("projectId");

-- CreateIndex
CREATE INDEX "PaymentScheduleItem_dueDate_idx" ON "PaymentScheduleItem"("dueDate");

-- AddForeignKey
ALTER TABLE "PaymentScheduleItem" ADD CONSTRAINT "PaymentScheduleItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncentiveResult" ADD CONSTRAINT "IncentiveResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
