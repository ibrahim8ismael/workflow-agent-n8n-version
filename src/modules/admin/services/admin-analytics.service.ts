import { Injectable, Logger } from '@nestjs/common';
import { AdminSubscriptionsRepository } from '../repositories/admin-subscriptions.repository';
import { AdminUsersRepository } from '../repositories/admin-users.repository';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class AdminAnalyticsService {
  private readonly logger = new Logger(AdminAnalyticsService.name);

  constructor(
    private readonly subRepo: AdminSubscriptionsRepository,
    private readonly userRepo: AdminUsersRepository,
    private readonly db: DatabaseService,
  ) {}

  async getMrr() {
    const subscriptions = await this.subRepo.findAll(1000, 0);
    let mrr = 0;
    for (const sub of subscriptions) {
      if (sub.status === 'ACTIVE' && sub.plan) {
        mrr += Number(sub.plan.price);
      }
    }
    return { mrr, arr: mrr * 12 };
  }

  async getChurnRate(since?: Date) {
    const sinceDate = since ?? new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const periodStart = sinceDate;
    const periodEnd = new Date();

    const canceledInPeriod = await this.db.subscription.count({
      where: {
        status: 'CANCELED',
        canceledAt: { gte: periodStart, lte: periodEnd },
        deletedAt: null,
      },
    });

    const activeAtStart = await this.db.subscription.count({
      where: {
        status: { not: 'CANCELED' },
        deletedAt: null,
        createdAt: { lt: periodStart },
      },
    });

    const churnRate = activeAtStart > 0 ? canceledInPeriod / activeAtStart : 0;

    return {
      churnRate,
      canceledInPeriod,
      activeAtStart,
      periodStart,
      periodEnd,
    };
  }

  async getCreditsBurnRate(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const result = await this.db.walletTransaction.aggregate({
      where: {
        type: 'CONSUMPTION',
        createdAt: { gte: since },
      },
      _sum: { amountCredits: true },
    });

    const totalBurn = Number(result._sum.amountCredits ?? BigInt(0));
    const dailyBurnRate = days > 0 ? totalBurn / days : 0;

    return {
      totalBurn,
      dailyBurnRate,
      periodDays: days,
      since,
    };
  }

  async getArpu() {
    const totalCustomers = await this.userRepo.countActive();
    const { mrr } = await this.getMrr();
    const arpu = totalCustomers > 0 ? mrr / totalCustomers : 0;
    return { arpu, totalCustomers, mrr };
  }

  async getDashboard() {
    const [mrrData, churnData, burnData, arpuData, subsByStatus] = await Promise.all([
      this.getMrr(),
      this.getChurnRate(),
      this.getCreditsBurnRate(),
      this.getArpu(),
      this.subRepo.countByStatus(),
    ]);

    return {
      mrr: mrrData.mrr,
      arr: mrrData.arr,
      churnRate: churnData.churnRate,
      arpu: arpuData.arpu,
      totalCustomers: arpuData.totalCustomers,
      dailyCreditsBurnRate: burnData.dailyBurnRate,
      totalCreditsBurnt: burnData.totalBurn,
      subscriptionsByStatus: subsByStatus,
    };
  }
}
