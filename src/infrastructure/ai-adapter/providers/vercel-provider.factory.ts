import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { openai } from '@ai-sdk/openai';

export type SupportedProvider = 'openai' | 'anthropic' | 'google' | 'groq';

export function createVercelProvider(provider: SupportedProvider, modelId: string) {
  switch (provider) {
    case 'openai':
      return openai(modelId);
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
