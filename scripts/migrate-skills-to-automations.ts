/**
 * Migration script — PLAN Step 11 (unblocked part).
 * Converts existing Skill(N8N_WORKFLOW) rows into Automation records bound
 * to the owner's ACTIVE n8n connection.
 *
 * Usage:
 *   npx tsx scripts/migrate-skills-to-automations.ts          # dry-run (default)
 *   npx tsx scripts/migrate-skills-to-automations.ts --write  # apply
 *
 * Notes:
 * - Requires DATABASE_URL and a reachable Postgres.
 * - Skills without an ACTIVE owner connection are skipped and reported.
 * - Idempotent: skips skills whose slug already exists as an automation
 *   webhookPath/id marker (tracked via blueprint.name + description marker).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const WRITE = process.argv.includes('--write');

async function main() {
  const skills = await prisma.skill.findMany({
    where: { executionMode: 'N8N_WORKFLOW', deletedAt: null },
    include: { user: true, organization: true },
  });

  console.log(
    `Found ${skills.length} Skill(N8N_WORKFLOW) row(s). Mode: ${WRITE ? 'WRITE' : 'DRY-RUN'}`,
  );

  let created = 0;
  let skipped = 0;

  for (const skill of skills) {
    const ownerScope = skill.organizationId
      ? { organizationId: skill.organizationId }
      : { userId: skill.userId };

    if (!ownerScope.organizationId && !ownerScope.userId) {
      console.warn(`  ⚠︎ ${skill.slug}: no owner (userId/organizationId) — skipped`);
      skipped++;
      continue;
    }

    const connection = await prisma.n8nConnection.findFirst({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        OR: [
          { userId: ownerScope.userId ?? undefined },
          { organizationId: ownerScope.organizationId ?? undefined },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!connection) {
      console.warn(
        `  ⚠︎ ${skill.slug}: no ACTIVE n8n connection for owner — skipped (register a connection, then re-run)`,
      );
      skipped++;
      continue;
    }

    const existing = await prisma.automation.findFirst({
      where: {
        deletedAt: null,
        connectionId: connection.id,
        name: skill.name,
      },
    });
    if (existing) {
      console.log(`  = ${skill.slug}: automation already exists (${existing.id}) — skipped`);
      skipped++;
      continue;
    }

    const blueprint = {
      ready: true,
      missingRequirements: [],
      name: skill.name,
      goal: skill.description ?? `Migrated capability: ${skill.name}`,
      summary: skill.description ?? '',
      description: `Migrated from Skill ${skill.slug} (PLAN Step 11)`,
      trigger: { type: 'webhook' as const, config: {} },
      steps: [
        {
          name: skill.name,
          action: `Execute migrated skill ${skill.slug}`,
          config: {
            migratedFromSkillId: skill.id,
            migratedFromSlug: skill.slug,
          },
        },
      ],
      integrations: [] as string[],
      inputContract: (skill.inputSchema as object | null) ?? {},
      outputContract: (skill.outputSchema as object | null) ?? {},
      riskNotes: ['Migrated from the legacy Skills system — verify workflow contents in n8n'],
    };

    if (!WRITE) {
      console.log(`  → ${skill.slug}: would create automation on connection ${connection.id}`);
      created++;
      continue;
    }

    await prisma.automation.create({
      data: {
        name: skill.name,
        description: blueprint.description,
        blueprint: blueprint as unknown as object,
        status: 'PENDING_APPROVAL',
        connectionId: connection.id,
        ...(ownerScope.organizationId
          ? { organizationId: ownerScope.organizationId }
          : { userId: ownerScope.userId! }),
      },
    });
    console.log(`  ✔ ${skill.slug}: automation created (PENDING_APPROVAL)`);
    created++;
  }

  console.log(`Done: ${created} created, ${skipped} skipped.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
