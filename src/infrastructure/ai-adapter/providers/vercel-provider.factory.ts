import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { createOpenAI, openai } from '@ai-sdk/openai';

export type SupportedProvider = 'openai' | 'anthropic' | 'google' | 'groq' | 'openrouter';

export function createVercelProvider(provider: SupportedProvider, modelId: string) {
  switch (provider) {
    case 'openai':
      return openai(modelId);
    case 'openrouter':
      return createOpenAI({
        apiKey: process.env.OPENROUTER_API_KEY,
        baseURL: 'https://openrouter.ai/api/v1',
        headers: {
          ...(process.env.OPENROUTER_HTTP_REFERER
            ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER }
            : {}),
          ...(process.env.OPENROUTER_APP_NAME
            ? { 'X-Title': process.env.OPENROUTER_APP_NAME }
            : {}),
        },
      })(modelId);
    case 'anthropic':
      return anthropic(modelId);
    case 'google':
      return google(modelId);
    case 'groq':
      return groq(modelId);
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

export function parseModelString(modelString: string): {
  provider: SupportedProvider;
  modelId: string;
} {
  const colonIndex = modelString.indexOf(':');
  if (colonIndex === -1) {
    return { provider: 'openai', modelId: modelString };
  }
  const provider = modelString.slice(0, colonIndex) as SupportedProvider;
  const modelId = modelString.slice(colonIndex + 1);
  return { provider, modelId };
}
