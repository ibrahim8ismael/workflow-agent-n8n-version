export const RUN_STATUS = {
  CREATED: 'CREATED',
  PREPARING: 'PREPARING',
  PLANNING: 'PLANNING',
  EXECUTING: 'EXECUTING',
  WAITING: 'WAITING',
  GENERATING: 'GENERATING',
  PERSISTING: 'PERSISTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  TIMEOUT: 'TIMEOUT',
} as const;

export type RunStatus = (typeof RUN_STATUS)[keyof typeof RUN_STATUS];

export interface IRun {
  id: string;
  agentId: string;
  conversationId?: string;
  userId?: string;
  organizationId?: string;
  status: RunStatus;
  plan?: Record<string, unknown>;
  result?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  durationMs?: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
