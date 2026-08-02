import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CouponRepository } from '../repositories/coupon.repository';
import { BillingEventService } from './billing-event.service';
import { CouponService } from './coupon.service';
import { WalletService } from './wallet.service';

describe('CouponService', () => {
  let service: CouponService;

  const coupon = (overrides: Record<string, unknown> = {}) => ({
    id: 'coupon-1',
    code: 'WELCOME10',
    type: 'FREE_CREDITS',
    value: 500,
    isActive: true,
    maxRedemptions: 100,
    currentRedemptions: 0,
    startsAt: null,
    expiresAt: null,
    ...overrides,
  });

  const mockCouponRepo = {
    findByCode: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    createRedemption: vi.fn(),
    incrementRedemptions: vi.fn(),
  } as unknown as CouponRepository;

  const mockWalletService = {
    getOrCreateWallet: vi.fn(),
    addCredits: vi.fn(),
  } as unknown as WalletService;

  const mockBillingEvent = {} as unknown as BillingEventService;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(mockCouponRepo.findByCode).mockResolvedValue(coupon() as never);
    vi.mocked(mockCouponRepo.findById).mockResolvedValue(coupon() as never);
    vi.mocked(mockWalletService.getOrCreateWallet).mockResolvedValue({ id: 'wallet-1' } as never);
    vi.mocked(mockWalletService.addCredits).mockResolvedValue({ id: 'tx-1' } as never);
    vi.mocked(mockCouponRepo.createRedemption).mockResolvedValue(undefined as never);
    vi.mocked(mockCouponRepo.incrementRedemptions).mockResolvedValue(undefined as never);
    service = new CouponService(mockCouponRepo, mockWalletService, mockBillingEvent);
  });

  describe('validate', () => {
    it('should return valid with discount info for an active coupon', async () => {
      const result = await service.validate('WELCOME10');

      expect(result).toEqual({
        valid: true,
        discountValue: 500,
        discountType: 'FREE_CREDITS',
      });
    });

    it('should reject an unknown coupon', async () => {
      vi.mocked(mockCouponRepo.findByCode).mockResolvedValue(null as never);

      const result = await service.validate('NOPE');

      expect(result).toEqual({ valid: false, reason: 'Coupon not found' });
    });

    it('should reject an inactive coupon', async () => {
      vi.mocked(mockCouponRepo.findByCode).mockResolvedValue(coupon({ isActive: false }) as never);

      const result = await service.validate('WELCOME10');

      expect(result).toEqual({ valid: false, reason: 'Coupon is inactive' });
    });

    it('should reject an expired coupon', async () => {
      vi.mocked(mockCouponRepo.findByCode).mockResolvedValue(
        coupon({ expiresAt: new Date(Date.now() - 1000) }) as never as never,
      );

      const result = await service.validate('WELCOME10');

      expect(result).toEqual({ valid: false, reason: 'Coupon has expired' });
    });

    it('should reject a coupon that is not yet active', async () => {
      vi.mocked(mockCouponRepo.findByCode).mockResolvedValue(
        coupon({ startsAt: new Date(Date.now() + 10000) }) as never as never,
      );

      const result = await service.validate('WELCOME10');

      expect(result).toEqual({ valid: false, reason: 'Coupon is not yet active' });
    });

    it('should reject a coupon that reached max redemptions', async () => {
      vi.mocked(mockCouponRepo.findByCode).mockResolvedValue(
        coupon({ currentRedemptions: 100, maxRedemptions: 100 }) as never as never,
      );

      const result = await service.validate('WELCOME10');

      expect(result).toEqual({ valid: false, reason: 'Coupon has reached max redemptions' });
    });
  });

  describe('redeem', () => {
    it('should throw when the coupon is invalid', async () => {
      vi.mocked(mockCouponRepo.findByCode).mockResolvedValue(null as never);

      await expect(service.redeem('NOPE', 'user-1', { userId: 'user-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should grant credits and record redemption for FREE_CREDITS coupons', async () => {
      const result = await service.redeem('WELCOME10', 'user-1', { userId: 'user-1' });

      expect(mockWalletService.addCredits).toHaveBeenCalledWith(
        'wallet-1',
        500n,
        0,
        expect.objectContaining({
          type: 'BONUS_GRANT',
          couponId: 'coupon-1',
          referenceType: 'coupon_redemption',
        }),
      );
      expect(mockCouponRepo.createRedemption).toHaveBeenCalledWith(
        expect.objectContaining({
          couponId: 'coupon-1',
          userId: 'user-1',
          walletId: 'wallet-1',
          walletTransactionId: 'tx-1',
        }),
      );
      expect(mockCouponRepo.incrementRedemptions).toHaveBeenCalledWith('coupon-1');
      expect(result).toEqual({
        coupon: expect.objectContaining({ code: 'WELCOME10' }),
        creditsGranted: 500n,
      });
    });

    it('should record a redemption without credits for non-credit coupons', async () => {
      vi.mocked(mockCouponRepo.findByCode).mockResolvedValue(
        coupon({ type: 'DISCOUNT', value: 10 }) as never as never,
      );

      const result = await service.redeem('WELCOME10', 'user-1', { userId: 'user-1' });

      expect(mockWalletService.addCredits).not.toHaveBeenCalled();
      expect(mockCouponRepo.createRedemption).toHaveBeenCalledWith({
        couponId: 'coupon-1',
        userId: 'user-1',
      });
      expect(result.creditsGranted).toBe(0n);
    });
  });

  describe('findAll / findById / create / update', () => {
    it('should delegate findAll with defaults', async () => {
      await service.findAll();

      expect(mockCouponRepo.findAll).toHaveBeenCalledWith(50, 0);
    });

    it('should throw when findById misses', async () => {
      vi.mocked(mockCouponRepo.findById).mockResolvedValue(null as never);

      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    it('should reject duplicate coupon codes on create', async () => {
      await expect(
        service.create({ code: 'WELCOME10', type: 'FREE_CREDITS', value: 100 }),
      ).rejects.toThrow('Coupon code already exists');
    });

    it('should create a coupon with a unique code', async () => {
      vi.mocked(mockCouponRepo.findByCode).mockResolvedValue(null as never);

      await service.create({ code: 'NEW2026', type: 'FREE_CREDITS', value: 100 });

      expect(mockCouponRepo.create).toHaveBeenCalledWith({
        code: 'NEW2026',
        type: 'FREE_CREDITS',
        value: 100,
      });
    });

    it('should update an existing coupon', async () => {
      await service.update('coupon-1', { value: 999 });

      expect(mockCouponRepo.update).toHaveBeenCalledWith('coupon-1', { value: 999 });
    });
  });
});
