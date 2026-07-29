import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class AdminSubscriptionsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(limit = 50, offset = 0) {
    return this.db.subscription.findMany({
      where: { deletedAt: null },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
  }

  async findById(id: string) {
    return this.db.subscription.findUnique({
      where: { id, deletedAt: null },
      include: { plan: true, invoices: { orderBy: { createdAt: 'desc' }, take: 10 } },
    });
  }

  async forceCancel(id: string) {
    return this.db.subscription.update({
      where: { id },
      data: { status: 'CANCELED', canceledAt: new Date(), deletedAt: new Date() },
    });
  }

  async updatePlan(id: string, planId: string) {
    return this.db.subscription.update({
      where: { id },
      data: { planId },
      include: { plan: true },
    });
  }

  async countByStatus() {
    const statuses = await this.db.subscription.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: true,
    });
    return statuses.reduce(
      (acc, s) => ({ ...acc, [s.status]: s._count }),
      {} as Record<string, number>,
    );
  }

  async totalRevenue() {
    const result = await this.db.invoice.aggregate({
      where: { status: 'PAID' },
      _sum: { amount: true },
    });
    return result._sum.amount ?? BigInt(0);
  }
}
