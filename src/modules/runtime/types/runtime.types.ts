import type { ExecutionMode } from '../../../infrastructure/llm-runtime/interfaces/llm-runtime.interface';

export enum RuntimeMode {
  CONVERSATION = 'conversation',
  EMPLOYEE_DESIGN = 'employee_design',
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
}
