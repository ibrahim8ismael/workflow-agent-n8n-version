/*
  Warnings:

  - Made the column `model` on table `agents` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "agents" ALTER COLUMN "model" SET NOT NULL;

-- AlterTable
ALTER TABLE "automations" ADD COLUMN     "blueprintHistory" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
