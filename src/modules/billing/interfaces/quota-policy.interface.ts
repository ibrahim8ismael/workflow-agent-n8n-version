export interface QuotaPolicyInterface {
  getQuotaLimits(planId: string): Promise<QuotaLimits>;
  checkQuota(
    subscriptionId: string,
    resourceType: 'ai_credits' | 'operations',
    requestedAmount: bigint,
  ): Promise<QuotaCheck>;
  getCurrentUsage(
    subscriptionId: string,
    resourceType: 'ai_credits' | 'operations',
  ): Promise<bigint>;
}

export interface QuotaLimits {
  aiCreditsLimit: bigint;
  operationsLimit: bigint;
  maxAgents: number;
  maxTeamMembers: number;
  maxKnowledgeBases: number;
  storageBytes: bigint;
  maxChannels: number;
  maxIntegrations: number | null;
  maxApiKeys: number | null;
}

export interface QuotaCheck {
  allowed: boolean;
  reason?: string;
  currentUsage: bigint;
  limit: bigint;
}
