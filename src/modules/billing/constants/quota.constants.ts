export const FREE_PLAN_QUOTA = {
  aiCreditsPerMonth: 1000,
  operationsPerMonth: 5000,
  maxAgents: 1,
  maxTeamMembers: 1,
  maxKnowledgeBases: 1,
  storageBytes: 104857600,
  maxChannels: 1,
  maxIntegrations: 3,
  maxApiKeys: 0,
} as const;

export const PRO_PLAN_QUOTA = {
  aiCreditsPerMonth: 20000,
  operationsPerMonth: 100000,
  maxAgents: 5,
  maxTeamMembers: 3,
  maxKnowledgeBases: 5,
  storageBytes: 1073741824,
  maxChannels: 10,
  maxIntegrations: 100,
  maxApiKeys: 10,
} as const;

export const BUSINESS_PLAN_QUOTA = {
  aiCreditsPerMonth: 100000,
  operationsPerMonth: 500000,
  maxAgents: 20,
  maxTeamMembers: 10,
  maxKnowledgeBases: 100,
  storageBytes: 10737418240,
  maxChannels: 50,
  maxIntegrations: 500,
  maxApiKeys: 50,
} as const;
