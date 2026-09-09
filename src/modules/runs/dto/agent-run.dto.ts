import { z } from 'zod';
import { AGENT_RUN_PHASE } from '../agent-run-phase';

const agentRunPhaseSchema = z.enum([
  AGENT_RUN_PHASE.UNDERSTANDING,
  AGENT_RUN_PHASE.PLANNING,
  AGENT_RUN_PHASE.BUILDING,
  AGENT_RUN_PHASE.STATIC_VALIDATION,
  AGENT_RUN_PHASE.EXECUTING,
  AGENT_RUN_PHASE.RUNTIME_VALIDATION,
  AGENT_RUN_PHASE.COMPLETED,
  AGENT_RUN_PHASE.FAILED,
  AGENT_RUN_PHASE.DIAGNOSING,
  AGENT_RUN_PHASE.REPAIRING,
]);

export const createAgentRunSchema = z.object({
  agentId: z.string(),
  conversationId: z.string().optional(),
  userId: z.string().optional(),
  organizationId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  businessContext: z.unknown().optional(),
  requirements: z.unknown().optional(),
  assumptions: z.unknown().optional(),
  constraints: z.unknown().optional(),
});

export type CreateAgentRunDto = z.infer<typeof createAgentRunSchema>;

export const advanceAgentRunSchema = z.object({
  toPhase: agentRunPhaseSchema.optional(),
  toStatus: z.string().optional(),
  reason: z.string().max(500).optional(),
  /** Optimistic-concurrency guard — rejects when the row moved underneath us. */
  expectedVersion: z.number().int().positive().optional(),
});

export type AdvanceAgentRunDto = z.infer<typeof advanceAgentRunSchema>;
