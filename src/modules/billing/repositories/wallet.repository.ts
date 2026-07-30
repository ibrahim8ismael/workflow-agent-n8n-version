import { Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class WalletRepository {
  constructor(private readonly db: DatabaseService) {}

  async findByUserId(userId: string) {
    return this.db.wallet.findUnique({ where: { userId, deletedAt: null } });
  }

  async findByOrganizationId(organizationId: string) {
    return this.db.wallet.findUnique({ where: { organizationId, deletedAt: null } });
  }

  async findById(id: string) {
    return this.db.wallet.findUnique({ where: { id, deletedAt: null } });
  }

  async createForUser(userId: string) {
    return this.db.wallet.create({ data: { userId } });
  }

  async createForOrganization(organizationId: string) {
    return this.db.wallet.create({ data: { organizationId } });
  }

  async getOrCreateForUser(userId: string) {
    const existing = await this.findByUserId(userId);
    if (existing) return existing;
    return this.createForUser(userId);
  }

  async getOrCreateForOrganization(organizationId: string) {
    const existing = await this.findByOrganizationId(organizationId);
    if (existing) return existing;
    return this.createForOrganization(organizationId);
  }

  async deductCreditsAtomic(walletId: string, amount: bigint, version: number) {
    return this.db.wallet.update({
      where: { id: walletId, version },
      data: {
        balanceCredits: { decrement: amount },
        version: { increment: 1 },
      },
    });
  }

  async addCreditsAtomic(walletId: string, amount: bigint) {
    return this.db.wallet.update({
      where: { id: walletId },
      data: {
        balanceCredits: { increment: amount },
        lifetimeCredits: { increment: amount },
        version: { increment: 1 },
      },
    });
  }

  async addCreditsWithUsdAtomic(walletId: string, credits: bigint, usd: number) {
    return this.db.wallet.update({
      where: { id: walletId },
      data: {
        balanceCredits: { increment: credits },
        balanceCreditsUsd: { increment: usd },
        lifetimeCredits: { increment: credits },
        lifetimeSpendUsd: { increment: usd },
        version: { increment: 1 },
      },
    });
  }

  async setGracePeriod(walletId: string, graceEnd: Date) {
    return this.db.wallet.update({
      where: { id: walletId },
      data: { gracePeriodEnd: graceEnd },
    });
  }

  async freeze(walletId: string) {
    return this.db.wallet.update({
      where: { id: walletId },
      data: { isFrozen: true },
    });
  }

  async unfreeze(walletId: string) {
    return this.db.wallet.update({
      where: { id: walletId },
      data: { isFrozen: false, gracePeriodEnd: null },
    });
  }

  async setSoftLimit(walletId: string, limit: bigint) {
    return this.db.wallet.update({
      where: { id: walletId },
      data: { softLimit: limit },
    });
  }

  async setHardLimit(walletId: string, limit: bigint) {
    return this.db.wallet.update({
      where: { id: walletId },
      data: { hardLimit: limit },
    });
  }
}
