import { registerAs } from '@nestjs/config';

export const otelConfig = registerAs('otel', () => ({
  enabled: process.env.OTEL_ENABLED === 'true',
  endpoint: process.env.OTEL_ENDPOINT ?? 'http://localhost:4318',
  serviceName: process.env.OTEL_SERVICE_NAME ?? 'woops-backend',
}));
