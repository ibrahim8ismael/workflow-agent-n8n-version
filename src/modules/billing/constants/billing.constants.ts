export const PLANS = {
  FREE: 'FREE',
  PRO: 'PRO',
  ENTERPRISE: 'ENTERPRISE',
} as const;

export type Plan = (typeof PLANS)[keyof typeof PLANS];
