import { configSchema } from './schema';

export function validateConfig(config: Record<string, unknown>) {
  const result = configSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment variables:\n${issues.join('\n')}`);
  }

  return result.data;
}
