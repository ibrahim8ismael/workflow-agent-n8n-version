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

/** Per-automation binding into the client's n8n instance (PLAN Step 10). */
export interface ToolN8nBinding {
  baseUrl: string;
  webhookPath: string;
  secret?: string;
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
  /** Present for automation-sourced tools bound to a client n8n webhook. */
  binding?: ToolN8nBinding;
  /**
   * Set when the automation exists but cannot execute:
   * - INTEGRATION_UNAVAILABLE: n8n connection missing/not ACTIVE.
   * - CREDENTIALS_REQUIRED: workflow built but provider credentials missing
   *   (`readyToRun=false`). The workflow exists; connect credentials, refresh
   *   readiness, then execute.
   */
  unavailableReason?: 'INTEGRATION_UNAVAILABLE' | 'CREDENTIALS_REQUIRED';
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
