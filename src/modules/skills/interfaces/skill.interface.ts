export interface ISkill {
  id: string;
  name: string;
  slug: string;
  description?: string;
  category?: string;
  version: number;
  executionMode: string;
  status: string;
  visibility: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  instructions?: string;
  timeout?: number;
  retryPolicy?: Record<string, unknown>;
  successCriteria?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  userId?: string;
  organizationId?: string;
  createdAt: Date;
  updatedAt: Date;
}
