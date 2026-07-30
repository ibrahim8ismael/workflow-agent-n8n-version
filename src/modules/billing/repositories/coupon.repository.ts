import { Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class CouponRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByCode(code: string) {
    return this.db.coupon.findUnique({
      where: { code, deletedAt: null },
    });
  }

  async findById(id: string) {
    return this.db.coupon.findUnique({
      where: { id, deletedAt: null },
    });
  }

  async findAllActive() {
    return this.db.coupon.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAll(limit = 50, offset = 0) {
    return this.db.coupon.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
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
    return this.db.coupon.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { ...data, type: data.type as any, metadata: data.metadata as any },
    });
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
    return this.db.coupon.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { ...data, type: data.type as any, metadata: data.metadata as any },
    });
  }

  async incrementRedemptions(id: string) {
    return this.db.coupon.update({
      where: { id },
      data: { currentRedemptions: { increment: 1 } },
    });
  }

  async createRedemption(data: {
    couponId: string;
    userId: string;
    walletId?: string;
    walletTransactionId?: string;
    amountUsd?: number;
    metadata?: Record<string, unknown>;
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.couponRedemption.create({ data: { ...data, metadata: data.metadata as any } });
  }

  async findRedemptionsByCouponId(couponId: string) {
    return this.db.couponRedemption.findMany({
      where: { couponId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findRedemptionsByUserId(userId: string) {
    return this.db.couponRedemption.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
