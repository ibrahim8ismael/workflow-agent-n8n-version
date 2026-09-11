import type { ExecutionMode } from '../../../infrastructure/llm-runtime/interfaces/llm-runtime.interface';

export enum RuntimeMode {
  CONVERSATION = 'conversation',
  AUTOMATION_DESIGN = 'automation_design',
  EXECUTION = 'execution',
}

export interface RuntimeRequest {
  runId?: string;
  userMessage: string;
  agentId: string;
  conversationId?: string;
  effort?: ExecutionMode;
  userId?: string;
  organizationId?: string;
  mode: RuntimeMode;
  /** Channel webhook dedup anchor (externalMessageId) — stored on run metadata. */
  channelMessageId?: string;
}
