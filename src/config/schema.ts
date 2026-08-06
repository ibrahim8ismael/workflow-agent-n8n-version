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

  NOTIFICATION_PROVIDER: z.enum(['nodemailer', 'twilio']).default('nodemailer'),
  EMAIL_PROVIDER: z
    .enum(['nodemailer', 'resend', 'ses', 'mailgun', 'sendgrid'])
    .default('nodemailer'),
  RESEND_API_KEY: z.string().optional(),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@woops.com'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),

  AI_PROVIDER: z
    .enum(['openai', 'gemini', 'anthropic', 'openrouter', 'azure-openai', 'ollama'])
    .default('openai'),
  OPENAI_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_HTTP_REFERER: z.string().url().optional(),
  OPENROUTER_APP_NAME: z.string().optional(),
  LLM_LOW_PROVIDER: z.string().default('openai'),
  LLM_LOW_MODEL: z.string().default('gpt-4o-mini'),
  LLM_LOW_FALLBACKS: z.string().default(''),
  LLM_LOW_TIMEOUT_MS: z.coerce.number().positive().default(60000),
  LLM_MEDIUM_PROVIDER: z.string().default('openai'),
  LLM_MEDIUM_MODEL: z.string().default('gpt-4o'),
  LLM_MEDIUM_FALLBACKS: z.string().default(''),
  LLM_MEDIUM_TIMEOUT_MS: z.coerce.number().positive().default(60000),
  LLM_HIGH_PROVIDER: z.string().default('openai'),
  LLM_HIGH_MODEL: z.string().default('gpt-4o'),
  LLM_HIGH_FALLBACKS: z.string().default(''),
  LLM_HIGH_TIMEOUT_MS: z.coerce.number().positive().default(120000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
  BUSINESS_TIMEZONE: z.string().default('UTC'),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENV: z.string().default('development'),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
  SENTRY_RELEASE: z.string().optional(),

  OTEL_ENABLED: z.coerce.boolean().default(false),
  OTEL_ENDPOINT: z.string().default('http://localhost:4318'),
  OTEL_SERVICE_NAME: z.string().default('woops-backend'),
});

export type Config = z.infer<typeof configSchema>;
