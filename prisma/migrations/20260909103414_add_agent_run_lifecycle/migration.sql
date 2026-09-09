-- CreateEnum
CREATE TYPE "AgentRunPhase" AS ENUM ('UNDERSTANDING', 'PLANNING', 'BUILDING', 'STATIC_VALIDATION', 'EXECUTING', 'RUNTIME_VALIDATION', 'COMPLETED', 'FAILED', 'DIAGNOSING', 'REPAIRING');

-- AlterTable
ALTER TABLE "runs" ADD COLUMN     "assumptions" JSONB,
ADD COLUMN     "automationPlan" JSONB,
ADD COLUMN     "businessContext" JSONB,
ADD COLUMN     "constraints" JSONB,
ADD COLUMN     "currentPhase" "AgentRunPhase" NOT NULL DEFAULT 'UNDERSTANDING',
ADD COLUMN     "executionResults" JSONB,
ADD COLUMN     "metrics" JSONB,
ADD COLUMN     "repairAttempts" JSONB,
ADD COLUMN     "requirements" JSONB,
ADD COLUMN     "validationResult" JSONB,
ADD COLUMN     "workflowId" TEXT,
ADD COLUMN     "workflowVersion" INTEGER;

-- CreateTable
CREATE TABLE "agent_run_transitions" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fromStatus" "RunStatus",
    "toStatus" "RunStatus",
    "fromPhase" "AgentRunPhase",
    "toPhase" "AgentRunPhase",
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_run_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_run_transitions_runId_idx" ON "agent_run_transitions"("runId");

-- CreateIndex
CREATE INDEX "runs_currentPhase_idx" ON "runs"("currentPhase");

-- AddForeignKey
ALTER TABLE "agent_run_transitions" ADD CONSTRAINT "agent_run_transitions_runId_fkey" FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
