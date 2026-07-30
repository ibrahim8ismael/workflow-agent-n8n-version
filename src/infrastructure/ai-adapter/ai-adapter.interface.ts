import type { z } from 'zod';

export interface AdapterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface AdapterTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AdapterToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AdapterGenerateParams {
  model: string;
  systemPrompt?: string;
  messages: AdapterMessage[];
  tools?: AdapterTool[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface AdapterGenerateResult {
  content: string;
  toolCalls?: AdapterToolCall[];
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AdapterStreamChunk {
  type: 'text' | 'tool-call' | 'error' | 'finish';
  content?: string;
  toolCall?: AdapterToolCall;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AdapterGenerateObjectParams {
  model: string;
  systemPrompt?: string;
  messages: AdapterMessage[];
  schema: z.ZodSchema<unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface AdapterGenerateObjectResult {
  object: unknown;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface IAIAdapter {
  generateText(params: AdapterGenerateParams): Promise<AdapterGenerateResult>;
  generateStream(params: AdapterGenerateParams): AsyncIterable<AdapterStreamChunk>;
  generateObject(params: AdapterGenerateObjectParams): Promise<AdapterGenerateObjectResult>;
}
