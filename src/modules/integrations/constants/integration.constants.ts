export const INTEGRATION_STATUS = {
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  ERROR: 'ERROR',
  EXPIRED: 'EXPIRED',
} as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUS)[keyof typeof INTEGRATION_STATUS];

export const INTEGRATION_CATEGORY = {
  AI: 'AI',
  COMMUNICATION: 'COMMUNICATION',
  CRM: 'CRM',
  PAYMENT: 'PAYMENT',
  ANALYTICS: 'ANALYTICS',
  STORAGE: 'STORAGE',
  OTHER: 'OTHER',
} as const;

export type IntegrationCategory = (typeof INTEGRATION_CATEGORY)[keyof typeof INTEGRATION_CATEGORY];
