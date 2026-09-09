import type { JaafarModelCall } from '../types/jaafar-model.types';
import type { JaafarPlan } from '../types/jaafar-plan.types';
import type { JaafarUnderstanding } from '../types/jaafar-understanding.types';
import type {
  ExecutionMode,
  RuntimeError,
  RuntimeIntent,
  RuntimeStatus,
} from '../types/runtime-contract.types';
import type { ToolCall, ToolDefinition, ToolResult } from './tool.interface';

export const JAAFAR_STATE_SCHEMA_VERSION = 1;

export interface JaafarMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface JaafarState {
  schemaVersion: number;
  run: {
    runId: string;
    agentId: string;
    userId?: string;
    organizationId?: string;
    conversationId?: string;
    status: RuntimeStatus;
  };
  request: {
    userMessage: string;
    effort: ExecutionMode;
    receivedAt: string;
  };
  conversation: {
    history: JaafarMessage[];
    response?: string;
  };
  understanding: {
    intent?: RuntimeIntent;
    goal?: string;
    businessContext?: string;
    requirements: string[];
    missingInputs: string[];
    confidence?: number;
    structured?: JaafarUnderstanding;
    clarificationRequired?: boolean;
    clarificationQuestion?: string;
  };
  automationDesign?: Record<string, unknown>;
  context: {
    skills: ToolDefinition[];
    memoryReferences: string[];
    knowledgeReferences: string[];
    integrationReferences: string[];
  };
  modelCalls: JaafarModelCall[];
  plan?: JaafarPlan;
  approval: {
    status: 'not_required' | 'pending' | 'approved' | 'rejected';
    reason?: string;
    requestedAt?: string;
    resolvedAt?: string;
  };
  execution: {
    stepIndex: number;
    toolCalls: ToolCall[];
    results: ToolResult[];
    completed: boolean;
  };
  reflection?: {
    outcome: 'success' | 'partial' | 'failed';
    summary: string;
    learningCandidates: string[];
  };
  errors: RuntimeError[];
}
