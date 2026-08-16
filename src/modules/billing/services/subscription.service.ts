import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { SUBSCRIPTION_PROVIDER } from '../constants/billing.constants';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { BillingEventService } from './billing-event.service';
import { UsageMeterService } from './usage-meter.service';
import { WalletService } from './wallet.service';

@Injectable()
export class SubscriptionService {
  constructor(
    private readonly subRepo: SubscriptionRepository,
    private readonly walletService: WalletService,
    private readonly usageMeter: UsageMeterService,
    private readonly billingEvent: BillingEventService,
  ) {}

  async create(data: { planId: string; userId?: string; organizationId?: string }) {
    const plan = await this.subRepo.findById(data.planId);
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.plan.isActive) throw new BadRequestException('Plan is not active');

    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    const subscription = await this.subRepo.create({
      planId: data.planId,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      provider: SUBSCRIPTION_PROVIDER,
      providerSubscriptionId: `internal_${data.userId ?? data.organizationId}_${Date.now()}`,
      userId: data.userId,
      organizationId: data.organizationId,
    });

    const wallet = await this.walletService.getOrCreateWallet(data);
    const quota = plan.plan as unknown as {
      aiCreditsPerMonth?: bigint;
      operationsPerMonth?: bigint;
    };

    await this.usageMeter.createMeter(subscription.id, {
      aiCreditsLimit:
        (plan.plan as { quota?: { aiCreditsPerMonth: bigint } }).quota?.aiCreditsPerMonth ??
        BigInt(0),
      operationsLimit:
        (plan.plan as { quota?: { operationsPerMonth: bigint } }).quota?.operationsPerMonth ??
        BigInt(0),
      resetAt: periodEnd,
    });

    const creditsToAdd = quota.aiCreditsPerMonth ?? BigInt(0);
    if (creditsToAdd > BigInt(0)) {
      await this.walletService.addCredits(wallet.id, creditsToAdd, 0, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: 'SUBSCRIPTION_CREDIT' as any,
        description: `Monthly ${plan.plan.name} credits`,
        referenceType: 'subscription',
        referenceId: subscription.id,
      });
    }

    await this.billingEvent.logSubscriptionCreated({
      subscriptionId: subscription.id,
      userId: data.userId,
      organizationId: data.organizationId,
      planId: data.planId,
    });

    return subscription;
  }

  async getCurrent(userId?: string, organizationId?: string) {
    if (organizationId) {
      return this.subRepo.findByOrganizationId(organizationId);
    }
    if (userId) {
      return this.subRepo.findByUserId(userId);
    }
    throw new BadRequestException('Either userId or organizationId is required');
  }

  async upgrade(
    subscriptionId: string,
    newPlanId: string,
    scope?: { userId?: string; organizationId?: string },
  ) {
    const sub = await this.subRepo.findById(subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found');

    if (scope) {
      const personalAccess = Boolean(scope.userId && sub.userId === scope.userId);
      const organizationAccess = Boolean(
        scope.organizationId && sub.organizationId === scope.organizationId,
      );
      if (!personalAccess && !organizationAccess) {
        throw new NotFoundException('Subscription not found');
      }
    }

    const plan = await this.subRepo.findById(newPlanId);
    if (!plan) throw new NotFoundException('New plan not found');

    const updated = await this.subRepo.update(subscriptionId, { planId: newPlanId });

    await this.billingEvent.logSubscriptionUpgraded({
      subscriptionId,
      oldPlanId: sub.planId,
      newPlanId,
    });

    return updated;
  }

  async cancel(subscriptionId: string, scope?: { userId?: string; organizationId?: string }) {
    const sub = await this.subRepo.findById(subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found');

    if (scope) {
      const personalAccess = Boolean(scope.userId && sub.userId === scope.userId);
      const organizationAccess = Boolean(
        scope.organizationId && sub.organizationId === scope.organizationId,
      );
      if (!personalAccess && !organizationAccess) {
        throw new NotFoundException('Subscription not found');
      }
    }

    const canceled = await this.subRepo.cancel(subscriptionId);

    await this.billingEvent.logSubscriptionCanceled({
      subscriptionId,
      userId: sub.userId ?? undefined,
      organizationId: sub.organizationId ?? undefined,
    });

    return canceled;
  }

  async renew(subscriptionId: string) {
    const sub = await this.subRepo.findById(subscriptionId);
    if (!sub) throw new NotFoundException('Subscription not found');

    const now = new Date();
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    const updated = await this.subRepo.update(subscriptionId, {
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    });

    const quota = (
      sub.plan as unknown as { quota?: { aiCreditsPerMonth?: bigint; operationsPerMonth?: bigint } }
    ).quota;
    if (quota) {
      const wallet = sub.userId
        ? await this.walletService.getOrCreateWallet({ userId: sub.userId })
        : await this.walletService.getOrCreateWallet({ organizationId: sub.organizationId! });

      if (quota.aiCreditsPerMonth && quota.aiCreditsPerMonth > BigInt(0)) {
        await this.walletService.addCredits(wallet.id, quota.aiCreditsPerMonth, 0, {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          type: 'SUBSCRIPTION_CREDIT' as any,
          description: `Monthly ${sub.plan.name} credits (renewal)`,
          referenceType: 'subscription',
          referenceId: subscriptionId,
        });
      }

      await this.usageMeter.resetMeter(
        subscriptionId,
        quota.aiCreditsPerMonth ?? BigInt(0),
        quota.operationsPerMonth ?? BigInt(0),
        periodEnd,
      );
    }

    await this.billingEvent.logEvent({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      type: 'SUBSCRIPTION_RENEWED' as any,
      entityType: 'subscription',
      entityId: subscriptionId,
      userId: sub.userId ?? undefined,
      organizationId: sub.organizationId ?? undefined,
    });

    return updated;
  }

  async findAll(limit = 50, offset = 0) {
    return this.subRepo.findAll(limit, offset);
  }

  async findById(id: string) {
    return this.subRepo.findById(id);
  }

  async countActive() {
    return this.subRepo.countActive();
  }

  async findExpired() {
    return this.subRepo.findExpired();
  }
}
