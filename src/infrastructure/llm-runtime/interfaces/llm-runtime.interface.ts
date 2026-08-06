import type { ToolSet } from 'ai';
import { z } from 'zod';
import type {
  AdapterGenerateResult,
  AdapterMessage,
  AdapterStreamChunk,
} from '../../ai-adapter/ai-adapter.interface';

export type ExecutionMode = 'low' | 'medium' | 'high';

export interface LLMExecutionMetadata {
  executionId: string;
  mode: ExecutionMode;
  provider: string;
  model: string;
  durationMs: number;
  retries: number;
  estimatedCost: number;
}

export interface LLMGenerateParams {
  mode: ExecutionMode;
  systemPrompt?: string;
  messages: AdapterMessage[];
  sdkTools?: ToolSet;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface LLMGenerateResult extends AdapterGenerateResult {
  execution: LLMExecutionMetadata;
}

export interface LLMGenerateObjectParams extends Omit<LLMGenerateParams, 'sdkTools'> {
  schema: z.ZodSchema<unknown>;
}

export interface LLMGenerateObjectResult {
  object: unknown;
  finishReason: string;
  usage: LLMGenerateResult['usage'];
  execution: LLMExecutionMetadata;
}

export interface LLMStreamParams extends LLMGenerateParams {}

export interface LLMStreamChunk extends AdapterStreamChunk {
  execution?: LLMExecutionMetadata;
}

export interface ILLMRuntime {
  generateText(params: LLMGenerateParams): Promise<LLMGenerateResult>;
  generateObject(params: LLMGenerateObjectParams): Promise<LLMGenerateObjectResult>;
  generateStream(params: LLMStreamParams): AsyncIterable<LLMStreamChunk>;
}
