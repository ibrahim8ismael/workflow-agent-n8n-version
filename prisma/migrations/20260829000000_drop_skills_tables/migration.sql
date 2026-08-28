-- Drop the deprecated Skills system (ADR-011, PLAN Step 11/12).
--
-- ⚠️ APPLY ONLY AFTER the runtime cutover is verified in staging:
--    1. Run `scripts/migrate-skills-to-automations.ts --write` first
--       (converts Skill(N8N_WORKFLOW) rows into pending Automations).
--    2. Verify no active runs reference skills.
--    3. Apply this migration AND, in the same release, remove the
--       `Skill` / `AgentSkill` / `SkillExecutionMode` models from
--       prisma/schema.prisma (plus the agents skill-attachment endpoints
--       and the `employee_skills_list` tool) so the code matches the DB.
--
-- Hand-written per repo convention; do not regenerate.

-- DropIndex
DROP INDEX IF EXISTS "skills_slug_key";
DROP INDEX IF EXISTS "skills_slug_idx";
DROP INDEX IF EXISTS "skills_userId_idx";
DROP INDEX IF EXISTS "skills_organizationId_idx";
DROP INDEX IF EXISTS "skills_status_idx";
DROP INDEX IF EXISTS "skills_category_idx";
DROP INDEX IF EXISTS "agent_skills_agentId_skillId_key";
DROP INDEX IF EXISTS "agent_skills_agentId_idx";
DROP INDEX IF EXISTS "agent_skills_skillId_idx";

-- Drop child table first (agent_skills → skills FK)
DROP TABLE "agent_skills";

DROP TABLE "skills";

DROP TYPE "SkillExecutionMode";
