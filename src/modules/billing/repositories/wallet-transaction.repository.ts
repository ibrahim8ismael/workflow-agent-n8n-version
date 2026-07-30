import { Injectable } from '@nestjs/common';
import type { WalletTransactionType } from '@prisma/client';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class WalletTransactionRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: {
    walletId: string;
    type: WalletTransactionType;
    amountCredits: bigint;
    amountUsd?: number;
    balanceBefore: bigint;
    balanceAfter: bigint;
    description?: string;
    referenceType?: string;
    referenceId?: string;
    metadata?: Record<string, unknown>;
    couponId?: string;
    expiresAt?: Date;
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.walletTransaction.create({ data: { ...data, metadata: data.metadata as any } });
  }

  async findByWalletId(walletId: string, limit = 50, offset = 0) {
    return this.db.walletTransaction.findMany({
      where: { walletId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async findByReference(referenceType: string, referenceId: string) {
    return this.db.walletTransaction.findFirst({
      where: { referenceType, referenceId },
    });
  }

  async getTotalConsumed(walletId: string, since: Date) {
    const result = await this.db.walletTransaction.aggregate({
      where: {
        walletId,
        type: 'CONSUMPTION',
        createdAt: { gte: since },
      },
      _sum: { amountCredits: true },
    });
    return result._sum.amountCredits ?? BigInt(0);
  }
}
