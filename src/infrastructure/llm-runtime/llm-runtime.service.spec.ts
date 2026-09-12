import { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIAdapterService } from '../ai-adapter/ai-adapter.service';
import { LLMRuntimeService } from './llm-runtime.service';

describe('LLMRuntimeService', () => {
  let service: LLMRuntimeService;
  const adapter = {
    generateText: vi.fn(),
    generateObject: vi.fn(),
    generateStream: vi.fn(),
  } as unknown as AIAdapterService;
  const config = {
    get: vi.fn((_: string, fallback?: unknown) => fallback),
  } as unknown as ConfigService;

  const textResult = {
    content: 'answer',
    toolCalls: undefined,
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(config.get).mockImplementation((_: string, fallback?: unknown) => fallback as never);
    vi.mocked(adapter.generateText).mockResolvedValue(textResult as never);
    vi.mocked(adapter.generateObject).mockResolvedValue({
      object: { answer: true },
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    } as never);
    service = new LLMRuntimeService(adapter, config);
  });

  it('resolves the low execution mode without exposing a model to callers', async () => {
    const result = await service.generateText({ mode: 'low', messages: [] });

    expect(adapter.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai:gpt-4o-mini' }),
    );
    expect(result.execution).toMatchObject({
      mode: 'low',
      provider: 'openai',
      model: 'gpt-4o-mini',
      retries: 0,
    });
  });

  it('retries temporary provider failures', async () => {
    vi.mocked(adapter.generateText)
      .mockRejectedValueOnce(new Error('temporary provider unavailable'))
      .mockResolvedValueOnce(textResult as never);

    const result = await service.generateText({ mode: 'medium', messages: [], maxRetries: 1 });

    expect(adapter.generateText).toHaveBeenCalledTimes(2);
    expect(result.execution.retries).toBe(1);
  });

  it('fails over to the configured fallback provider', async () => {
    vi.mocked(config.get).mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'LLM_LOW_FALLBACKS') return 'anthropic:claude-3-haiku';
      return fallback as never;
    });
    vi.mocked(adapter.generateText)
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce(textResult as never);

    const result = await service.generateText({ mode: 'low', messages: [], maxRetries: 0 });

    expect(adapter.generateText).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'anthropic:claude-3-haiku' }),
    );
    expect(result.execution.provider).toBe('anthropic');
    expect(result.execution.retries).toBe(1);
  });

  it('does not retry authentication failures', async () => {
    vi.mocked(adapter.generateText).mockRejectedValue(new Error('authentication failed'));

    await expect(
      service.generateText({ mode: 'low', messages: [], maxRetries: 3 }),
    ).rejects.toThrow('authentication failed');
    expect(adapter.generateText).toHaveBeenCalledTimes(1);
  });

  it('retries structured-output generation failures on the same candidate', async () => {
    vi.mocked(adapter.generateObject)
      .mockRejectedValueOnce(
        new Error(
          'No object generated: the model did not return a response. [structured-output:SCHEMA_INVALID]',
        ),
      )
      .mockResolvedValueOnce({
        object: { answer: true },
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      } as never);

    const result = await service.generateObject({
      mode: 'medium',
      messages: [],
      schema: {} as never,
      maxRetries: 1,
    });

    expect(adapter.generateObject).toHaveBeenCalledTimes(2);
    expect(result.object).toEqual({ answer: true });
    expect(result.execution.retries).toBe(1);
  });

  it('falls through to the fallback ladder when structured-output failures persist', async () => {
    vi.mocked(config.get).mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'LLM_LOW_FALLBACKS') return 'anthropic:claude-3-haiku';
      return fallback as never;
    });
    vi.mocked(adapter.generateObject).mockRejectedValue(
      new Error('No object generated: empty [structured-output:EMPTY]'),
    );

    await expect(
      service.generateObject({ mode: 'low', messages: [], schema: {} as never, maxRetries: 0 }),
    ).rejects.toThrow('No object generated');
    // Primary candidate + one fallback attempt — never a silent single try.
    expect(adapter.generateObject).toHaveBeenCalledTimes(2);
    expect(adapter.generateObject).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'anthropic:claude-3-haiku' }),
    );
  });

  it('returns structured output through the resolved mode', async () => {
    const result = await service.generateObject({
      mode: 'high',
      messages: [],
      schema: {} as never,
    });

    expect(result.object).toEqual({ answer: true });
    expect(adapter.generateObject).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'openai:gpt-4o' }),
    );
  });

  it('times out an execution when the configured deadline is exceeded', async () => {
    vi.mocked(adapter.generateText).mockImplementation(() => new Promise(() => {}) as never);

    await expect(
      service.generateText({ mode: 'low', messages: [], timeoutMs: 1, maxRetries: 0 }),
    ).rejects.toThrow('LLM execution timed out after 1ms');
  });
});
