import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function generateId(): string {
  return randomUUID();
}

async function createPlanQuota(
  planId: string,
  quota: {
    aiCreditsPerMonth: bigint;
    operationsPerMonth: bigint;
    maxAgents: number;
    maxTeamMembers: number;
    maxKnowledgeBases: number;
    storageBytes: bigint;
    maxChannels: number;
    maxIntegrations?: number;
    maxApiKeys?: number;
  },
) {
  return prisma.planQuota.upsert({
    where: { planId },
    update: quota,
    create: { id: generateId(), planId, ...quota },
  });
}

async function createFeatureFlag(
  key: string,
  name: string,
  enabled: boolean,
  description?: string,
) {
  return prisma.featureFlag.upsert({
    where: { key },
    update: { name, enabled, description },
    create: { id: generateId(), key, name, enabled, description },
  });
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

  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@woops.ai' },
    update: {},
    create: {
      id: generateId(),
      email: 'demo@woops.ai',
      name: 'Demo User',
      role: 'USER',
      isActive: true,
      emailVerifiedAt: new Date(),
    },
  });
  console.log('  ✓ Demo User created');

  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      id: generateId(),
      name: 'Demo Organization',
      slug: 'demo-org',
    },
  });
  console.log('  ✓ Demo Organization created');

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: demoUser.id } },
    update: {},
    create: {
      id: generateId(),
      organizationId: org.id,
      userId: demoUser.id,
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

  const planRecords = await prisma.subscriptionPlan.findMany({ orderBy: { price: 'asc' } });
  const planQuotas = [
    {
      aiCreditsPerMonth: BigInt(1000),
      operationsPerMonth: BigInt(5000),
      maxAgents: 1,
      maxTeamMembers: 1,
      maxKnowledgeBases: 1,
      storageBytes: BigInt(104857600),
      maxChannels: 1,
      maxIntegrations: 3,
      maxApiKeys: 0,
    },
    {
      aiCreditsPerMonth: BigInt(20000),
      operationsPerMonth: BigInt(100000),
      maxAgents: 5,
      maxTeamMembers: 3,
      maxKnowledgeBases: 5,
      storageBytes: BigInt(1073741824),
      maxChannels: 10,
      maxIntegrations: 100,
      maxApiKeys: 10,
    },
    {
      aiCreditsPerMonth: BigInt(100000),
      operationsPerMonth: BigInt(500000),
      maxAgents: 20,
      maxTeamMembers: 10,
      maxKnowledgeBases: 100,
      storageBytes: BigInt(10737418240),
      maxChannels: 50,
      maxIntegrations: 500,
      maxApiKeys: 50,
    },
    {
      aiCreditsPerMonth: BigInt(1000000),
      operationsPerMonth: BigInt(5000000),
      maxAgents: 100,
      maxTeamMembers: 100,
      maxKnowledgeBases: 1000,
      storageBytes: BigInt(1099511627776),
      maxChannels: 500,
      maxIntegrations: 5000,
      maxApiKeys: 500,
    },
  ];

  for (let i = 0; i < planRecords.length; i++) {
    await createPlanQuota(planRecords[i].id, planQuotas[i]);
  }
  console.log('  ✓ Plan Quotas created');

  const topUpPackages = [
    {
      name: 'Starter Pack',
      description: '1,000 AI Credits',
      priceUsd: 9.99,
      creditsAmount: BigInt(1000),
      operationsAmount: BigInt(5000),
      sortOrder: 1,
    },
    {
      name: 'Growth Pack',
      description: '10,000 AI Credits',
      priceUsd: 49.99,
      creditsAmount: BigInt(10000),
      operationsAmount: BigInt(50000),
      sortOrder: 2,
    },
    {
      name: 'Scale Pack',
      description: '50,000 AI Credits',
      priceUsd: 199.99,
      creditsAmount: BigInt(50000),
      operationsAmount: BigInt(250000),
      sortOrder: 3,
    },
    {
      name: 'Enterprise Pack',
      description: '250,000 AI Credits',
      priceUsd: 799.99,
      creditsAmount: BigInt(250000),
      operationsAmount: BigInt(1250000),
      sortOrder: 4,
    },
  ];

  for (const pkg of topUpPackages) {
    await prisma.topUpPackage.upsert({
      where: { id: pkg.name.toLowerCase().replace(/\s+/g, '-') },
      update: pkg,
      create: { id: pkg.name.toLowerCase().replace(/\s+/g, '-'), ...pkg },
    });
  }
  console.log('  ✓ Top-Up Packages created');

  const flags = [
    {
      key: 'ai-builder',
      name: 'AI Builder',
      enabled: true,
      description: 'Enable AI-powered agent builder',
    },
    {
      key: 'advanced-analytics',
      name: 'Advanced Analytics',
      enabled: false,
      description: 'Enable advanced analytics dashboard',
    },
    {
      key: 'custom-domains',
      name: 'Custom Domains',
      enabled: false,
      description: 'Allow custom domain configuration',
    },
    {
      key: 'webhooks',
      name: 'Webhooks',
      enabled: true,
      description: 'Enable webhook integrations',
    },
    { key: 'api-access', name: 'API Access', enabled: true, description: 'Enable REST API access' },
    {
      key: 'byok',
      name: 'Bring Your Own Key',
      enabled: false,
      description: 'Allow users to bring their own AI provider keys',
    },
    {
      key: 'impersonation',
      name: 'Admin Impersonation',
      enabled: true,
      description: 'Allow system administrators to impersonate users',
    },
  ];

  for (const flag of flags) {
    await createFeatureFlag(flag.key, flag.name, flag.enabled, flag.description);
  }
  console.log('  ✓ Feature Flags created');

  await prisma.wallet.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      id: generateId(),
      userId: demoUser.id,
      balanceCredits: BigInt(10000),
      lifetimeCredits: BigInt(10000),
    },
  });
  console.log('  ✓ Demo User Wallet created');

  // MVP Skills
  const searchCustomerSkill = await prisma.skill.upsert({
    where: { slug: 'search_customer' },
    update: {
      executionMode: 'N8N_WORKFLOW',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
    },
    create: {
      id: generateId(),
      name: 'Search Customer',
      slug: 'search_customer',
      description: 'Search customer records, deals, and status from the CRM.',
      category: 'CRM',
      executionMode: 'N8N_WORKFLOW',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Customer name, email, or company' },
          email: { type: 'string', description: 'Exact customer email address' },
          customerId: { type: 'string', description: 'Unique customer identifier' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          customerId: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string' },
          plan: { type: 'string' },
          status: { type: 'string' },
        },
      },
      metadata: { requiredIntegrations: ['hubspot'], version: 1 },
      organizationId: org.id,
      userId: demoUser.id,
    },
  });

  const sendChannelMessageSkill = await prisma.skill.upsert({
    where: { slug: 'send_channel_message' },
    update: {
      executionMode: 'N8N_WORKFLOW',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
    },
    create: {
      id: generateId(),
      name: 'Send Channel Message',
      slug: 'send_channel_message',
      description: 'Send outbound messaging reply to WhatsApp or Slack channel.',
      category: 'COMMUNICATION',
      executionMode: 'N8N_WORKFLOW',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      inputSchema: {
        type: 'object',
        properties: {
          channelType: { type: 'string' },
          recipient: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['channelType', 'recipient', 'content'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          delivered: { type: 'boolean' },
          messageId: { type: 'string' },
        },
      },
      metadata: { requiredIntegrations: ['whatsapp'], version: 1 },
      organizationId: org.id,
      userId: demoUser.id,
    },
  });

  const customerOrderInquirySkill = await prisma.skill.upsert({
    where: { slug: 'customer_order_inquiry' },
    update: {
      executionMode: 'N8N_WORKFLOW',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
    },
    create: {
      id: generateId(),
      name: 'Customer Order & Return Intelligence',
      slug: 'customer_order_inquiry',
      description:
        'Look up customer CRM tier, active shipment tracking, and calculate return window eligibility.',
      category: 'CRM',
      executionMode: 'N8N_WORKFLOW',
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      inputSchema: {
        type: 'object',
        properties: {
          email: { type: 'string', description: 'Customer email address' },
          orderId: { type: 'string', description: 'Optional order identifier' },
          query: { type: 'string', description: 'Customer inquiry' },
        },
      },
      outputSchema: {
        type: 'object',
        properties: {
          customer: { type: 'object' },
          activeOrder: { type: 'object' },
          returnPolicy: { type: 'object' },
        },
      },
      metadata: { requiredIntegrations: ['hubspot', 'shopify'], version: 1 },
      organizationId: org.id,
      userId: demoUser.id,
    },
  });
  console.log('  ✓ MVP Skills seeded');

  // MVP Customer Support Employee (Jaafar / Support Specialist)
  const supportEmployee = await prisma.agent.upsert({
    where: { id: 'agent_jaafar_demo' },
    update: {},
    create: {
      id: 'agent_jaafar_demo',
      name: 'Jaafar Support Specialist',
      description:
        'Autonomous customer support employee capable of looking up customer CRM data and drafting replies.',
      personality: 'Helpful, concise, friendly, and solution-oriented.',
      instructions:
        'You are Jaafar, an AI Support Employee for Woops. When a customer asks about their account or subscription, use the search_customer skill to look up their record in the CRM and provide an accurate, courteous response.',
      model: 'gpt-4o-mini',
      status: 'PUBLISHED',
      organizationId: org.id,
      userId: demoUser.id,
    },
  });

  await prisma.agentSkill.upsert({
    where: { agentId_skillId: { agentId: supportEmployee.id, skillId: searchCustomerSkill.id } },
    update: { enabled: true },
    create: {
      id: generateId(),
      agentId: supportEmployee.id,
      skillId: searchCustomerSkill.id,
      name: searchCustomerSkill.name,
      enabled: true,
    },
  });

  await prisma.agentSkill.upsert({
    where: {
      agentId_skillId: { agentId: supportEmployee.id, skillId: sendChannelMessageSkill.id },
    },
    update: { enabled: true },
    create: {
      id: generateId(),
      agentId: supportEmployee.id,
      skillId: sendChannelMessageSkill.id,
      name: sendChannelMessageSkill.name,
      enabled: true,
    },
  });

  await prisma.agentSkill.upsert({
    where: {
      agentId_skillId: { agentId: supportEmployee.id, skillId: customerOrderInquirySkill.id },
    },
    update: { enabled: true },
    create: {
      id: generateId(),
      agentId: supportEmployee.id,
      skillId: customerOrderInquirySkill.id,
      name: customerOrderInquirySkill.name,
      enabled: true,
    },
  });
  console.log('  ✓ MVP Support AI Employee created & skills attached');

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
