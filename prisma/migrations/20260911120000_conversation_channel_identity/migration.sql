-- Channel identity on conversations: one conversation per external channel
-- thread per agent. NULLs (API-originated conversations) are exempt from the
-- unique index in PostgreSQL.
ALTER TABLE "conversations" ADD COLUMN "channelType" TEXT;
ALTER TABLE "conversations" ADD COLUMN "externalConversationId" TEXT;

-- Backfill existing channel conversations from their metadata so the
-- constraint holds for rows created before this migration.
UPDATE "conversations"
SET "channelType" = "metadata"->>'channelType',
    "externalConversationId" = COALESCE(
      "metadata"->>'externalConversationId',
      "metadata"->>'externalUserId'
    )
WHERE "metadata"->>'channelType' IS NOT NULL
  AND COALESCE("metadata"->>'externalConversationId', "metadata"->>'externalUserId') IS NOT NULL;

CREATE UNIQUE INDEX "conversations_agentid_channeltype_externalconversationid_key"
  ON "conversations"("agentId", "channelType", "externalConversationId");
