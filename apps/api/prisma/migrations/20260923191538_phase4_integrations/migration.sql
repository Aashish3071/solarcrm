-- CreateEnum
CREATE TYPE "IntegrationDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "sha256" TEXT;

-- CreateTable
CREATE TABLE "IntegrationLog" (
    "id" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "direction" "IntegrationDirection" NOT NULL,
    "event" TEXT NOT NULL,
    "projectId" TEXT,
    "status" TEXT NOT NULL,
    "summary" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOutbox" (
    "id" TEXT NOT NULL,
    "connector" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "projectId" TEXT,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "IntegrationOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IntegrationLog_connector_at_idx" ON "IntegrationLog"("connector", "at");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationOutbox_dedupeKey_key" ON "IntegrationOutbox"("dedupeKey");

-- CreateIndex
CREATE INDEX "IntegrationOutbox_status_createdAt_idx" ON "IntegrationOutbox"("status", "createdAt");
