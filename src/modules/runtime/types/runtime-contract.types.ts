export type ExecutionMode = 'low' | 'medium' | 'high';

export type RuntimeIntent =
  | 'conversation'
  | 'automation_design'
  | 'task_execution'
  | 'general_question';

export type RuntimeStatus =
  | 'CREATED'
  | 'PREPARING'
  | 'PLANNING'
  | 'WAITING'
  | 'EXECUTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type RuntimeErrorCode =
  | 'INVALID_REQUEST'
  | 'MISSING_INPUT'
  | 'PERMISSION_DENIED'
  | 'INTEGRATION_NOT_READY'
  | 'TOOL_NOT_FOUND'
  | 'INVALID_TOOL_INPUT'
  | 'INVALID_TOOL_OUTPUT'
  | 'TOOL_TIMEOUT'
  | 'TOOL_RETRY_EXHAUSTED'
  | 'MODEL_TIMEOUT'
  | 'MODEL_PROVIDER_FAILURE'
  | 'APPROVAL_REQUIRED'
  | 'GRAPH_LIMIT_REACHED'
  | 'QUOTA_EXCEEDED'
  | 'CHECKPOINT_MISSING'
  | 'CHECKPOINT_FAILURE'
  | 'UNKNOWN_RUNTIME_FAILURE';

export type RuntimeEventName =
  | 'run.started'
  | 'graph.node.started'
  | 'graph.node.completed'
  | 'plan.created'
  | 'approval.required'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'token'
  | 'run.waiting'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

export interface RuntimeScope {
  userId?: string;
  organizationId?: string;
}

/**
 * Unanswered follow-up from a previous WAITING run in the same conversation.
 * Short user replies ("+2126…", "hello from Jaafar") are classified in a
 * vacuum when clarification turns leave no conversation history — attaching
 * the pending question keeps the original intent across turns.
 */
export interface PendingQuestionContext {
  question: string;
  priorUserMessage?: string;
  intent?: string;
}

/**
 * An automation design parked at the approval gate in the same conversation.
 * A short affirmative/negative chat reply ("ok i approve", "لا") routes to
 * resume()/reject() on this run instead of starting a fresh design.
 */
export interface PendingApprovalContext {
  runId: string;
  summary?: string;
}

export interface StartRunRequest extends RuntimeScope {
  userMessage: string;
  agentId: string;
  conversationId?: string;
  effort?: ExecutionMode;
  mode?: 'conversation' | 'automation_design' | 'execution';
  /**
   * Channel webhook dedup anchor (externalMessageId). Stored on the run
   * metadata so duplicate webhook deliveries can be detected and answered
   * idempotently instead of creating duplicate runs.
   */
  channelMessageId?: string;
}

export interface RuntimeUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
}

export interface RuntimeResult {
  runId: string;
  conversationId?: string;
  status: RuntimeStatus;
  response?: string;
  plan?: Record<string, unknown>;
  usage: RuntimeUsage;
  error?: RuntimeError;
  mode?: string;
}

export interface RuntimeError {
  code: RuntimeErrorCode;
  message: string;
  retryable: boolean;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
}

export interface RuntimeEventPayloads {
  'run.started': { status: 'CREATED' };
  'graph.node.started': { node: string };
  'graph.node.completed': { node: string; durationMs: number };
  'plan.created': { stepCount: number; requiresApproval: boolean };
  'approval.required': { reason: string };
  'tool.started': { callId: string; toolName: string };
  'tool.completed': { callId: string; toolName: string; durationMs: number };
  'tool.failed': { callId: string; toolName: string; error: RuntimeError };
  token: { content: string };
  'run.waiting': { reason: 'clarification' | 'approval' };
  'run.completed': { response: string; usage: RuntimeUsage };
  'run.failed': { error: RuntimeError };
  'run.cancelled': { reason?: string };
}

export type RuntimeEvent = {
  [TEventName in RuntimeEventName]: {
    type: TEventName;
    runId: string;
    occurredAt: string;
    payload: RuntimeEventPayloads[TEventName];
  };
}[RuntimeEventName];
