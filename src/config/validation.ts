import { configSchema } from './schema';

// ADR-011 cutover — platform-global n8n configuration was removed. n8n
// instances connect per-user (own domain + API key) via /api/v1/integrations/n8n.
const REMOVED_N8N_KEYS = [
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

  const removed = REMOVED_N8N_KEYS.filter((key) => config[key]);
  if (removed.length > 0) {
    throw new Error(
      `Invalid environment variables: removed n8n keys detected (${removed.join(', ')}). ` +
        'Platform-global n8n no longer exists — each user connects their own n8n instance ' +
        '(domain + API key) via POST /api/v1/integrations/n8n. Delete these keys to boot.',
    );
  }

  return result.data;
}
