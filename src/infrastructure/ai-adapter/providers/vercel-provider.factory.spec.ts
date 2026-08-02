import { describe, expect, it } from 'vitest';
import { createVercelProvider, parseModelString } from './vercel-provider.factory';

describe('parseModelString', () => {
  it('should default to openai when no provider is given', () => {
    expect(parseModelString('gpt-4o')).toEqual({ provider: 'openai', modelId: 'gpt-4o' });
  });

  it('should parse an openai prefixed model', () => {
    expect(parseModelString('openai:gpt-4o-mini')).toEqual({
      provider: 'openai',
      modelId: 'gpt-4o-mini',
    });
  });

  it('should parse an anthropic prefixed model', () => {
    expect(parseModelString('anthropic:claude-3-5-sonnet')).toEqual({
      provider: 'anthropic',
      modelId: 'claude-3-5-sonnet',
    });
  });

  it('should parse a google prefixed model', () => {
    expect(parseModelString('google:gemini-1.5-pro')).toEqual({
      provider: 'google',
      modelId: 'gemini-1.5-pro',
    });
  });

  it('should parse a groq prefixed model', () => {
    expect(parseModelString('groq:llama-3-70b')).toEqual({
      provider: 'groq',
      modelId: 'llama-3-70b',
    });
  });
});

describe('createVercelProvider', () => {
  it('should create an openai provider', () => {
    const provider = createVercelProvider('openai', 'gpt-4o');

    expect(provider).toBeDefined();
  });

  it('should create an anthropic provider', () => {
    const provider = createVercelProvider('anthropic', 'claude-3-5-sonnet');

    expect(provider).toBeDefined();
  });

  it('should create a google provider', () => {
    const provider = createVercelProvider('google', 'gemini-1.5-pro');

    expect(provider).toBeDefined();
  });

  it('should create a groq provider', () => {
    const provider = createVercelProvider('groq', 'llama-3-70b');

    expect(provider).toBeDefined();
  });

  it('should throw for unsupported providers', () => {
    expect(() => createVercelProvider('unknown' as never, 'x')).toThrow(
      'Unsupported provider: unknown',
    );
  });
});
