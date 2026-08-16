import type { JsonValue } from './tool.interface';

export type IdempotencyStatus = 'STARTED' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';

export interface IdempotencyRequest {
  runId: string;
  toolId: string;
  logicalAction: string;
  input: JsonValue;
}

export interface IdempotencyRecord {
  key: string;
  runId: string;
  toolId: string;
  logicalAction: string;
  inputHash: string;
  status: IdempotencyStatus;
  result?: JsonValue;
  error?: string;
}
