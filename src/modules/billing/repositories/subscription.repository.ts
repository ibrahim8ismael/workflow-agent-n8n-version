import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class SubscriptionRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(id: string) {
    return this.db.subscription.findUnique({
      where: { id, deletedAt: null },
      include: { plan: true },
    });
  }

  async findByUserId(userId: string) {
    return this.db.subscription.findUnique({
      where: { userId, deletedAt: null },
      include: { plan: true },
    });
  }

  async findByOrganizationId(organizationId: string) {
    return this.db.subscription.findUnique({
      where: { organizationId, deletedAt: null },
      include: { plan: true },
    });
  }

  async findAll(limit = 50, offset = 0) {
    return this.db.subscription.findMany({
      where: { deletedAt: null },
      include: { plan: true },
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    });
  }

  async countActive() {
    return this.db.subscription.count({
      where: { deletedAt: null, status: 'ACTIVE' },
    });
  }

  async create(data: {
    planId: string;
    status?: string;
    currentPeriodStart: Date;
    currentPeriodEnd: Date;
    provider: string;
    providerSubscriptionId: string;
    trialEndsAt?: Date;
    userId?: string;
    organizationId?: string;
  }) {
    return this.db.subscription.create({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { ...data, status: data.status as any },
      include: { plan: true },
    });
  }

  async update(
    id: string,
    data: {
      planId?: string;
      status?: string;
      currentPeriodStart?: Date;
      currentPeriodEnd?: Date;
      canceledAt?: Date;
    },
  ) {
    return this.db.subscription.update({
      where: { id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { ...data, status: data.status as any },
      include: { plan: true },
    });
  }

  async cancel(id: string) {
    return this.db.subscription.update({
      where: { id },
      data: { status: 'CANCELED', canceledAt: new Date(), deletedAt: new Date() },
    });
  }

  async findByStatus(status: string) {
    return this.db.subscription.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { status: status as any, deletedAt: null },
      include: { plan: true },
    });
  }

  async findExpired() {
    return this.db.subscription.findMany({
      where: {
        currentPeriodEnd: { lt: new Date() },
        status: { not: 'CANCELED' },
        deletedAt: null,
      },
    });
  }
}
