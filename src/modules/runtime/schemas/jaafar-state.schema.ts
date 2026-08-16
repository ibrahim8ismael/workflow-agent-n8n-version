import { z } from 'zod';
import { blueprintSchema } from '../employee-design/employee-blueprint.schema';
import {
  JAAFAR_STATE_SCHEMA_VERSION,
  type JaafarState,
} from '../interfaces/jaafar-state.interface';
import type { JaafarModelCall } from '../types/jaafar-model.types';
import type { JaafarUnderstanding } from '../types/jaafar-understanding.types';
import { jaafarPlanSchema } from './jaafar-plan.schema';

const modelCallSchema: z.ZodType<JaafarModelCall> = z.object({
  purpose: z.enum(['understanding', 'planning', 'response', 'reflection']),
  execution: z.object({
    executionId: z.string(),
    mode: z.enum(['low', 'medium', 'high']),
    provider: z.string(),
    model: z.string(),
    durationMs: z.number().nonnegative(),
    retries: z.number().int().nonnegative(),
    estimatedCost: z.number().nonnegative(),
  }),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
});

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

const toolDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  executionMode: z.enum(['knowledge', 'memory', 'ai', 'hybrid', 'n8n', 'approval']),
  inputSchema: jsonValueSchema,
  outputSchema: jsonValueSchema,
  requiredPermissions: z.array(z.string()),
  requiredIntegrations: z.array(z.string()),
  requiresApproval: z.boolean(),
  sideEffect: z.boolean().optional(),
  timeoutMs: z.number().nonnegative(),
  maxRetries: z.number().int().nonnegative(),
  retryPolicy: z.object({
    maxAttempts: z.number().int().positive(),
    retryableCodes: z.array(z.string()),
  }),
  idempotent: z.boolean(),
  successCriteria: z.array(z.string()),
  permissionScope: z.string(),
});

const toolCallSchema = z.object({
  callId: z.string(),
  toolId: z.string(),
  toolName: z.string(),
  input: jsonValueSchema,
  idempotencyKey: z.string().optional(),
});

const toolResultSchema = z.object({
  callId: z.string(),
  toolId: z.string(),
  success: z.boolean(),
  output: jsonValueSchema.optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  durationMs: z.number().nonnegative(),
});

const understandingSchema: z.ZodType<JaafarUnderstanding> = z.object({
  intent: z.enum(['conversation', 'employee_design', 'task_execution', 'general_question']),
  goal: z.string().min(1),
  businessContext: z.string(),
  requirements: z.array(
    z.object({
      field: z.string().min(1),
      value: z.string(),
      required: z.boolean(),
      source: z.enum(['user', 'history', 'inferred', 'retrieved']),
    }),
  ),
  missingInputs: z.array(
    z.object({
      field: z.string().min(1),
      description: z.string().min(1),
      question: z.string().min(1),
      required: z.boolean(),
    }),
  ),
  confidence: z.number().min(0).max(1),
  clarificationRequired: z.boolean(),
  clarificationQuestion: z.string().optional(),
});

export const jaafarStateSchema = z.object({
  schemaVersion: z.literal(JAAFAR_STATE_SCHEMA_VERSION),
  run: z.object({
    runId: z.string(),
    agentId: z.string(),
    userId: z.string().optional(),
    organizationId: z.string().optional(),
    conversationId: z.string().optional(),
    status: z.enum([
      'CREATED',
      'PREPARING',
      'PLANNING',
      'WAITING',
      'EXECUTING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ]),
  }),
  request: z.object({
    userMessage: z.string(),
    effort: z.enum(['low', 'medium', 'high']),
    receivedAt: z.string(),
  }),
  conversation: z.object({
    history: z.array(
      z.object({ role: z.enum(['user', 'assistant', 'system']), content: z.string() }),
    ),
    response: z.string().optional(),
  }),
  understanding: z.object({
    intent: z
      .enum(['conversation', 'employee_design', 'task_execution', 'general_question'])
      .optional(),
    goal: z.string().optional(),
    businessContext: z.string().optional(),
    requirements: z.array(z.string()),
    missingInputs: z.array(z.string()),
    confidence: z.number().min(0).max(1).optional(),
    structured: understandingSchema.optional(),
    clarificationRequired: z.boolean().optional(),
    clarificationQuestion: z.string().optional(),
  }),
  employeeDesign: z
    .object({
      status: z.enum(['GATHERING_REQUIREMENTS', 'READY_FOR_REVIEW', 'CREATED']),
      approvalStatus: z.enum(['NOT_READY', 'READY', 'APPROVED']),
      blueprint: blueprintSchema.optional(),
      missingRequirements: z.array(z.string()),
      blueprintRevision: z.string().optional(),
      createdEmployeeId: z.string().optional(),
      sourceConversationId: z.string().optional(),
      sourceDesignRunId: z.string().optional(),
    })
    .optional(),
  context: z.object({
    skills: z.array(toolDefinitionSchema),
    memoryReferences: z.array(z.string()),
    knowledgeReferences: z.array(z.string()),
    integrationReferences: z.array(z.string()),
  }),
  modelCalls: z.array(modelCallSchema),
  plan: jaafarPlanSchema.optional(),
  approval: z.object({
    status: z.enum(['not_required', 'pending', 'approved', 'rejected']),
    reason: z.string().optional(),
    requestedAt: z.string().optional(),
    resolvedAt: z.string().optional(),
  }),
  execution: z.object({
    stepIndex: z.number().int().nonnegative(),
    toolCalls: z.array(toolCallSchema),
    results: z.array(toolResultSchema),
    completed: z.boolean(),
  }),
  reflection: z
    .object({
      outcome: z.enum(['success', 'partial', 'failed']),
      summary: z.string(),
      learningCandidates: z.array(z.string()),
    })
    .optional(),
  errors: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    }),
  ),
});

export function serializeJaafarState(state: JaafarState): string {
  return JSON.stringify(jaafarStateSchema.parse(state));
}

export function deserializeJaafarState(serialized: string): JaafarState {
  const parsed: unknown = JSON.parse(serialized);
  return jaafarStateSchema.parse(parsed) as JaafarState;
}
