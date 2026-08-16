export interface IAgent {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
  personality?: string;
  model: string;
  status: string;
  userId?: string;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignedAgentSkill {
  id: string;
  skillId: string;
  name: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  skill: {
    id: string;
    name: string;
    slug: string;
    description?: string;
    executionMode: string;
    status: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    instructions?: string;
    timeout?: number;
    retryPolicy?: Record<string, unknown>;
    successCriteria?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    userId?: string;
    organizationId?: string;
  };
}
