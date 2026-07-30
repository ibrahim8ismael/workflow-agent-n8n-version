import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ICouponValidation } from '../interfaces/billing.interface';
import type { CouponRepository } from '../repositories/coupon.repository';
import type { BillingEventService } from './billing-event.service';
import type { WalletService } from './wallet.service';

@Injectable()
export class CouponService {
  constructor(
    private readonly couponRepo: CouponRepository,
    private readonly walletService: WalletService,
    readonly _billingEvent: BillingEventService,
  ) {}

  async validate(code: string): Promise<ICouponValidation> {
    const coupon = await this.couponRepo.findByCode(code);
    if (!coupon) return { valid: false, reason: 'Coupon not found' };
    if (!coupon.isActive) return { valid: false, reason: 'Coupon is inactive' };

    if (coupon.expiresAt && coupon.expiresAt < new Date()) {
      return { valid: false, reason: 'Coupon has expired' };
    }

    if (coupon.startsAt && coupon.startsAt > new Date()) {
      return { valid: false, reason: 'Coupon is not yet active' };
    }

    if (coupon.maxRedemptions && coupon.currentRedemptions >= coupon.maxRedemptions) {
      return { valid: false, reason: 'Coupon has reached max redemptions' };
    }

    return {
      valid: true,
      discountValue: Number(coupon.value),
      discountType: coupon.type,
    };
  }

  async redeem(code: string, userId: string, entity: { userId?: string; organizationId?: string }) {
    const validation = await this.validate(code);
    if (!validation.valid) {
      throw new BadRequestException(validation.reason);
    }

    const coupon = await this.couponRepo.findByCode(code);
    if (!coupon) throw new NotFoundException('Coupon not found');

    const wallet = await this.walletService.getOrCreateWallet(entity);
    const couponValue = Number(coupon.value);

    let creditsToAdd = BigInt(0);
    if (coupon.type === 'FREE_CREDITS') {
      creditsToAdd = BigInt(couponValue);
    }

    if (creditsToAdd > BigInt(0)) {
      const tx = await this.walletService.addCredits(wallet.id, creditsToAdd, 0, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: 'BONUS_GRANT' as any,
        description: `Coupon: ${coupon.code}`,
        couponId: coupon.id,
        referenceType: 'coupon_redemption',
        referenceId: `${coupon.id}_${userId}`,
      });

      await this.couponRepo.createRedemption({
        couponId: coupon.id,
        userId,
        walletId: wallet.id,
        walletTransactionId: tx.id,
        amountUsd: couponValue,
      });
    } else {
      await this.couponRepo.createRedemption({
        couponId: coupon.id,
        userId,
      });
    }

    await this.couponRepo.incrementRedemptions(coupon.id);

    return { coupon, creditsGranted: creditsToAdd };
  }

  async findAll(limit = 50, offset = 0) {
    return this.couponRepo.findAll(limit, offset);
  }

  async findById(id: string) {
    const coupon = await this.couponRepo.findById(id);
    if (!coupon) throw new NotFoundException('Coupon not found');
    return coupon;
  }

  async create(data: {
    code: string;
    type: string;
    value: number;
    maxRedemptions?: number;
    minAmountUsd?: number;
    maxAmountUsd?: number;
    startsAt?: Date;
    expiresAt?: Date;
    metadata?: Record<string, unknown>;
  }) {
    const existing = await this.couponRepo.findByCode(data.code);
    if (existing) throw new BadRequestException('Coupon code already exists');
    return this.couponRepo.create(data);
  }

  async update(
    id: string,
    data: {
      code?: string;
      type?: string;
      value?: number;
      maxRedemptions?: number;
      minAmountUsd?: number;
      maxAmountUsd?: number;
      startsAt?: Date;
      expiresAt?: Date;
      isActive?: boolean;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.findById(id);
    return this.couponRepo.update(id, data);
  }
}
