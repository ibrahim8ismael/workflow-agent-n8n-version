import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().url(),

  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_ISSUER: z.string().default('woops'),

  STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ACCESS_KEY: z.string().default('woops'),
  STORAGE_SECRET_KEY: z.string().default('woops123'),
  STORAGE_BUCKET: z.string().default('woops-assets'),
  STORAGE_PUBLIC_URL: z.string().default('http://localhost:9000/woops-assets'),

  EMAIL_PROVIDER: z.enum(['resend', 'ses', 'mailgun', 'sendgrid']).default('resend'),
  RESEND_API_KEY: z.string().optional(),

  AI_PROVIDER: z
    .enum(['openai', 'gemini', 'anthropic', 'openrouter', 'azure-openai', 'ollama'])
    .default('openai'),
  OPENAI_API_KEY: z.string().optional(),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENV: z.string().default('development'),

  OTEL_ENABLED: z.coerce.boolean().default(false),
  OTEL_ENDPOINT: z.string().default('http://localhost:4318'),
  OTEL_SERVICE_NAME: z.string().default('woops-backend'),
});

export type Config = z.infer<typeof configSchema>;
