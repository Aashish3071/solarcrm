-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('SITE_PHOTO', 'DESIGN', 'INSTALLATION_PLAN', 'INSTALLATION_PHOTO', 'COMPLETION_CERTIFICATE', 'TRAINING_CERTIFICATE', 'GOV_DOCUMENT', 'LOAN_DOCUMENT', 'DISCOM_DOCUMENT', 'OTHER');

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "stage" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GovRegistration" (
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "registrationNo" TEXT,
    "registrationDate" TIMESTAMP(3),
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "GovRegistration_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "LoanApplication" (
    "projectId" TEXT NOT NULL,
    "bank" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAmount" DECIMAL(12,2) NOT NULL,
    "approvedAmount" DECIMAL(12,2),
    "clientReconfirmedAt" TIMESTAMP(3),
    "reconfirmedById" TEXT,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "LoanApplication_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "DiscomApplication" (
    "projectId" TEXT NOT NULL,
    "applicationNo" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "meterNumber" TEXT,
    "meterInstalledAt" TIMESTAMP(3),
    "finalApprovalDate" TIMESTAMP(3),
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "DiscomApplication_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ProjectPlan" (
    "projectId" TEXT NOT NULL,
    "revisitAt" TIMESTAMP(3),
    "revisitNotes" TEXT,
    "plannedStart" TIMESTAMP(3),
    "expectedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "delayReason" TEXT,
    "materialReadyAt" TIMESTAMP(3),
    "readyRemark" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "receivedRemark" TEXT,

    CONSTRAINT "ProjectPlan_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "Installation" (
    "projectId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "trainingAssigneeId" TEXT,
    "trainingCompletedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("projectId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_storageKey_key" ON "Document"("storageKey");

-- CreateIndex
CREATE INDEX "Document_projectId_type_idx" ON "Document"("projectId", "type");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GovRegistration" ADD CONSTRAINT "GovRegistration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscomApplication" ADD CONSTRAINT "DiscomApplication_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPlan" ADD CONSTRAINT "ProjectPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installation" ADD CONSTRAINT "Installation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
