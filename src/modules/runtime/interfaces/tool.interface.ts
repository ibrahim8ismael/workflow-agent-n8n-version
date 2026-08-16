export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ToolExecutionMode =
  | 'knowledge'
  | 'memory'
  | 'ai'
  | 'hybrid'
  | 'n8n'
  | 'domain'
  | 'approval';

export interface ToolRetryPolicy {
  maxAttempts: number;
  retryableCodes: string[];
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  instructions?: string;
  executionMode: ToolExecutionMode;
  inputSchema: JsonValue;
  outputSchema: JsonValue;
  requiredPermissions: string[];
  requiredIntegrations: string[];
  requiresApproval: boolean;
  sideEffect?: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryPolicy: ToolRetryPolicy;
  idempotent: boolean;
  successCriteria: string[];
  permissionScope: string;
}

export interface ToolCall {
  callId: string;
  toolId: string;
  toolName: string;
  input: JsonValue;
  idempotencyKey?: string;
}

export interface ToolResult {
  callId: string;
  toolId: string;
  success: boolean;
  output?: JsonValue;
  error?: ToolError;
  durationMs: number;
}
