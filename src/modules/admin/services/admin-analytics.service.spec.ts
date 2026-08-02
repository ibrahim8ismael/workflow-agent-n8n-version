import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseService } from '../../../database/database.service';
import { AdminSubscriptionsRepository } from '../repositories/admin-subscriptions.repository';
import { AdminUsersRepository } from '../repositories/admin-users.repository';
import { AdminAnalyticsService } from './admin-analytics.service';

describe('AdminAnalyticsService', () => {
  let service: AdminAnalyticsService;

  const activeSub = (price: number) => ({
    id: `sub-${price}`,
    status: 'ACTIVE',
    plan: { price },
  });

  const mockSubRepo = {
    findAll: vi.fn(),
    countByStatus: vi.fn(),
  } as unknown as AdminSubscriptionsRepository;

  const mockUserRepo = {
    countActive: vi.fn(),
  } as unknown as AdminUsersRepository;

  const mockDb = {
    subscription: { count: vi.fn() },
    walletTransaction: { aggregate: vi.fn() },
  } as unknown as DatabaseService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockSubRepo.findAll).mockResolvedValue([
      activeSub(29),
      activeSub(29),
      { id: 'canceled', status: 'CANCELED', plan: { price: 99 } },
      { id: 'no-plan', status: 'ACTIVE', plan: null },
    ] as never);
    vi.mocked(mockSubRepo.countByStatus).mockResolvedValue({ ACTIVE: 2 });
    vi.mocked(mockUserRepo.countActive).mockResolvedValue(2);
    vi.mocked(mockDb.subscription.count).mockResolvedValue(1);
    vi.mocked(mockDb.walletTransaction.aggregate).mockResolvedValue({
      _sum: { amountCredits: -300 },
    } as never);
    service = new AdminAnalyticsService(mockSubRepo, mockUserRepo, mockDb);
  });

  describe('getMrr', () => {
    it('should sum only active subscriptions with a plan', async () => {
      const result = await service.getMrr();

      expect(result.mrr).toBe(58);
      expect(result.arr).toBe(696);
    });
  });

  describe('getChurnRate', () => {
    it('should compute churn over the default 90-day window', async () => {
      const result = await service.getChurnRate();

      expect(result.canceledInPeriod).toBe(1);
      expect(result.activeAtStart).toBe(1);
      expect(result.churnRate).toBe(1);
    });

    it('should return zero churn when there were no active subscriptions', async () => {
      vi.mocked(mockDb.subscription.count).mockResolvedValueOnce(0).mockResolvedValueOnce(0);

      const result = await service.getChurnRate();

      expect(result.churnRate).toBe(0);
    });

    it('should respect a custom start date', async () => {
      const since = new Date('2026-01-01T00:00:00Z');

      await service.getChurnRate(since);

      const firstCall = vi.mocked(mockDb.subscription.count).mock.calls[0][0] as {
        where: { canceledAt: { gte: Date } };
      };
      expect(firstCall.where.canceledAt.gte).toBe(since);
    });
  });

  describe('getCreditsBurnRate', () => {
    it('should compute total and daily burn', async () => {
      const result = await service.getCreditsBurnRate(30);

      expect(result.totalBurn).toBe(-300);
      expect(result.dailyBurnRate).toBe(-10);
      expect(result.periodDays).toBe(30);
    });

    it('should guard against zero days', async () => {
      const result = await service.getCreditsBurnRate(0);

      expect(result.dailyBurnRate).toBe(0);
    });
  });

  describe('getArpu', () => {
    it('should divide MRR by active customers', async () => {
      const result = await service.getArpu();

      expect(result.mrr).toBe(58);
      expect(result.totalCustomers).toBe(2);
      expect(result.arpu).toBe(29);
    });
  });

  describe('getDashboard', () => {
    it('should combine all metrics', async () => {
      const result = await service.getDashboard();

      expect(result).toMatchObject({
        mrr: 58,
        arr: 696,
        churnRate: 1,
        arpu: 29,
        totalCustomers: 2,
        dailyCreditsBurnRate: -10,
        totalCreditsBurnt: -300,
        subscriptionsByStatus: { ACTIVE: 2 },
      });
    });
  });
});
