import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

function generateId(): string {
  return randomUUID();
}

async function main() {
  console.log('Seeding database...');

  const adminId = generateId();
  await prisma.user.upsert({
    where: { email: 'admin@woops.ai' },
    update: {},
    create: {
      id: adminId,
      email: 'admin@woops.ai',
      name: 'Platform Administrator',
      role: 'SYSTEM_ADMINISTRATOR',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });
  console.log('  ✓ System Administrator created');

  const demoUserId = generateId();
  await prisma.user.upsert({
    where: { email: 'demo@woops.ai' },
    update: {},
    create: {
      id: demoUserId,
      email: 'demo@woops.ai',
      name: 'Demo User',
      role: 'USER',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });
  console.log('  ✓ Demo User created');

  const orgId = generateId();
  await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      id: orgId,
      name: 'Demo Organization',
      slug: 'demo-org',
    },
  });
  console.log('  ✓ Demo Organization created');

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: orgId, userId: demoUserId } },
    update: {},
    create: {
      id: generateId(),
      organizationId: orgId,
      userId: demoUserId,
      role: 'OWNER',
      joinedAt: new Date(),
    },
  });
  console.log('  ✓ Demo Organization Owner created');

  const plans = [
    {
      tier: 'FREE' as const,
      name: 'Free',
      price: 0,
      interval: 'month',
      features: { agents: 1, conversations: 100, messages: 1000, members: 1 },
    },
    {
      tier: 'PRO' as const,
      name: 'Pro',
      price: 29,
      interval: 'month',
      features: { agents: 5, conversations: 1000, messages: 10000, members: 5 },
    },
    {
      tier: 'BUSINESS' as const,
      name: 'Business',
      price: 99,
      interval: 'month',
      features: { agents: 20, conversations: 10000, messages: 100000, members: 20 },
    },
    {
      tier: 'ENTERPRISE' as const,
      name: 'Enterprise',
      price: 299,
      interval: 'month',
      features: { agents: -1, conversations: -1, messages: -1, members: -1 },
    },
  ];

  for (const plan of plans) {
    await prisma.subscriptionPlan.upsert({
      where: { tier: plan.tier },
      update: {
        name: plan.name,
        price: plan.price,
        interval: plan.interval,
        features: plan.features,
      },
      create: {
        id: generateId(),
        tier: plan.tier,
        name: plan.name,
        price: plan.price,
        currency: 'USD',
        interval: plan.interval,
        features: plan.features,
      },
    });
  }
  console.log('  ✓ Subscription Plans created');

  console.log('\nSeed completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
