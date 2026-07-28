export const INTEGRATION_TYPES = {
  SLACK: 'SLACK',
  DISCORD: 'DISCORD',
  TELEGRAM: 'TELEGRAM',
  GMAIL: 'GMAIL',
  CUSTOM: 'CUSTOM',
} as const;

export type IntegrationType = (typeof INTEGRATION_TYPES)[keyof typeof INTEGRATION_TYPES];
