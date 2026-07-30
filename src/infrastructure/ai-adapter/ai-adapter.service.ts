import { Injectable } from '@nestjs/common';
import { generateObject, generateText, streamText } from 'ai';
import type {
  AdapterGenerateObjectParams,
  AdapterGenerateObjectResult,
  AdapterGenerateParams,
  AdapterGenerateResult,
  AdapterMessage,
  AdapterStreamChunk,
  IAIAdapter,
} from './ai-adapter.interface';
import { createVercelProvider, parseModelString } from './providers/vercel-provider.factory';

@Injectable()
export class AIAdapterService implements IAIAdapter {
  private createModel(modelString: string) {
    const { provider, modelId } = parseModelString(modelString);
    return createVercelProvider(provider, modelId);
  }

  private toCoreMessages(messages: AdapterMessage[]) {
    return messages.map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'tool' as const,
          content: [
            {
              type: 'tool-result' as const,
              toolCallId: msg.toolCallId!,
              toolName: msg.toolName!,
              output: msg.content,
              result: msg.content,
              isError: false,
            },
          ],
        };
      }
      return { role: msg.role as 'system' | 'user' | 'assistant', content: msg.content };
    });
  }

  async generateText(params: AdapterGenerateParams): Promise<AdapterGenerateResult> {
    const model = this.createModel(params.model);

    const result: Record<string, unknown> = (await generateText({
      model: model as never,
      system: params.systemPrompt,
      messages: this.toCoreMessages(params.messages) as never,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    } as never)) as unknown as Record<string, unknown>;

    const steps = result.steps as Array<Record<string, unknown>> | undefined;
    const parts = steps?.[0]?.parts as Array<Record<string, unknown>> | undefined;

    const toolCalls = (parts ?? [])
      .filter((p: Record<string, unknown>) => p.type === 'tool-call')
      .map((p: Record<string, unknown>) => ({
        id: p.toolCallId as string,
        name: p.toolName as string,
        args: p.args as Record<string, unknown>,
      }));

    const usage = result.usage as Record<string, number> | undefined;

    return {
      content: result.text as string,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: result.finishReason as string,
      usage: {
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
      },
    };
  }

  async *generateStream(params: AdapterGenerateParams): AsyncIterable<AdapterStreamChunk> {
    const model = this.createModel(params.model);

    const result: Record<string, unknown> = streamText({
      model: model as never,
      system: params.systemPrompt,
      messages: this.toCoreMessages(params.messages) as never,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    } as never) as unknown as Record<string, unknown>;

    const textStream = result.textStream as AsyncIterable<string>;

    for await (const chunk of textStream) {
      yield { type: 'text', content: chunk };
    }

    const usage = (await result.usage) as Record<string, number> | undefined;
    const finishReason = (await result.finishReason) as string | undefined;

    yield {
      type: 'finish',
      finishReason: finishReason ?? 'unknown',
      usage: {
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
      },
    };
  }

  async generateObject(params: AdapterGenerateObjectParams): Promise<AdapterGenerateObjectResult> {
    const model = this.createModel(params.model);

    const result: Record<string, unknown> = (await generateObject({
      model: model as never,
      system: params.systemPrompt,
      messages: this.toCoreMessages(params.messages) as never,
      schema: params.schema,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    } as never)) as unknown as Record<string, unknown>;

    const usage = result.usage as Record<string, number> | undefined;

    return {
      object: result.object as unknown,
      finishReason: result.finishReason as string,
      usage: {
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
      },
    };
  }
}
