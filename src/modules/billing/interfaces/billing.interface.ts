import { WalletTransactionType } from '@prisma/client';

export interface IBillingPlan {
  id: string;
  tier: string;
  name: string;
  price: number;
  currency: string;
  interval: string;
  features: Record<string, unknown>;
  isActive: boolean;
}

export interface ISubscription {
  id: string;
  planId: string;
  status: string;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  provider: string;
  providerSubscriptionId: string;
  userId?: string | null;
  organizationId?: string | null;
}

export interface IWalletBalance {
  walletId: string;
  balanceCredits: bigint;
  balanceCreditsUsd: number;
  lifetimeCredits: bigint;
  lifetimeSpendUsd: number;
  currency: string;
  isFrozen: boolean;
}

export interface IConsumptionResult {
  transactionId: string;
  balanceBefore: bigint;
  balanceAfter: bigint;
  type: WalletTransactionType;
}

export interface IQuotaCheckResult {
  allowed: boolean;
  reason?: string;
  currentUsage: bigint;
  limit: bigint;
  isSoftLimitReached: boolean;
  isHardLimitReached: boolean;
}

export interface ICouponValidation {
  valid: boolean;
  reason?: string;
  discountValue?: number;
  discountType?: string;
  creditsToGrant?: bigint;
}

export interface IBillingAnalytics {
  mrr: number;
  arr: number;
  arpu: number;
  churnRate: number;
  totalCustomers: number;
  activeSubscriptions: number;
  creditBurnRate: number;
  topUpRevenue: number;
}
