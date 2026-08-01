import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class AdminOrganizationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(limit = 50, offset = 0) {
    return this.db.organization.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { members: true, agents: true, apiKeys: true },
        },
      },
    });
  }

  async findById(id: string) {
    return this.db.organization.findUnique({
      where: { id },
      include: {
        _count: {
          select: { members: true, agents: true, apiKeys: true, conversations: true },
        },
        subscription: { include: { plan: true } },
      },
    });
  }

  async suspend(id: string) {
    return this.db.organization.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async reactivate(id: string) {
    return this.db.organization.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async count() {
    return this.db.organization.count();
  }
}
