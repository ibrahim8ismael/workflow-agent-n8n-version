import type { AgentRunPhase } from '../agent-run-phase';

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
  /** Jaafar V2 lifecycle (§1). Null/undefined only on pre-V2 rows. */
  currentPhase?: AgentRunPhase | null;
  businessContext?: unknown;
  requirements?: unknown;
  assumptions?: unknown;
  constraints?: unknown;
  automationPlan?: unknown;
  workflowId?: string | null;
  workflowVersion?: number | null;
  validationResult?: unknown;
  executionResults?: unknown;
  repairAttempts?: unknown;
  metrics?: unknown;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost: number;
  durationMs?: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentRunTransition {
  id: string;
  runId: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  fromPhase?: AgentRunPhase | null;
  toPhase?: AgentRunPhase | null;
  reason?: string | null;
  createdAt: Date;
}
