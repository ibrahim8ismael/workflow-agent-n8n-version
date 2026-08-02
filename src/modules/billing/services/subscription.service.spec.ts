import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionRepository } from '../repositories/subscription.repository';
import { BillingEventService } from './billing-event.service';
import { SubscriptionService } from './subscription.service';
import { UsageMeterService } from './usage-meter.service';
import { WalletService } from './wallet.service';

describe('SubscriptionService', () => {
  let service: SubscriptionService;

  const planRecord = (overrides: Record<string, unknown> = {}) => ({
    id: 'plan-1',
    planId: 'plan-1',
    plan: {
      name: 'Pro',
      isActive: true,
      aiCreditsPerMonth: 5000n,
      operationsPerMonth: 200n,
      quota: { aiCreditsPerMonth: 5000n, operationsPerMonth: 200n },
    },
    ...overrides,
  });

  const sub = (overrides: Record<string, unknown> = {}) => ({
    id: 'sub-1',
    planId: 'plan-1',
    plan: {
      name: 'Pro',
      isActive: true,
      quota: { aiCreditsPerMonth: 5000n, operationsPerMonth: 200n },
    },
    status: 'ACTIVE',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(),
    provider: 'internal',
    providerSubscriptionId: 'internal_user-1_1',
    userId: 'user-1',
    organizationId: null,
    ...overrides,
  });

  const mockSubRepo = {
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    findByOrganizationId: vi.fn(),
    findByUserId: vi.fn(),
    findAll: vi.fn(),
    countActive: vi.fn(),
    findExpired: vi.fn(),
  } as unknown as SubscriptionRepository;

  const mockWalletService = {
    getOrCreateWallet: vi.fn(),
    addCredits: vi.fn(),
  } as unknown as WalletService;

  const mockUsageMeter = {
    createMeter: vi.fn(),
    resetMeter: vi.fn(),
  } as unknown as UsageMeterService;

  const mockBillingEvent = {
    logSubscriptionCreated: vi.fn(),
    logSubscriptionUpgraded: vi.fn(),
    logSubscriptionCanceled: vi.fn(),
    logEvent: vi.fn(),
  } as unknown as BillingEventService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockSubRepo.findById).mockResolvedValue(planRecord() as never);
    vi.mocked(mockSubRepo.create).mockResolvedValue(sub() as never);
    vi.mocked(mockSubRepo.update).mockResolvedValue(sub() as never);
    vi.mocked(mockSubRepo.cancel).mockResolvedValue(sub({ status: 'CANCELED' }) as never);
    vi.mocked(mockWalletService.getOrCreateWallet).mockResolvedValue({ id: 'wallet-1' } as never);
    vi.mocked(mockWalletService.addCredits).mockResolvedValue({ id: 'tx-1' } as never);
    vi.mocked(mockUsageMeter.createMeter).mockResolvedValue({ id: 'meter-1' } as never);
    vi.mocked(mockUsageMeter.resetMeter).mockResolvedValue({ id: 'meter-1' } as never);
    vi.mocked(mockBillingEvent.logSubscriptionCreated).mockResolvedValue(undefined as never);
    vi.mocked(mockBillingEvent.logSubscriptionUpgraded).mockResolvedValue(undefined as never);
    vi.mocked(mockBillingEvent.logSubscriptionCanceled).mockResolvedValue(undefined as never);
    vi.mocked(mockBillingEvent.logEvent).mockResolvedValue(undefined as never);
    service = new SubscriptionService(
      mockSubRepo,
      mockWalletService,
      mockUsageMeter,
      mockBillingEvent,
    );
  });

  describe('create', () => {
    it('should throw when the plan is missing', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(null as never);

      await expect(service.create({ planId: 'missing', userId: 'user-1' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw when the plan is inactive', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(
        planRecord({ plan: { name: 'Old', isActive: false } }) as never as never,
      );

      await expect(service.create({ planId: 'plan-1', userId: 'user-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create a subscription with a monthly period', async () => {
      await service.create({ planId: 'plan-1', userId: 'user-1' });

      expect(mockSubRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'plan-1',
          provider: 'internal',
          userId: 'user-1',
        }),
      );
    });

    it('should create a usage meter from plan quota', async () => {
      await service.create({ planId: 'plan-1', userId: 'user-1' });

      expect(mockUsageMeter.createMeter).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({
          aiCreditsLimit: 5000n,
          operationsLimit: 200n,
          resetAt: expect.any(Date),
        }),
      );
    });

    it('should grant monthly credits to the wallet', async () => {
      await service.create({ planId: 'plan-1', userId: 'user-1' });

      expect(mockWalletService.addCredits).toHaveBeenCalledWith(
        'wallet-1',
        5000n,
        0,
        expect.objectContaining({
          type: 'SUBSCRIPTION_CREDIT',
          description: 'Monthly Pro credits',
        }),
      );
      expect(mockBillingEvent.logSubscriptionCreated).toHaveBeenCalledWith(
        expect.objectContaining({ subscriptionId: 'sub-1', planId: 'plan-1', userId: 'user-1' }),
      );
    });

    it('should skip wallet credits when the plan grants none', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(
        planRecord({
          plan: { name: 'Free', isActive: true, quota: { aiCreditsPerMonth: 0n } },
        }) as never as never,
      );

      await service.create({ planId: 'plan-1', userId: 'user-1' });

      expect(mockWalletService.addCredits).not.toHaveBeenCalled();
    });
  });

  describe('getCurrent', () => {
    it('should query by organization first', async () => {
      await service.getCurrent('user-1', 'org-1');

      expect(mockSubRepo.findByOrganizationId).toHaveBeenCalledWith('org-1');
      expect(mockSubRepo.findByUserId).not.toHaveBeenCalled();
    });

    it('should query by user when no organization is given', async () => {
      await service.getCurrent('user-1');

      expect(mockSubRepo.findByUserId).toHaveBeenCalledWith('user-1');
    });

    it('should throw when neither is provided', async () => {
      await expect(service.getCurrent()).rejects.toThrow(BadRequestException);
    });
  });

  describe('upgrade', () => {
    it('should throw when the subscription is missing', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(null as never);

      await expect(service.upgrade('missing', 'plan-2')).rejects.toThrow(NotFoundException);
    });

    it('should throw when the new plan is missing', async () => {
      vi.mocked(mockSubRepo.findById)
        .mockResolvedValueOnce(planRecord() as never)
        .mockResolvedValueOnce(null as never);

      await expect(service.upgrade('sub-1', 'missing')).rejects.toThrow(NotFoundException);
    });

    it('should switch the plan and log the upgrade', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(sub() as never);

      const result = await service.upgrade('sub-1', 'plan-2');

      expect(mockSubRepo.update).toHaveBeenCalledWith('sub-1', { planId: 'plan-2' });
      expect(mockBillingEvent.logSubscriptionUpgraded).toHaveBeenCalledWith({
        subscriptionId: 'sub-1',
        oldPlanId: 'plan-1',
        newPlanId: 'plan-2',
      });
      expect(result.planId).toBe('plan-1');
    });
  });

  describe('cancel', () => {
    it('should throw when the subscription is missing', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(null as never);

      await expect(service.cancel('missing')).rejects.toThrow(NotFoundException);
    });

    it('should cancel and log the event', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(sub() as never);

      const result = await service.cancel('sub-1');

      expect(mockSubRepo.cancel).toHaveBeenCalledWith('sub-1');
      expect(mockBillingEvent.logSubscriptionCanceled).toHaveBeenCalledWith({
        subscriptionId: 'sub-1',
        userId: 'user-1',
        organizationId: undefined,
      });
      expect(result.status).toBe('CANCELED');
    });
  });

  describe('renew', () => {
    it('should throw when the subscription is missing', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(null as never);

      await expect(service.renew('missing')).rejects.toThrow(NotFoundException);
    });

    it('should renew the period, top up credits and reset the meter', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(sub() as never);

      await service.renew('sub-1');

      expect(mockSubRepo.update).toHaveBeenCalledWith(
        'sub-1',
        expect.objectContaining({ currentPeriodStart: expect.any(Date) }),
      );
      expect(mockWalletService.addCredits).toHaveBeenCalledWith(
        'wallet-1',
        5000n,
        0,
        expect.objectContaining({ description: 'Monthly Pro credits (renewal)' }),
      );
      expect(mockUsageMeter.resetMeter).toHaveBeenCalledWith(
        'sub-1',
        5000n,
        200n,
        expect.any(Date),
      );
      expect(mockBillingEvent.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'SUBSCRIPTION_RENEWED', entityId: 'sub-1' }),
      );
    });

    it('should skip wallet operations when the plan has no quota', async () => {
      vi.mocked(mockSubRepo.findById).mockResolvedValue(
        sub({ plan: { name: 'Pro', quota: null } }) as never as never,
      );

      await service.renew('sub-1');

      expect(mockWalletService.addCredits).not.toHaveBeenCalled();
      expect(mockUsageMeter.resetMeter).not.toHaveBeenCalled();
    });
  });

  describe('findAll / findById / countActive / findExpired', () => {
    it('should delegate queries', async () => {
      await service.findAll(10, 5);
      await service.findById('sub-1');
      await service.countActive();
      await service.findExpired();

      expect(mockSubRepo.findAll).toHaveBeenCalledWith(10, 5);
      expect(mockSubRepo.findById).toHaveBeenCalledWith('sub-1');
      expect(mockSubRepo.countActive).toHaveBeenCalled();
      expect(mockSubRepo.findExpired).toHaveBeenCalled();
    });
  });
});
