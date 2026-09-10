import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const aiMocks = vi.hoisted(() => ({
  generateObject: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: aiMocks.generateObject,
  generateText: aiMocks.generateText,
  streamText: vi.fn(),
  NoObjectGeneratedError: class NoObjectGeneratedMock extends Error {
    static isInstance(error: unknown): boolean {
      return (
        error instanceof NoObjectGeneratedMock ||
        (typeof error === 'object' && error !== null && '__noObject' in error)
      );
    }
  },
}));

import {
  AIAdapterService,
  STRUCTURED_OUTPUT_SAMPLE_LIMIT,
  StructuredOutputError,
} from './ai-adapter.service';

const schema = z.object({ name: z.string() });

const params = (overrides = {}) => ({
  model: 'openrouter:openai/gpt-5.6-luna',
  systemPrompt: 'Return the object.',
  messages: [{ role: 'user', content: 'hi' } as const],
  schema,
  temperature: 0.1,
  maxTokens: 500,
  ...overrides,
});

const noObjectError = () =>
  Object.assign(new Error('No object generated: response did not match schema.'), {
    __noObject: true,
  });

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

describe('AIAdapterService generateObject failure classification', () => {
  const service = new AIAdapterService();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns valid structured responses untouched', async () => {
    aiMocks.generateObject.mockResolvedValue({
      object: { name: 'cfo' },
      finishReason: 'stop',
      usage,
    });

    const result = await service.generateObject(params());

    expect(result.object).toEqual({ name: 'cfo' });
    expect(aiMocks.generateText).not.toHaveBeenCalled();
  });

  it('classifies empty repair output as EMPTY', async () => {
    aiMocks.generateObject.mockRejectedValue(noObjectError());
    aiMocks.generateText.mockResolvedValue({ text: '   \n', finishReason: 'stop', usage });

    const failure = await service.generateObject(params()).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(StructuredOutputError);
    expect(failure as StructuredOutputError).toMatchObject({ kind: 'EMPTY' });
    expect((failure as StructuredOutputError).details).toMatchObject({
      rawSample: '',
      finishReason: 'stop',
    });
  });

  it('classifies unparseable repair output as MALFORMED with a bounded sample', async () => {
    aiMocks.generateObject.mockRejectedValue(noObjectError());
    aiMocks.generateText.mockResolvedValue({
      text: `Sure! Here is some prose with no json at all ${'x'.repeat(2000)}`,
      finishReason: 'stop',
      usage,
    });

    const failure = await service.generateObject(params()).catch((e: unknown) => e);

    expect(failure as StructuredOutputError).toMatchObject({ kind: 'MALFORMED' });
    const details = (failure as StructuredOutputError).details;
    expect(details.rawSample.length).toBeLessThanOrEqual(STRUCTURED_OUTPUT_SAMPLE_LIMIT);
    expect(details.finishReason).toBe('stop');
  });

  it('classifies schema-mismatched JSON as SCHEMA_INVALID', async () => {
    aiMocks.generateObject.mockRejectedValue(noObjectError());
    aiMocks.generateText.mockResolvedValue({
      text: '{"wrong": 1}',
      finishReason: 'stop',
      usage,
    });

    const failure = await service.generateObject(params()).catch((e: unknown) => e);

    expect(failure as StructuredOutputError).toMatchObject({ kind: 'SCHEMA_INVALID' });
  });

  it('preserves the retryable failure phrase for upstream failover matching', async () => {
    aiMocks.generateObject.mockRejectedValue(noObjectError());
    aiMocks.generateText.mockResolvedValue({ text: 'nope', finishReason: 'stop', usage });

    const failure = (await service.generateObject(params()).catch((e: unknown) => e)) as Error;

    expect(failure.message).toMatch(/no object generated/i);
  });

  it('recovers fenced JSON through the existing repair path', async () => {
    aiMocks.generateObject.mockRejectedValue(noObjectError());
    aiMocks.generateText.mockResolvedValue({
      text: '```json\n{"name": "cfo"}\n```',
      finishReason: 'stop',
      usage,
    });

    const result = await service.generateObject(params());

    expect(result.object).toEqual({ name: 'cfo' });
  });

  it('rethrows non-structured errors untouched', async () => {
    aiMocks.generateObject.mockRejectedValue(new Error('boom: connection reset'));

    await expect(service.generateObject(params())).rejects.toThrow('boom: connection reset');
    expect(aiMocks.generateText).not.toHaveBeenCalled();
  });
});
