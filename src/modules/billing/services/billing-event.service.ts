import { Injectable } from '@nestjs/common';
import type { BillingEventType } from '@prisma/client';
import type { BillingEventRepository } from '../repositories/billing-event.repository';

@Injectable()
export class BillingEventService {
  constructor(private readonly eventRepo: BillingEventRepository) {}

  async logEvent(data: {
    type: BillingEventType;
    entityType: string;
    entityId: string;
    userId?: string;
    organizationId?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.eventRepo.create(data);
  }

  async logSubscriptionCreated(data: {
    subscriptionId: string;
    userId?: string;
    organizationId?: string;
    planId?: string;
  }) {
    return this.eventRepo.create({
      type: 'SUBSCRIPTION_CREATED' as BillingEventType,
      entityType: 'subscription',
      entityId: data.subscriptionId,
      userId: data.userId,
      organizationId: data.organizationId,
      metadata: { planId: data.planId },
    });
  }

  async logSubscriptionUpgraded(data: {
    subscriptionId: string;
    oldPlanId: string;
    newPlanId: string;
  }) {
    return this.eventRepo.create({
      type: 'SUBSCRIPTION_UPGRADED' as BillingEventType,
      entityType: 'subscription',
      entityId: data.subscriptionId,
      metadata: { oldPlanId: data.oldPlanId, newPlanId: data.newPlanId },
    });
  }

  async logSubscriptionCanceled(data: {
    subscriptionId: string;
    userId?: string;
    organizationId?: string;
  }) {
    return this.eventRepo.create({
      type: 'SUBSCRIPTION_CANCELED' as BillingEventType,
      entityType: 'subscription',
      entityId: data.subscriptionId,
      userId: data.userId,
      organizationId: data.organizationId,
    });
  }

  async logCreditConsumed(data: {
    walletId: string;
    transactionId: string;
    amount: bigint;
    balanceBefore: bigint;
    balanceAfter: bigint;
    userId?: string;
    organizationId?: string;
  }) {
    return this.eventRepo.create({
      type: 'CREDIT_CONSUMED' as BillingEventType,
      entityType: 'wallet',
      entityId: data.walletId,
      userId: data.userId,
      organizationId: data.organizationId,
      metadata: {
        transactionId: data.transactionId,
        amount: Number(data.amount),
        balanceBefore: Number(data.balanceBefore),
        balanceAfter: Number(data.balanceAfter),
      },
    });
  }

  async logTopUpPurchased(data: {
    purchaseId: string;
    walletId: string;
    packageId: string;
    amountPaidUsd: number;
    creditsGranted: bigint;
    userId?: string;
    organizationId?: string;
  }) {
    return this.eventRepo.create({
      type: 'TOP_UP_PURCHASED' as BillingEventType,
      entityType: 'wallet',
      entityId: data.walletId,
      userId: data.userId,
      organizationId: data.organizationId,
      metadata: {
        purchaseId: data.purchaseId,
        packageId: data.packageId,
        amountPaidUsd: data.amountPaidUsd,
        creditsGranted: Number(data.creditsGranted),
      },
    });
  }

  async logGracePeriodStarted(walletId: string, graceEnd: Date) {
    return this.eventRepo.create({
      type: 'GRACE_PERIOD_STARTED' as BillingEventType,
      entityType: 'wallet',
      entityId: walletId,
      metadata: { graceEnd: graceEnd.toISOString() },
    });
  }

  async logHardLimitReached(data: {
    subscriptionId: string;
    resourceType: 'ai_credits' | 'operations';
    currentUsage: bigint;
    limit: bigint;
  }) {
    return this.eventRepo.create({
      type: 'HARD_LIMIT_REACHED' as BillingEventType,
      entityType: 'subscription',
      entityId: data.subscriptionId,
      metadata: {
        resourceType: data.resourceType,
        currentUsage: Number(data.currentUsage),
        limit: Number(data.limit),
      },
    });
  }

  async findByEntity(entityType: string, entityId: string, limit?: number) {
    return this.eventRepo.findByEntity(entityType, entityId, limit);
  }

  async findAll(limit = 100, offset = 0) {
    return this.eventRepo.findAll(limit, offset);
  }
}
