import { Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class AdminUsersRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAll(limit = 50, offset = 0) {
    return this.db.user.findMany({
      take: limit,
      skip: offset,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        _count: {
          select: {
            sessions: true,
            organizationMembers: true,
            agents: true,
          },
        },
      },
    });
  }

  async findById(id: string) {
    return this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        emailVerifiedAt: true,
        tokenVersion: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        _count: {
          select: {
            sessions: true,
            organizationMembers: true,
            agents: true,
            conversations: true,
          },
        },
      },
    });
  }

  async suspend(id: string) {
    return this.db.user.update({
      where: { id },
      data: { isActive: false, tokenVersion: { increment: 1 } },
    });
  }

  async reactivate(id: string) {
    return this.db.user.update({
      where: { id },
      data: { isActive: true, deletedAt: null },
    });
  }

  async count() {
    return this.db.user.count();
  }

  async countActive() {
    return this.db.user.count({ where: { isActive: true } });
  }
}
