import type { ToolDefinition } from './tool.interface';

export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';

export interface ApprovalRequirement {
  required: boolean;
  reason?: string;
}

export interface ApprovalEvaluation {
  tool: ToolDefinition;
  requirement: ApprovalRequirement;
  readOnly: boolean;
}
