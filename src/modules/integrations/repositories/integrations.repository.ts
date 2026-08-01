import { Injectable } from '@nestjs/common';
import { Integration, Prisma } from '@prisma/client';
import { DatabaseService } from '../../../database/database.service';

@Injectable()
export class IntegrationsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: Prisma.IntegrationCreateInput): Promise<Integration> {
    return this.db.integration.create({ data });
  }

  async findById(id: string): Promise<Integration | null> {
    return this.db.integration.findFirst({ where: { id, deletedAt: null } });
  }

  async findByOrganization(organizationId: string): Promise<Integration[]> {
    return this.db.integration.findMany({
      where: { organizationId, deletedAt: null },
    });
  }

  async findByProvider(organizationId: string, provider: string): Promise<Integration | null> {
    return this.db.integration.findFirst({
      where: { organizationId, provider, deletedAt: null },
    });
  }

  async checkAvailability(organizationId: string, provider: string): Promise<boolean> {
    const integration = await this.db.integration.findFirst({
      where: { organizationId, provider, status: 'CONNECTED', deletedAt: null },
    });
    return integration !== null;
  }

  async update(id: string, data: Prisma.IntegrationUpdateInput): Promise<Integration> {
    return this.db.integration.update({ where: { id }, data });
  }

  async softDelete(id: string): Promise<Integration> {
    return this.db.integration.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
