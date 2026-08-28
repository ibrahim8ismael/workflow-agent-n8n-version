import { Injectable } from '@nestjs/common';
import type { Automation, Prisma } from '@prisma/client';
import { DatabaseService } from '../../../database/database.service';
import type { OwnerScope } from '../../integrations/n8n/repositories/n8n-connections.repository';

export type { OwnerScope };

@Injectable()
export class AutomationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: Prisma.AutomationCreateInput): Promise<Automation> {
    return this.db.automation.create({ data });
  }

  async findById(id: string, scope?: OwnerScope): Promise<Automation | null> {
    return this.db.automation.findFirst({
      where: {
        id,
        deletedAt: null,
        ...(scope
          ? {
              OR: [
                ...(scope.userId ? [{ userId: scope.userId }] : []),
                ...(scope.organizationId ? [{ organizationId: scope.organizationId }] : []),
              ],
            }
          : {}),
      },
    });
  }

  async list(scope?: OwnerScope): Promise<Automation[]> {
    return this.db.automation.findMany({
      where: {
        deletedAt: null,
        ...(scope
          ? {
              OR: [
                ...(scope.userId ? [{ userId: scope.userId }] : []),
                ...(scope.organizationId ? [{ organizationId: scope.organizationId }] : []),
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: Prisma.AutomationUpdateInput): Promise<Automation> {
    return this.db.automation.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<Automation> {
    return this.db.automation.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** First ACTIVE connection owned by the scope — used when no explicit connection is bound. */
  async findActiveConnectionId(scope: OwnerScope): Promise<string | null> {
    const connection = await this.db.n8nConnection.findFirst({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        ...(scope
          ? {
              OR: [
                ...(scope.userId ? [{ userId: scope.userId }] : []),
                ...(scope.organizationId ? [{ organizationId: scope.organizationId }] : []),
              ],
            }
          : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });
    return connection?.id ?? null;
  }
}
