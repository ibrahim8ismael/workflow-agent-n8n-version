export interface IMemory {
  id: string;
  agentId: string;
  type: string;
  key: string;
  content: string;
  metadata?: Record<string, unknown>;
  userId?: string;
  organizationId?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
