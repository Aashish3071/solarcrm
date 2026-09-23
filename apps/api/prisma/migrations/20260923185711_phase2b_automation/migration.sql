-- CreateEnum
CREATE TYPE "RuleKind" AS ENUM ('ROUTING', 'ASSIGNMENT', 'FOLLOW_UP', 'SLA');

-- CreateEnum
CREATE TYPE "RuleMode" AS ENUM ('SUGGEST', 'AUTO');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('FOLLOW_UP', 'ASSIGNMENT', 'SLA_ESCALATION');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "awayUntil" TIMESTAMP(3),
ADD COLUMN     "lastAssignedAt" TIMESTAMP(3),
ADD COLUMN     "maxOpen" INTEGER,
ADD COLUMN     "territories" TEXT[];

-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "RuleKind" NOT NULL,
    "trigger" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "mode" "RuleMode" NOT NULL DEFAULT 'SUGGEST',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT,
    "projectId" TEXT,
    "outcome" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT,
    "ownerId" TEXT,
    "ownerRole" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "suggestion" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaTimer" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "ruleId" TEXT,
    "targetHours" DOUBLE PRECISION NOT NULL,
    "warnPct" INTEGER NOT NULL,
    "escalateTo" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "pausedAt" TIMESTAMP(3),
    "pausedMs" INTEGER NOT NULL DEFAULT 0,
    "warnedAt" TIMESTAMP(3),
    "breachedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "SlaTimer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRule_kind_trigger_active_idx" ON "AutomationRule"("kind", "trigger", "active");

-- CreateIndex
CREATE INDEX "AutomationRun_at_idx" ON "AutomationRun"("at");

-- CreateIndex
CREATE UNIQUE INDEX "Task_dedupeKey_key" ON "Task"("dedupeKey");

-- CreateIndex
CREATE INDEX "Task_ownerId_status_dueAt_idx" ON "Task"("ownerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Task_ownerRole_status_dueAt_idx" ON "Task"("ownerRole", "status", "dueAt");

-- CreateIndex
CREATE INDEX "SlaTimer_resolvedAt_idx" ON "SlaTimer"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SlaTimer_projectId_stage_key" ON "SlaTimer"("projectId", "stage");

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaTimer" ADD CONSTRAINT "SlaTimer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
