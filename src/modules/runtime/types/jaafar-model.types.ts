import type { LLMExecutionMetadata } from '../../../infrastructure/llm-runtime/interfaces/llm-runtime.interface';

export type JaafarModelCallPurpose = 'understanding' | 'planning' | 'response' | 'reflection';

export interface JaafarModelCall {
  purpose: JaafarModelCallPurpose;
  execution: LLMExecutionMetadata;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}
