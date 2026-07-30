import { Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class TopUpRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAllActivePackages() {
    return this.db.topUpPackage.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async findPackageById(id: string) {
    return this.db.topUpPackage.findUnique({
      where: { id, deletedAt: null },
    });
  }

  async createPackage(data: {
    name: string;
    description?: string;
    priceUsd: number;
    creditsAmount: bigint;
    operationsAmount?: bigint;
    isActive?: boolean;
    sortOrder?: number;
  }) {
    return this.db.topUpPackage.create({ data });
  }

  async updatePackage(
    id: string,
    data: {
      name?: string;
      description?: string;
      priceUsd?: number;
      creditsAmount?: bigint;
      operationsAmount?: bigint;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.db.topUpPackage.update({ where: { id }, data });
  }

  async createPurchase(data: {
    packageId: string;
    walletId: string;
    amountPaidUsd: number;
    creditsGranted: bigint;
    operationsGranted?: bigint;
    status?: string;
    provider?: string;
    providerPaymentId?: string;
    metadata?: Record<string, unknown>;
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.topUpPurchase.create({ data: { ...data, metadata: data.metadata as any } });
  }

  async findPurchaseById(id: string) {
    return this.db.topUpPurchase.findUnique({
      where: { id },
      include: { package: true },
    });
  }

  async findByWalletId(walletId: string) {
    return this.db.topUpPurchase.findMany({
      where: { walletId },
      include: { package: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updatePurchaseStatus(id: string, status: string, providerPaymentId?: string) {
    return this.db.topUpPurchase.update({
      where: { id },
      data: { status, providerPaymentId },
    });
  }
}
