-- Client-managed n8n connections & automations
-- See @PLAN.N8N.CLIENT.MODE.md / @PLAN.IMPLEMENTATION.N8N.CLIENT.MODE.md

-- CreateTable
CREATE TABLE "n8n_connections" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "metadata" JSONB,
    "userId" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "n8n_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "n8n_connection_credentials" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "encryptedData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "n8n_connection_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "blueprint" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DESIGN',
    "connectionId" TEXT NOT NULL,
    "externalWorkflowId" TEXT,
    "webhookPath" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "userId" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "n8n_connections_userId_idx" ON "n8n_connections"("userId");

-- CreateIndex
CREATE INDEX "n8n_connections_organizationId_idx" ON "n8n_connections"("organizationId");

-- CreateIndex
CREATE INDEX "n8n_connections_status_idx" ON "n8n_connections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "n8n_connection_credentials_connectionId_key" ON "n8n_connection_credentials"("connectionId");

-- CreateIndex
CREATE INDEX "automations_connectionId_idx" ON "automations"("connectionId");

-- CreateIndex
CREATE INDEX "automations_userId_idx" ON "automations"("userId");

-- CreateIndex
CREATE INDEX "automations_organizationId_idx" ON "automations"("organizationId");

-- CreateIndex
CREATE INDEX "automations_status_idx" ON "automations"("status");

-- AddForeignKey
ALTER TABLE "n8n_connections" ADD CONSTRAINT "n8n_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "n8n_connections" ADD CONSTRAINT "n8n_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "n8n_connection_credentials" ADD CONSTRAINT "n8n_connection_credentials_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "n8n_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "n8n_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
