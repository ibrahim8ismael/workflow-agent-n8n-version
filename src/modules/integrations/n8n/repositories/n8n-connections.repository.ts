import { Injectable } from '@nestjs/common';
import type { N8nConnection, Prisma } from '@prisma/client';
import { DatabaseService } from '../../../../database/database.service';

export interface OwnerScope {
  userId?: string;
  organizationId?: string;
}

@Injectable()
export class N8nConnectionsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: Prisma.N8nConnectionCreateInput): Promise<N8nConnection> {
    return this.db.n8nConnection.create({ data });
  }

  async findById(id: string, scope?: OwnerScope): Promise<N8nConnection | null> {
    return this.db.n8nConnection.findFirst({
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

  async list(scope?: OwnerScope): Promise<N8nConnection[]> {
    return this.db.n8nConnection.findMany({
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

  async update(id: string, data: Prisma.N8nConnectionUpdateInput): Promise<N8nConnection> {
    return this.db.n8nConnection.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<N8nConnection> {
    return this.db.n8nConnection.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async getCredential(connectionId: string) {
    return this.db.n8nConnectionCredential.findUnique({ where: { connectionId } });
  }

  async upsertCredential(connectionId: string, encryptedData: string) {
    return this.db.n8nConnectionCredential.upsert({
      where: { connectionId },
      create: { connectionId, encryptedData },
      update: { encryptedData },
    });
  }
}
