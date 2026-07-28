import { registerAs } from '@nestjs/config';

export const aiConfig = registerAs('ai', () => ({
  provider: process.env.AI_PROVIDER ?? 'openai',
  openaiApiKey: process.env.OPENAI_API_KEY ?? '',
}));
