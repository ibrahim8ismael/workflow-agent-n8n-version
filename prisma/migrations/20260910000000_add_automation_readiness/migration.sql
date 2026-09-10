-- Credential-independent workflow readiness (Automation.buildable/readyToRun/readinessBlockers)
-- Blueprint stays STATIC; readiness is DYNAMIC and lives on the Automation row.

-- AlterTable
ALTER TABLE "automations" ADD COLUMN     "buildable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "readyToRun" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "readinessBlockers" JSONB;

-- Backfill: workflows already ACTIVE with an external id keep prior semantics
-- (created + activated). Everything else starts as not-ready until refreshed.
UPDATE "automations"
SET "buildable" = true, "readyToRun" = true
WHERE "status" = 'ACTIVE' AND "externalWorkflowId" IS NOT NULL AND "deletedAt" IS NULL;

UPDATE "automations"
SET "buildable" = true, "readyToRun" = false
WHERE NOT ("status" = 'ACTIVE' AND "externalWorkflowId" IS NOT NULL AND "deletedAt" IS NULL);
