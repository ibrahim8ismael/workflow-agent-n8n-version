import { configSchema } from './schema';

const DEPRECATED_N8N_KEYS = [
  'N8N_BASE_URL',
  'N8N_WEBHOOK_URL',
  'N8N_API_URL',
  'N8N_API_KEY',
  'N8N_WORKFLOW_MAP',
] as const;

export function validateConfig(config: Record<string, unknown>) {
  const result = configSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment variables:\n${issues.join('\n')}`);
  }

  // PLAN Step 11 — platform-global n8n configuration is deprecated in favor
  // of client-provided connections (@PLAN.N8N.CLIENT.MODE.md).
  const deprecated = DEPRECATED_N8N_KEYS.filter((key) => config[key]);
  if (deprecated.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[config] Deprecated n8n env keys detected (${deprecated.join(', ')}). ` +
        'Platform-global n8n is superseded by client-provided connections ' +
        '(/api/v1/integrations/n8n). These keys will be removed after the runtime cutover.',
    );
  }

  return result.data;
}
