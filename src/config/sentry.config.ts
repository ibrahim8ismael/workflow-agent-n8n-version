import { registerAs } from '@nestjs/config';

export const sentryConfig = registerAs('sentry', () => ({
  dsn: process.env.SENTRY_DSN ?? '',
  env: process.env.SENTRY_ENV ?? 'development',
}));
