import type { JsonValue, ToolDefinition } from '../interfaces/tool.interface';

export const JAAFAR_PLAN_SCHEMA_VERSION = 1;

export interface JaafarPlanStep {
  stepId: string;
  toolId: string;
  order: number;
  input: JsonValue;
  required: boolean;
  dependsOn?: string[];
}

export interface JaafarPlan {
  schemaVersion: number;
  goal: string;
  steps: JaafarPlanStep[];
  successCriteria: string[];
  requiresApproval: boolean;
  approvalReasons?: string[];
}

export type PlanValidationErrorCode =
  | 'INVALID_PLAN'
  | 'TOOL_NOT_FOUND'
  | 'INVALID_TOOL_INPUT'
  | 'MISSING_INPUT'
  | 'APPROVAL_REQUIRED';

export interface PlanValidationError {
  code: PlanValidationErrorCode;
  message: string;
  stepId?: string;
  toolId?: string;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: PlanValidationError[];
}

export function findPlanTool(tools: ToolDefinition[], toolId: string): ToolDefinition | undefined {
  return tools.find((tool) => tool.id === toolId || tool.name === toolId || tool.slug === toolId);
}
