-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('ADVANCE', 'LOAN_INSTALMENT_1', 'LOAN_INSTALMENT_2', 'COLLECTION');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('LOGGED', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "Project" ALTER COLUMN "requiredKw" DROP NOT NULL;

-- CreateTable
CREATE TABLE "SiteVisit" (
    "projectId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "lateReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "actualKw" DECIMAL(8,2),
    "feasible" BOOLEAN,
    "suggestedPackage" TEXT,
    "deviations" TEXT,
    "siteNotes" TEXT,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "SalesTerms" (
    "projectId" TEXT NOT NULL,
    "packageName" TEXT NOT NULL,
    "finalCost" DECIMAL(12,2) NOT NULL,
    "discountPct" DECIMAL(5,2) NOT NULL,
    "paymentTerms" TEXT NOT NULL,
    "finalizedById" TEXT NOT NULL,
    "finalizedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmationNote" TEXT,

    CONSTRAINT "SalesTerms_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "mode" TEXT NOT NULL,
    "utr" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'LOGGED',
    "loggedById" TEXT NOT NULL,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_status_loggedAt_idx" ON "Payment"("status", "loggedAt");

-- CreateIndex
CREATE INDEX "Payment_projectId_idx" ON "Payment"("projectId");

-- CreateIndex
CREATE INDEX "Payment_utr_idx" ON "Payment"("utr");

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTerms" ADD CONSTRAINT "SalesTerms_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
