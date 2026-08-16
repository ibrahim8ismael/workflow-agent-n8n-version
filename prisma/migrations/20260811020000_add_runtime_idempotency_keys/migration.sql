CREATE TYPE "RuntimeIdempotencyStatus" AS ENUM ('STARTED', 'COMPLETED', 'FAILED', 'UNKNOWN');

CREATE TABLE "runtime_idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,
    "logicalAction" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "status" "RuntimeIdempotencyStatus" NOT NULL DEFAULT 'STARTED',
    "result" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "runtime_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "runtime_idempotency_keys_key_key" ON "runtime_idempotency_keys"("key");
CREATE INDEX "runtime_idempotency_keys_runId_idx" ON "runtime_idempotency_keys"("runId");
CREATE INDEX "runtime_idempotency_keys_status_idx" ON "runtime_idempotency_keys"("status");
CREATE INDEX "runtime_idempotency_keys_expiresAt_idx" ON "runtime_idempotency_keys"("expiresAt");

ALTER TABLE "runtime_idempotency_keys"
ADD CONSTRAINT "runtime_idempotency_keys_runId_fkey"
FOREIGN KEY ("runId") REFERENCES "runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
