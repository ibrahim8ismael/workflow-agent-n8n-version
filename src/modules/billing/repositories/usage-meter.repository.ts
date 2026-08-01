import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class UsageMeterRepository {
  constructor(private readonly db: DatabaseService) {}

  async findBySubscriptionId(subscriptionId: string) {
    return this.db.usageMeter.findFirst({
      where: { subscriptionId },
      orderBy: { resetAt: 'desc' },
    });
  }

  async findCurrent(subscriptionId: string) {
    return this.db.usageMeter.findFirst({
      where: {
        subscriptionId,
        resetAt: { gt: new Date() },
      },
    });
  }

  async create(data: {
    subscriptionId: string;
    aiCreditsUsed?: bigint;
    aiCreditsLimit: bigint;
    operationsUsed?: bigint;
    operationsLimit: bigint;
    resetAt: Date;
  }) {
    return this.db.usageMeter.create({ data });
  }

  async incrementAiCredits(id: string, amount: bigint) {
    return this.db.usageMeter.update({
      where: { id },
      data: { aiCreditsUsed: { increment: amount } },
    });
  }

  async incrementOperations(id: string, amount: bigint) {
    return this.db.usageMeter.update({
      where: { id },
      data: { operationsUsed: { increment: amount } },
    });
  }

  async reset(
    subscriptionId: string,
    aiCreditsLimit: bigint,
    operationsLimit: bigint,
    resetAt: Date,
  ) {
    const current = await this.findBySubscriptionId(subscriptionId);
    if (current) {
      await this.db.usageMeter.delete({ where: { id: current.id } });
    }
    return this.create({
      subscriptionId,
      aiCreditsLimit,
      operationsLimit,
      resetAt,
    });
  }

  async findDueForReset() {
    return this.db.usageMeter.findMany({
      where: { resetAt: { lt: new Date() } },
      include: { subscription: { include: { plan: true } } },
    });
  }
}
