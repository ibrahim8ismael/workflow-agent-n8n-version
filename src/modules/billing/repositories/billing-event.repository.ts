import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import { BillingEventType } from '@prisma/client';

@Injectable()
export class BillingEventRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: {
    type: BillingEventType;
    entityType: string;
    entityId: string;
    userId?: string;
    organizationId?: string;
    metadata?: Record<string, unknown>;
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.billingEvent.create({ data: { ...data, metadata: data.metadata as any } });
  }

  async findByEntity(entityType: string, entityId: string, limit = 50) {
    return this.db.billingEvent.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findByType(type: BillingEventType, limit = 50) {
    return this.db.billingEvent.findMany({
      where: { type },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async findAll(limit = 100, offset = 0) {
    return this.db.billingEvent.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async countByType(type: BillingEventType, since: Date) {
    return this.db.billingEvent.count({
      where: { type, createdAt: { gte: since } },
    });
  }

  async countByTypeAndEntity(type: BillingEventType, entityType: string, entityId: string) {
    return this.db.billingEvent.count({
      where: { type, entityType, entityId },
    });
  }
}
