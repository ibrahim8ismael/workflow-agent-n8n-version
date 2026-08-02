import type { Schema } from '@ai-sdk/provider-utils';
import { asSchema } from '@ai-sdk/provider-utils';
import { Injectable } from '@nestjs/common';
import type { LanguageModel, LanguageModelUsage, ModelMessage, ToolCallPart } from 'ai';
import { generateObject, generateText, streamText } from 'ai';
import { z } from 'zod';
import type {
  AdapterGenerateObjectParams,
  AdapterGenerateObjectResult,
  AdapterGenerateParams,
  AdapterGenerateResult,
  AdapterMessage,
  AdapterStreamChunk,
  AdapterToolCall,
  IAIAdapter,
} from './ai-adapter.interface';
import { createVercelProvider, parseModelString } from './providers/vercel-provider.factory';

@Injectable()
export class AIAdapterService implements IAIAdapter {
  private toSdkSchema(schema: z.ZodSchema<unknown>): Schema<unknown> {
    return asSchema(schema as unknown as Schema<unknown>);
  }

  private createModel(modelString: string): LanguageModel {
    const { provider, modelId } = parseModelString(modelString);
    return createVercelProvider(provider, modelId);
  }

  private toCoreMessages(messages: AdapterMessage[]): ModelMessage[] {
    return messages.map((msg): ModelMessage => {
      if (msg.role === 'tool') {
        return {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: msg.toolCallId ?? '',
              toolName: msg.toolName ?? '',
              output: { type: 'text', value: msg.content },
            },
          ],
        };
      }
      return { role: msg.role, content: msg.content };
    });
  }

  private toUsage(usage?: LanguageModelUsage): AdapterGenerateResult['usage'] {
    return {
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
    };
  }

  async generateText(params: AdapterGenerateParams): Promise<AdapterGenerateResult> {
    const result = await generateText({
      model: this.createModel(params.model),
      system: params.systemPrompt,
      messages: this.toCoreMessages(params.messages),
      tools: params.sdkTools,
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
    });

    const toolCalls: AdapterToolCall[] = (result.steps[0]?.content ?? [])
      .filter((part): part is ToolCallPart => part.type === 'tool-call')
      .map((part) => ({
        id: part.toolCallId,
        name: part.toolName,
        args: (part.input ?? {}) as Record<string, unknown>,
      }));

    return {
      content: result.text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: result.finishReason,
      usage: this.toUsage(result.usage),
    };
  }

  async *generateStream(params: AdapterGenerateParams): AsyncIterable<AdapterStreamChunk> {
    const result = streamText({
      model: this.createModel(params.model),
      system: params.systemPrompt,
      messages: this.toCoreMessages(params.messages),
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
    });

    for await (const chunk of result.textStream) {
      yield { type: 'text', content: chunk };
    }

    const usage = await result.usage;
    const finishReason = await result.finishReason;

    yield { type: 'finish', finishReason, usage: this.toUsage(usage) };
  }

  async generateObject(params: AdapterGenerateObjectParams): Promise<AdapterGenerateObjectResult> {
    const result = await generateObject({
      model: this.createModel(params.model),
      system: params.systemPrompt,
      messages: this.toCoreMessages(params.messages),
      schema: this.toSdkSchema(params.schema),
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
    });

    return {
      object: result.object,
      finishReason: result.finishReason,
      usage: this.toUsage(result.usage),
    };
  }
}
