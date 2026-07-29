export const SOFT_LIMIT_THRESHOLD = 0.8;
export const HARD_LIMIT_THRESHOLD = 1.0;
export const GRACE_LIMIT_THRESHOLD = 1.1;
export const FREE_PLAN_TIER = 'FREE';
export const DEFAULT_CURRENCY = 'USD';
export const IDEMPOTENCY_KEY_PREFIX = 'billing';

export const BILLING_QUEUES = {
  SUBSCRIPTION_RENEWAL: 'billing.subscription-renewal',
  USAGE_RESET: 'billing.usage-reset',
  EXPIRY_CHECK: 'billing.expiry-check',
} as const;

export const BILLING_EVENTS = {
  SUBSCRIPTION_CREATED: 'billing.subscription.created',
  SUBSCRIPTION_RENEWED: 'billing.subscription.renewed',
  SUBSCRIPTION_UPGRADED: 'billing.subscription.upgraded',
  SUBSCRIPTION_DOWNGRADED: 'billing.subscription.downgraded',
  SUBSCRIPTION_CANCELED: 'billing.subscription.canceled',
  SUBSCRIPTION_EXPIRED: 'billing.subscription.expired',
  TOP_UP_PURCHASED: 'billing.top-up.purchased',
  CREDIT_CONSUMED: 'billing.credit.consumed',
  OPERATION_CONSUMED: 'billing.operation.consumed',
  REFUND_ISSUED: 'billing.refund.issued',
  CHARGE_FAILED: 'billing.charge.failed',
  GRACE_PERIOD_STARTED: 'billing.grace-period.started',
  HARD_LIMIT_REACHED: 'billing.hard-limit.reached',
} as const;

export const SUBSCRIPTION_PROVIDER = 'internal';
