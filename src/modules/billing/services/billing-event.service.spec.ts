import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingEventRepository } from '../repositories/billing-event.repository';
import { BillingEventService } from './billing-event.service';

describe('BillingEventService', () => {
  let service: BillingEventService;

  const mockRepo = {
    create: vi.fn(),
    findByEntity: vi.fn(),
    findAll: vi.fn(),
  } as unknown as BillingEventRepository;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockRepo.create).mockResolvedValue({ id: 'event-1' } as never);
    service = new BillingEventService(mockRepo);
  });

  describe('logEvent', () => {
    it('should persist the raw event', async () => {
      const data = {
        type: 'CREDIT_CONSUMED' as const,
        entityType: 'wallet',
        entityId: 'wallet-1',
        userId: 'user-1',
      };

      await service.logEvent(data);

      expect(mockRepo.create).toHaveBeenCalledWith(data);
    });
  });

  describe('domain loggers', () => {
    it('should log subscription created with plan metadata', async () => {
      await service.logSubscriptionCreated({
        subscriptionId: 'sub-1',
        userId: 'user-1',
        planId: 'plan-1',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUBSCRIPTION_CREATED',
          entityType: 'subscription',
          entityId: 'sub-1',
          metadata: { planId: 'plan-1' },
        }),
      );
    });

    it('should log subscription upgraded with plan ids', async () => {
      await service.logSubscriptionUpgraded({
        subscriptionId: 'sub-1',
        oldPlanId: 'plan-1',
        newPlanId: 'plan-2',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUBSCRIPTION_UPGRADED',
          metadata: { oldPlanId: 'plan-1', newPlanId: 'plan-2' },
        }),
      );
    });

    it('should log subscription canceled', async () => {
      await service.logSubscriptionCanceled({
        subscriptionId: 'sub-1',
        organizationId: 'org-1',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SUBSCRIPTION_CANCELED',
          entityId: 'sub-1',
          organizationId: 'org-1',
        }),
      );
    });

    it('should log credit consumed with numeric metadata', async () => {
      await service.logCreditConsumed({
        walletId: 'wallet-1',
        transactionId: 'tx-1',
        amount: 10n,
        balanceBefore: 100n,
        balanceAfter: 90n,
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CREDIT_CONSUMED',
          entityId: 'wallet-1',
          metadata: {
            transactionId: 'tx-1',
            amount: 10,
            balanceBefore: 100,
            balanceAfter: 90,
          },
        }),
      );
    });

    it('should log top-up purchased', async () => {
      await service.logTopUpPurchased({
        purchaseId: 'purchase-1',
        walletId: 'wallet-1',
        packageId: 'pkg-1',
        amountPaidUsd: 9.99,
        creditsGranted: 1000n,
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'TOP_UP_PURCHASED',
          metadata: {
            purchaseId: 'purchase-1',
            packageId: 'pkg-1',
            amountPaidUsd: 9.99,
            creditsGranted: 1000,
          },
        }),
      );
    });

    it('should log grace period started with ISO date', async () => {
      const graceEnd = new Date('2026-09-01T00:00:00Z');

      await service.logGracePeriodStarted('wallet-1', graceEnd);

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'GRACE_PERIOD_STARTED',
          metadata: { graceEnd: graceEnd.toISOString() },
        }),
      );
    });

    it('should log hard limit reached', async () => {
      await service.logHardLimitReached({
        subscriptionId: 'sub-1',
        resourceType: 'ai_credits',
        currentUsage: 1000n,
        limit: 1000n,
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'HARD_LIMIT_REACHED',
          metadata: { resourceType: 'ai_credits', currentUsage: 1000, limit: 1000 },
        }),
      );
    });
  });

  describe('queries', () => {
    it('should find events by entity', async () => {
      await service.findByEntity('wallet', 'wallet-1', 10);

      expect(mockRepo.findByEntity).toHaveBeenCalledWith('wallet', 'wallet-1', 10);
    });

    it('should list all events with defaults', async () => {
      await service.findAll();

      expect(mockRepo.findAll).toHaveBeenCalledWith(100, 0);
    });
  });
});
