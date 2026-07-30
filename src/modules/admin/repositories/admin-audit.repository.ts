import { Injectable } from '@nestjs/common';
import type { DatabaseService } from '../../../database/database.service';

@Injectable()
export class AdminAuditRepository {
  constructor(private readonly db: DatabaseService) {}

  async findAuditLogs(
    limit = 100,
    offset = 0,
    filters?: { action?: string; userId?: string; entityType?: string },
  ) {
    return this.db.auditLog.findMany({
      where: {
        ...(filters?.action ? { action: filters.action } : {}),
        ...(filters?.userId ? { userId: filters.userId } : {}),
        ...(filters?.entityType ? { entityType: filters.entityType } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      include: { user: { select: { id: true, email: true, name: true } } },
    });
  }

  async findImpersonationLogs(limit = 100, offset = 0) {
    return this.db.impersonationLog.findMany({
      orderBy: { impersonatedAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  async createImpersonationLog(data: {
    adminId: string;
    targetUserId: string;
    targetOrganizationId?: string;
    reason: string;
  }) {
    return this.db.impersonationLog.create({ data });
  }

  async endImpersonation(id: string) {
    return this.db.impersonationLog.update({
      where: { id },
      data: { endedAt: new Date() },
    });
  }
}
